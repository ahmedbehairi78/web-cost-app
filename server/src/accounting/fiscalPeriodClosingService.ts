import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { journalDateKey, journalDateQueryUpperBound } from '../lib/journalDate.js';
import { MONEY_TOLERANCE, roundMoney } from '../lib/money.js';
import { serialize } from '../prisma/serialize.js';
import { createTransaction } from './journal.js';
import {
  type AccountNetBalance,
  balanceSheetGapFromNets,
  buildIncomeClosingEntries,
  buildOpeningBalanceEntries,
  dayAfterIsoDate,
  filterLeafBalances,
  isBalanceSheetAccount,
  isBalanceSheetBalanced,
  isPlAccount,
  minMaxIsoDates,
  openPlBalances,
} from './fiscalPeriodClosing.js';

type TxClient = Prisma.TransactionClient;

const RETAINED_EARNINGS_NAME = 'الأرباح المحتجزة';

/**
 * Thrown when locking an accounting period while class 4/5 accounts still have balances.
 * Income-statement closing must run first.
 */
export class IncomeCloseRequiredError extends Error {
  readonly statusCode = 409 as const;
  readonly periodEnd: string;
  readonly openAccountCount: number;
  readonly sampleCodes: string[];

  constructor(periodEnd: string, open: AccountNetBalance[]) {
    const samples = open.slice(0, 5).map((r) => r.accountCode);
    const more = open.length > samples.length ? ` (+${open.length - samples.length})` : '';
    super(
      `لا يمكن قفل الفترة: توجد أرصدة مفتوحة على حسابات الإيرادات/المصروفات (4…/5…) حتى ${periodEnd}. ` +
        `أقفل قائمة الدخل أولاً من «إعداد قائمة الدخل». حسابات مفتوحة: ${samples.join(', ')}${more}`,
    );
    this.name = 'IncomeCloseRequiredError';
    this.periodEnd = periodEnd;
    this.openAccountCount = open.length;
    this.sampleCodes = samples;
  }
}

/**
 * Period lock is blocked while any revenue/expense (4…/5…) leaf still has a net balance
 * as of periodEnd (same basis as income-statement closing).
 */
export async function assertNoOpenPlBalancesForPeriodLock(periodEnd: string): Promise<void> {
  const to = periodEnd.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error('periodEnd must be YYYY-MM-DD');
  }
  const nets = await computeAccountNetsAsOf(prisma, to);
  const open = openPlBalances(nets);
  if (open.length > 0) {
    throw new IncomeCloseRequiredError(to, open);
  }
}

