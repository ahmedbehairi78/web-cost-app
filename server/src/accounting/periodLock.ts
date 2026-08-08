import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { journalDateKey } from '../lib/journalDate.js';

type DbClient = Prisma.TransactionClient | typeof prisma;

export class PeriodLockedError extends Error {
  readonly label: string;
  readonly statusCode = 423 as const;

  constructor(label: string) {
    super(`الفترة المحاسبية ${label} مقفلة — لا يمكن الترحيل أو التعديل فيها`);
    this.name = 'PeriodLockedError';
    this.label = label;
  }
}

export type LockedPeriodRow = {
  id: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  allowedUserIds: unknown;
};

function parseAllowedUserIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v).trim()).filter(Boolean);
}

export function isActorAllowedForPeriod(
  period: Pick<LockedPeriodRow, 'allowedUserIds'>,
  actorUserId?: string | null,
): boolean {
  if (!actorUserId?.trim()) return false;
  return parseAllowedUserIds(period.allowedUserIds).includes(actorUserId.trim());
}

/** Find a locked period covering the journal date (YYYY-MM-DD), if any. */
export async function findLockedPeriodForDate(
  client: DbClient,
  dateStr: unknown,
): Promise<LockedPeriodRow | null> {
  const key = journalDateKey(dateStr);
  if (!key) return null;

  const row = await client.accountingPeriodLock.findFirst({
    where: {
      status: 'locked',
      periodStart: { lte: key },
      periodEnd: { gte: key },
    },
    select: {
      id: true,
      label: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      allowedUserIds: true,
    },
  });
  return row;
}

/**
 * Throws PeriodLockedError when the date falls in a locked period and the actor
 * is not listed in that period's allowedUserIds.
 */
export async function assertPeriodUnlocked(
  client: DbClient,
  dateStr: unknown,
  actorUserId?: string | null,
): Promise<void> {
  const period = await findLockedPeriodForDate(client, dateStr);
  if (!period) return;
  if (isActorAllowedForPeriod(period, actorUserId)) return;
  throw new PeriodLockedError(period.label);
}

/** Load transaction date then assert period unlock (for soft-delete / reverse). */
export async function assertTransactionPeriodUnlocked(
  client: DbClient,
  transactionId: string,
  actorUserId?: string | null,
): Promise<void> {
  const id = transactionId.trim();
  if (!id) return;
  const row = await client.transaction.findFirst({
    where: { id },
    select: { date: true },
  });
  if (!row) return;
  await assertPeriodUnlocked(client, row.date, actorUserId);
}

export async function assertTransactionsPeriodUnlocked(
  client: DbClient,
  transactionIds: Array<string | null | undefined>,
  actorUserId?: string | null,
): Promise<void> {
  const ids = [...new Set(transactionIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
  for (const id of ids) {
    await assertTransactionPeriodUnlocked(client, id, actorUserId);
  }
}

/** True when two inclusive YYYY-MM-DD ranges overlap. */
export function dateRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const as = aStart.trim().slice(0, 10);
  const ae = aEnd.trim().slice(0, 10);
  const bs = bStart.trim().slice(0, 10);
  const be = bEnd.trim().slice(0, 10);
  if (!as || !ae || !bs || !be) return false;
  return as <= be && bs <= ae;
}
