import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { ensureJournalCoaAccountsPg } from './ensureJournalCoa.js';
import {
  assertBalanced,
  type JournalEntryInput,
  type TransactionInput,
  type TransactionRecord,
} from './journalShared.js';
import { roundMoney } from '../lib/money.js';
import { assertPeriodUnlocked } from './periodLock.js';
import { businessTodayYmd } from '../lib/businessCalendar.js';
import { journalDateKey } from '../lib/journalDate.js';
import { env } from '../env.js';

function normalizeJournalEntries(entries: JournalEntryInput[]): JournalEntryInput[] {
  return entries.map((e) => ({
    ...e,
    debit: roundMoney(Number(e.debit) || 0),
    credit: roundMoney(Number(e.credit) || 0),
  }));
}

export { assertBalanced, buildIpcEntries } from './journalShared.js';
export type { JournalEntryInput, TransactionInput, TransactionRecord } from './journalShared.js';

type TxClient = Prisma.TransactionClient;

const transactionInclude = {
  entries: { orderBy: { lineNo: 'asc' as const } },
} satisfies Prisma.TransactionInclude;

async function loadTransaction(client: TxClient, txId: string): Promise<TransactionRecord> {
  const row = await client.transaction.findFirst({
    where: { id: txId, isDeleted: false },
    include: transactionInclude,
  });
  if (!row) throw new Error(`Transaction not found: ${txId}`);
  return serialize(row) as TransactionRecord;
}

export async function getTransactionById(txId: string): Promise<TransactionRecord | null> {
  const row = await prisma.transaction.findFirst({
    where: { id: txId, isDeleted: false },
    include: transactionInclude,
  });
  return row ? (serialize(row) as TransactionRecord) : null;
}

export async function getTransactionByReference(reference: string): Promise<TransactionRecord | null> {
  const ref = reference.trim();
  if (!ref) return null;
  const rows = await prisma.transaction.findMany({
    where: { reference: ref, isDeleted: false },
    select: { id: true },
    take: 2,
  });
  if (rows.length === 0) return null;
  if (rows.length > 1) throw new Error('Multiple journal entries share this reference.');
  return getTransactionById(rows[0]!.id);
}

export async function hasActiveReversalFor(reversesReference: string): Promise<boolean> {
  const key = reversesReference.trim();
  if (!key) return false;
  const row = await prisma.transaction.findFirst({
    where: { reversesReference: key, isDeleted: false },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * Create a balanced journal transaction in Postgres.
 *
 * Pass a Prisma transaction `client` to enlist the journal in a caller's
 * `prisma.$transaction(...)` (e.g. billing/MOS) so the journal and the
 * domain write commit atomically. When omitted, an internal transaction is used.
 */
function resolveCreateJournalDate(input: TransactionInput): string {
  if (input.stampBusinessToday) {
    return businessTodayYmd(env.businessTimezone);
  }
  const key = journalDateKey(input.date);
  return key || businessTodayYmd(env.businessTimezone);
}

export async function createTransaction(
  input: TransactionInput,
  userId?: string,
  client?: TxClient,
): Promise<TransactionRecord> {
  const entries = normalizeJournalEntries(input.entries);
  assertBalanced(entries);

  const postingDate = resolveCreateJournalDate(input);
  const reference =
    input.reference?.trim() ||
    `JV-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const reversesReference = input.reversesReference?.trim() || null;
  const undoesReversalReference = input.undoesReversalOfReference?.trim() || null;

  const run = async (tx: TxClient): Promise<TransactionRecord> => {
    if (input.reference?.trim()) {
      const existing = await tx.transaction.findFirst({
        where: { reference, isDeleted: false },
        select: { id: true },
      });
      if (existing) return loadTransaction(tx, existing.id);
    }

    if (input.id?.trim()) {
      const existingById = await tx.transaction.findFirst({
        where: { id: input.id.trim(), isDeleted: false },
        select: { id: true },
      });
      if (existingById) return loadTransaction(tx, existingById.id);
    }

    if (!input.skipPeriodLock) {
      await assertPeriodUnlocked(tx, postingDate, userId);
    }

    await ensureJournalCoaAccountsPg(tx, entries);

    const txId = input.id?.trim() || randomUUID();
    await tx.transaction.create({
      data: {
        id: txId,
        date: postingDate,
        description: input.description,
        reference,
        projectId: input.projectId?.trim() || null,
        costCenterId: input.costCenterId?.trim() || null,
        createdBy: userId ?? null,
        reversesReference,
        undoesReversalReference,
        journalKind: input.journalKind?.trim() || null,
        entries: {
          create: entries.map((e, i) => ({
            id: randomUUID(),
            lineNo: i + 1,
            accountCode: e.accountCode,
            accountName: e.accountName ?? null,
            debit: e.debit,
            credit: e.credit,
            costCenterId: e.costCenterId?.trim() || null,
          })),
        },
      },
    });

    return loadTransaction(tx, txId);
  };

  if (client) return run(client);
  return prisma.$transaction((tx) => run(tx));
}

/** Replace journal lines on an existing Postgres transaction (IPC edits). */
export async function updateTransaction(
  input: TransactionInput & { id: string },
  userId?: string,
  client?: TxClient,
): Promise<TransactionRecord> {
  assertBalanced(input.entries);
  const txId = input.id.trim();
  if (!txId) throw new Error('Transaction id is required');

  const run = async (tx: TxClient): Promise<TransactionRecord> => {
    const existing = await tx.transaction.findFirst({
      where: { id: txId, isDeleted: false },
      select: { id: true, date: true },
    });
    if (!existing) throw new Error(`Transaction not found: ${txId}`);

    if (!input.skipPeriodLock) {
      await assertPeriodUnlocked(tx, existing.date, userId);
      await assertPeriodUnlocked(tx, input.date, userId);
    }

    await ensureJournalCoaAccountsPg(tx, input.entries);
    await tx.journalEntry.deleteMany({ where: { transactionId: txId } });
    await tx.transaction.update({
      where: { id: txId },
      data: {
        date: input.date,
        description: input.description,
        ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
        projectId: input.projectId?.trim() || null,
        costCenterId: input.costCenterId?.trim() || null,
        createdBy: userId ?? undefined,
      },
    });
    await tx.journalEntry.createMany({
      data: input.entries.map((e, i) => ({
        id: randomUUID(),
        transactionId: txId,
        lineNo: i + 1,
        accountCode: e.accountCode,
        accountName: e.accountName ?? null,
        debit: e.debit,
        credit: e.credit,
        costCenterId: e.costCenterId?.trim() || null,
      })),
    });
    return loadTransaction(tx, txId);
  };

  if (client) return run(client);
  return prisma.$transaction((tx) => run(tx));
}