async function loadAccountNames(client: TxClient, codes: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(codes.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await client.chartOfAccount.findMany({
    where: { accountCode: { in: unique } },
    select: { accountCode: true, accountName: true },
  });
  return new Map(rows.map((r) => [r.accountCode, r.accountName || r.accountCode]));
}

/**
 * Leaf account nets as of dateTo (inclusive), excluding fiscal_opening journals
 * so continuous books are not double-counted after an opening entry is posted.
 */
export async function computeAccountNetsAsOf(
  client: TxClient,
  dateTo: string,
  options?: { dateFrom?: string },
): Promise<AccountNetBalance[]> {
  const to = dateTo.trim().slice(0, 10);
  const from = options?.dateFrom?.trim().slice(0, 10) || '';
  const upper = journalDateQueryUpperBound(to);

  const txs = await client.transaction.findMany({
    where: {
      isDeleted: false,
      OR: [{ journalKind: null }, { journalKind: { not: 'fiscal_opening' } }],
      date: {
        ...(from ? { gte: from } : {}),
        lte: upper,
      },
    },
    select: {
      date: true,
      journalKind: true,
      entries: { select: { accountCode: true, accountName: true, debit: true, credit: true } },
    },
  });

  const map = new Map<string, { net: number; name: string }>();
  for (const tx of txs) {
    const key = journalDateKey(tx.date);
    if (!key || key > to) continue;
    if (from && key < from) continue;
    for (const e of tx.entries) {
      const code = String(e.accountCode || '').trim();
      if (!code || code.length < 5) continue;
      const prev = map.get(code) ?? { net: 0, name: String(e.accountName || code) };
      prev.net = roundMoney(
        prev.net + (Number(e.debit) || 0) - (Number(e.credit) || 0),
      );
      if (e.accountName) prev.name = String(e.accountName);
      map.set(code, prev);
    }
  }

  const names = await loadAccountNames(client, [...map.keys()]);
  return [...map.entries()]
    .map(([accountCode, v]) => ({
      accountCode,
      accountName: names.get(accountCode) || v.name,
      netDebit: roundMoney(v.net),
    }))
    .filter((r) => Math.abs(r.netDebit) > MONEY_TOLERANCE)
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

/**
 * Earliest / latest operational journal dates (≤ dateTo) that touch currently open
 * class 4/5 leaf balances. Excludes fiscal_opening and fiscal_pl_close so the span
 * reflects live P&L activity still needing close.
 */
export async function openPlActivityDateRange(
  client: TxClient,
  dateTo: string,
  openCodes: string[],
): Promise<{ firstDate: string | null; lastDate: string | null }> {
  const to = dateTo.trim().slice(0, 10);
  const codes = [...new Set(openCodes.map((c) => String(c || '').trim()).filter(Boolean))];
  if (!codes.length || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { firstDate: null, lastDate: null };
  }
  const upper = journalDateQueryUpperBound(to);
  const txs = await client.transaction.findMany({
    where: {
      isDeleted: false,
      OR: [{ journalKind: null }, { journalKind: { notIn: ['fiscal_opening', 'fiscal_pl_close'] } }],
      date: { lte: upper },
      entries: { some: { accountCode: { in: codes } } },
    },
    select: { date: true },
  });
  let dates: string[] = [];
  for (const tx of txs) {
    const key = journalDateKey(tx.date);
    if (!key || key > to) continue;
    dates.push(key);
  }
  return minMaxIsoDates(dates);
}

export async function previewIncomeClose(periodStart: string, periodEnd: string) {
  const nets = await computeAccountNetsAsOf(prisma, periodEnd);
  const pl = filterLeafBalances(nets, isPlAccount);
  const open = openPlBalances(nets);
  const { entries, netProfit } = buildIncomeClosingEntries(pl);
  const { firstDate, lastDate } = await openPlActivityDateRange(
    prisma,
    periodEnd,
    open.map((r) => r.accountCode),
  );
  return {
    periodStart,
    periodEnd,
    plBalances: pl,
    openPlBalances: open,
    openPlAccountCount: open.length,
    openPlFirstDate: firstDate,
    openPlLastDate: lastDate,
    entries,
    netProfit,
    entryCount: entries.length,
  };
}

export async function previewBalanceSheet(periodEnd: string) {
  const nets = await computeAccountNetsAsOf(prisma, periodEnd);
  const bs = filterLeafBalances(nets, isBalanceSheetAccount);
  const gap = balanceSheetGapFromNets(bs);
  return {
    periodEnd,
    balances: bs,
    balanceGap: gap,
    isBalanced: isBalanceSheetBalanced(gap),
    totalAssets: roundMoney(
      bs.filter((b) => b.accountCode.startsWith('1')).reduce((s, b) => s + b.netDebit, 0),
    ),
    totalLiabEquity: roundMoney(
      -bs
        .filter((b) => b.accountCode.startsWith('2') || b.accountCode.startsWith('3'))
        .reduce((s, b) => s + b.netDebit, 0),
    ),
  };
}

export async function previewOpening(periodEnd: string, openingDate?: string) {
  const openDate = openingDate?.trim().slice(0, 10) || dayAfterIsoDate(periodEnd);
  const bs = await previewBalanceSheet(periodEnd);
  const entries = buildOpeningBalanceEntries(bs.balances);
  return {
    ...bs,
    openingDate: openDate,
    entries,
    entryCount: entries.length,
  };
}

function serializeClosing(row: Record<string, unknown>) {
  return serialize(row);
}

export async function listFiscalClosings() {
  const rows = await prisma.fiscalPeriodClosing.findMany({
    orderBy: [{ periodEnd: 'desc' }],
  });
  return rows.map((r) => serializeClosing(r as unknown as Record<string, unknown>));
}

export async function createFiscalClosing(input: {
  label: string;
  periodStart: string;
  periodEnd: string;
  openingDate?: string;
  notes?: string;
  createdBy?: string;
}) {
  const periodStart = input.periodStart.trim().slice(0, 10);
  const periodEnd = input.periodEnd.trim().slice(0, 10);
  const openingDate =
    input.openingDate?.trim().slice(0, 10) || dayAfterIsoDate(periodEnd);
  if (periodStart > periodEnd) throw new Error('periodStart must be <= periodEnd');
  if (openingDate <= periodEnd) throw new Error('openingDate must be after periodEnd');

  const row = await prisma.fiscalPeriodClosing.create({
    data: {
      id: randomUUID(),
      label: input.label.trim(),
      periodStart,
      periodEnd,
      openingDate,
      status: 'draft',
      notes: input.notes?.trim() || null,
      createdBy: input.createdBy ?? null,
    },
  });
  return serializeClosing(row as unknown as Record<string, unknown>);
}

export async function closeIncomeStatement(closingId: string, userId?: string) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.fiscalPeriodClosing.findUnique({ where: { id: closingId } });
    if (!row) throw new Error('Fiscal closing not found');
    if (row.status !== 'draft') throw new Error(`Cannot close P&L in status: ${row.status}`);
    if (row.plCloseTransactionId) throw new Error('P&L already closed');

    const nets = await computeAccountNetsAsOf(tx, row.periodEnd);
    const pl = filterLeafBalances(nets, isPlAccount);
    const { entries, netProfit } = buildIncomeClosingEntries(pl);
    if (entries.length < 2) {
      throw new Error('No revenue/expense balances to close for this period');
    }

    const reference = `YE-PL-${row.label}`.replace(/\s+/g, '-');
    const journal = await createTransaction(
      {
        date: row.periodEnd,
        description: `إقفال قائمة الدخل — ${row.label}`,
        reference,
        entries,
        journalKind: 'fiscal_pl_close',
        skipPeriodLock: true,
      },
      userId,
      tx,
    );

    const updated = await tx.fiscalPeriodClosing.update({
      where: { id: closingId },
      data: {
        status: 'pl_closed',
        netProfit,
        plCloseTransactionId: journal.id,
        plClosedAt: new Date(),
        plClosedBy: userId ?? null,
      },
    });
    return serializeClosing(updated as unknown as Record<string, unknown>);
  });
}

/**
 * Supplemental P&L close for residual class 4/5 balances as of periodEnd
 * (e.g. journals posted after the first YE-PL, or accounts missed in the first close).
 * Allowed after the initial close while the cycle is not reopened.
 */
export async function closeIncomeStatementResidual(closingId: string, userId?: string) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.fiscalPeriodClosing.findUnique({ where: { id: closingId } });
    if (!row) throw new Error('Fiscal closing not found');
    if (row.status === 'draft' || !row.plCloseTransactionId) {
      throw new Error('Close income statement first before residual close');
    }
    if (row.status === 'opening_posted') {
      throw new Error('Reopen the cycle before residual P&L close (opening already posted)');
    }

    const nets = await computeAccountNetsAsOf(tx, row.periodEnd);
    const open = openPlBalances(nets);
    if (open.length === 0) {
      throw new Error('No residual revenue/expense balances to close');
    }

    const { entries, netProfit: residualNet } = buildIncomeClosingEntries(open);
    if (entries.length < 2) {
      throw new Error('No residual revenue/expense balances to close');
    }

    const priorCount = await tx.transaction.count({
      where: {
        isDeleted: false,
        journalKind: 'fiscal_pl_close',
        date: row.periodEnd,
        OR: [
          { reference: { startsWith: `YE-PL-${row.label}`.replace(/\s+/g, '-') } },
          { id: row.plCloseTransactionId },
        ],
      },
    });
    const suffix = priorCount + 1;
    const baseRef = `YE-PL-${row.label}`.replace(/\s+/g, '-');
    const reference = `${baseRef}-R${suffix}`;

    await createTransaction(
      {
        date: row.periodEnd,
        description: `إقفال متبقي قائمة الدخل — ${row.label} (${open.length} حساب)`,
        reference,
        entries,
        journalKind: 'fiscal_pl_close',
        skipPeriodLock: true,
      },
      userId,
      tx,
    );

    // Residual changes RE / BS — revoke BS approval so it must be re-checked.
    const rewindBs = row.status === 'bs_approved';
    const updated = await tx.fiscalPeriodClosing.update({
      where: { id: closingId },
      data: {
        status: rewindBs ? 'pl_closed' : row.status,
        netProfit: roundMoney(Number(row.netProfit || 0) + residualNet),
        balanceGap: rewindBs ? null : row.balanceGap,
        bsApprovedAt: rewindBs ? null : row.bsApprovedAt,
        bsApprovedBy: rewindBs ? null : row.bsApprovedBy,
        notes: row.notes
          ? `${row.notes}\n[residual P&L close ${reference} by ${userId ?? 'admin'}]`
          : `residual P&L close ${reference} by ${userId ?? 'admin'}`,
      },
    });
    return serializeClosing(updated as unknown as Record<string, unknown>);
  });
}

export async function approveBalanceSheet(closingId: string, userId?: string) {
  const row = await prisma.fiscalPeriodClosing.findUnique({ where: { id: closingId } });
  if (!row) throw new Error('Fiscal closing not found');
  if (row.status !== 'pl_closed') {
    throw new Error('Approve balance sheet only after P&L close');
  }

  // Must zero class 4/5 as of periodEnd — BS 1/2/3-only check previously allowed residual P&L.
  await assertNoOpenPlBalancesForPeriodLock(row.periodEnd);

  const bs = await previewBalanceSheet(row.periodEnd);
  if (!bs.isBalanced) {
    const err = new Error('balance_sheet_unbalanced') as Error & {
      code: string;
      balanceGap: number;
    };
    err.code = 'balance_sheet_unbalanced';
    err.balanceGap = bs.balanceGap;
    throw err;
  }

  const updated = await prisma.fiscalPeriodClosing.update({
    where: { id: closingId },
    data: {
      status: 'bs_approved',
      balanceGap: bs.balanceGap,
      bsApprovedAt: new Date(),
      bsApprovedBy: userId ?? null,
    },
  });
  return serializeClosing(updated as unknown as Record<string, unknown>);
}

export async function postOpeningEntry(closingId: string, userId?: string) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.fiscalPeriodClosing.findUnique({ where: { id: closingId } });
    if (!row) throw new Error('Fiscal closing not found');
    if (row.status !== 'bs_approved') {
      throw new Error('Post opening only after balance sheet approval');
    }
    if (row.openingTransactionId) throw new Error('Opening already posted');

    const nets = await computeAccountNetsAsOf(tx, row.periodEnd);
    const bs = filterLeafBalances(nets, isBalanceSheetAccount);
    const gap = balanceSheetGapFromNets(bs);
    if (!isBalanceSheetBalanced(gap)) {
      const err = new Error('balance_sheet_unbalanced') as Error & {
        code: string;
        balanceGap: number;
      };
      err.code = 'balance_sheet_unbalanced';
      err.balanceGap = gap;
      throw err;
    }

    const entries = buildOpeningBalanceEntries(bs);
    if (entries.length < 2) throw new Error('No balance-sheet balances for opening entry');

    const reference = `OPEN-${row.openingDate.slice(0, 4)}-${row.label}`.replace(/\s+/g, '-');
    const journal = await createTransaction(
      {
        date: row.openingDate,
        description: `قيد افتتاحي — ${row.label} (أرصدة ختامية ${row.periodEnd})`,
        reference,
        entries,
        journalKind: 'fiscal_opening',
        skipPeriodLock: true,
      },
      userId,
      tx,
    );

    // Lock the closed fiscal range so no further postings land in the closed year.
    let periodLockId = row.periodLockId;
    const existingLock = await tx.accountingPeriodLock.findUnique({
      where: {
        periodStart_periodEnd: {
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
        },
      },
    });
    if (existingLock) {
      periodLockId = existingLock.id;
      if (existingLock.status !== 'locked') {
        await tx.accountingPeriodLock.update({
          where: { id: existingLock.id },
          data: {
            status: 'locked',
            lockedAt: new Date(),
            lockedBy: userId ?? null,
          },
        });
      }
    } else {
      const lock = await tx.accountingPeriodLock.create({
        data: {
          id: randomUUID(),
          label: `قفل ${row.label}`,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          status: 'locked',
          lockedAt: new Date(),
          lockedBy: userId ?? null,
          allowedUserIds: [],
        },
      });
      periodLockId = lock.id;
    }

    const updated = await tx.fiscalPeriodClosing.update({
      where: { id: closingId },
      data: {
        status: 'opening_posted',
        openingTransactionId: journal.id,
        openingPostedAt: new Date(),
        openingPostedBy: userId ?? null,
        periodLockId,
        balanceGap: gap,
      },
    });
    return serializeClosing(updated as unknown as Record<string, unknown>);
  });
}

export async function reopenFiscalClosing(closingId: string, userId?: string) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.fiscalPeriodClosing.findUnique({ where: { id: closingId } });
    if (!row) throw new Error('Fiscal closing not found');
    if (row.status === 'draft') throw new Error('Already draft');

    if (row.openingTransactionId) {
      await tx.transaction.update({
        where: { id: row.openingTransactionId },
        data: { isDeleted: true },
      });
    }
    // Soft-delete primary + any residual YE-PL-* journals for this cycle/periodEnd.
    const baseRef = `YE-PL-${row.label}`.replace(/\s+/g, '-');
    await tx.transaction.updateMany({
      where: {
        isDeleted: false,
        journalKind: 'fiscal_pl_close',
        date: row.periodEnd,
        OR: [
          ...(row.plCloseTransactionId ? [{ id: row.plCloseTransactionId }] : []),
          { reference: { startsWith: baseRef } },
        ],
      },
      data: { isDeleted: true },
    });

    if (row.periodLockId) {
      await tx.accountingPeriodLock.updateMany({
        where: { id: row.periodLockId },
        data: { status: 'open' },
      });
    }

    const updated = await tx.fiscalPeriodClosing.update({
      where: { id: closingId },
      data: {
        status: 'draft',
        netProfit: null,
        balanceGap: null,
        plCloseTransactionId: null,
        openingTransactionId: null,
        plClosedAt: null,
        plClosedBy: null,
        bsApprovedAt: null,
        bsApprovedBy: null,
        openingPostedAt: null,
        openingPostedBy: null,
        notes: row.notes
          ? `${row.notes}\n[reopened by ${userId ?? 'admin'}]`
          : `reopened by ${userId ?? 'admin'}`,
      },
    });
    return serializeClosing(updated as unknown as Record<string, unknown>);
  });
}
