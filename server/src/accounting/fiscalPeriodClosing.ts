import { AccountCodes } from './accountCodes.js';
import type { JournalEntryInput } from './journalShared.js';
import { BS_BALANCE_TOLERANCE, MONEY_TOLERANCE, roundMoney } from '../lib/money.js';

export type AccountNetBalance = {
  accountCode: string;
  accountName: string;
  /** Σ(debit − credit) */
  netDebit: number;
};

export function dayAfterIsoDate(iso: string): string {
  const key = iso.trim().slice(0, 10);
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) throw new Error('Invalid date');
  const dt = new Date(y, m - 1, d + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function isPlAccount(code: string): boolean {
  return code.startsWith('4') || code.startsWith('5');
}

function isBalanceSheetAccount(code: string): boolean {
  return code.startsWith('1') || code.startsWith('2') || code.startsWith('3');
}

/**
 * Close class 4 (revenue) and 5 (expense) leaf balances into retained earnings.
 * Credit-balance accounts (typical revenue) are debited; debit-balance (expenses) are credited.
 */
export function buildIncomeClosingEntries(
  balances: AccountNetBalance[],
  retainedEarningsCode = AccountCodes.RETAINED_EARNINGS,
  retainedEarningsName = 'الأرباح المحتجزة',
): { entries: JournalEntryInput[]; netProfit: number } {
  const entries: JournalEntryInput[] = [];
  for (const row of balances) {
    const code = String(row.accountCode || '').trim();
    if (!isPlAccount(code) || code.length < 5) continue;
    const net = roundMoney(row.netDebit);
    if (Math.abs(net) <= MONEY_TOLERANCE) continue;
    if (net > 0) {
      entries.push({
        accountCode: code,
        accountName: row.accountName || code,
        debit: 0,
        credit: net,
      });
    } else {
      entries.push({
        accountCode: code,
        accountName: row.accountName || code,
        debit: roundMoney(-net),
        credit: 0,
      });
    }
  }

  const totalDr = roundMoney(entries.reduce((s, e) => s + e.debit, 0));
  const totalCr = roundMoney(entries.reduce((s, e) => s + e.credit, 0));
  const diff = roundMoney(totalDr - totalCr);
  // diff > 0 → net profit closed into RE as credit; diff < 0 → net loss as debit on RE
  const netProfit = diff;
  if (Math.abs(diff) > MONEY_TOLERANCE) {
    if (diff > 0) {
      entries.push({
        accountCode: retainedEarningsCode,
        accountName: retainedEarningsName,
        debit: 0,
        credit: diff,
      });
    } else {
      entries.push({
        accountCode: retainedEarningsCode,
        accountName: retainedEarningsName,
        debit: roundMoney(-diff),
        credit: 0,
      });
    }
  }

  return { entries, netProfit };
}

/**
 * Opening journal from balance-sheet leaf nets (after P&L close).
 * Debit positive nets (assets); credit negative nets (liabilities/equity).
 * Residual gap within {@link BS_BALANCE_TOLERANCE} is absorbed into retained earnings.
 */
export function buildOpeningBalanceEntries(
  balances: AccountNetBalance[],
  retainedEarningsCode = AccountCodes.RETAINED_EARNINGS,
  retainedEarningsName = 'الأرباح المحتجزة',
): JournalEntryInput[] {
  const entries: JournalEntryInput[] = [];
  for (const row of balances) {
    const code = String(row.accountCode || '').trim();
    if (!isBalanceSheetAccount(code) || code.length < 5) continue;
    const net = roundMoney(row.netDebit);
    if (Math.abs(net) <= MONEY_TOLERANCE) continue;
    if (net > 0) {
      entries.push({
        accountCode: code,
        accountName: row.accountName || code,
        debit: net,
        credit: 0,
      });
    } else {
      entries.push({
        accountCode: code,
        accountName: row.accountName || code,
        debit: 0,
        credit: roundMoney(-net),
      });
    }
  }

  const gap = balanceSheetGapFromNets(balances);
  if (Math.abs(gap) > MONEY_TOLERANCE && Math.abs(gap) <= BS_BALANCE_TOLERANCE) {
    // gap > 0 → Dr exceed Cr → credit RE; gap < 0 → debit RE
    const existing = entries.find((e) => e.accountCode === retainedEarningsCode);
    if (gap > 0) {
      if (existing) {
        existing.credit = roundMoney(existing.credit + gap);
      } else {
        entries.push({
          accountCode: retainedEarningsCode,
          accountName: retainedEarningsName,
          debit: 0,
          credit: gap,
        });
      }
    } else {
      const abs = roundMoney(-gap);
      if (existing) {
        existing.debit = roundMoney(existing.debit + abs);
      } else {
        entries.push({
          accountCode: retainedEarningsCode,
          accountName: retainedEarningsName,
          debit: abs,
          credit: 0,
        });
      }
    }
  }

  return entries;
}

/** Assets − (liabilities + equity) using netDebit sign (assets +, L/E −). */
export function balanceSheetGapFromNets(balances: AccountNetBalance[]): number {
  let assets = 0;
  let liabEquity = 0;
  for (const row of balances) {
    const code = String(row.accountCode || '').trim();
    const net = roundMoney(row.netDebit);
    if (code.startsWith('1')) assets = roundMoney(assets + net);
    else if (code.startsWith('2') || code.startsWith('3')) liabEquity = roundMoney(liabEquity + net);
  }
  // assets should equal −liabEquity when balanced (liab/equity nets are credit = negative)
  return roundMoney(assets + liabEquity);
}

/** True when A ≈ L+E within rounding tolerance (≤ 1 EGP). */
export function isBalanceSheetBalanced(gap: number): boolean {
  return Math.abs(gap) <= BS_BALANCE_TOLERANCE;
}

export function filterLeafBalances(
  balances: AccountNetBalance[],
  predicate: (code: string) => boolean,
): AccountNetBalance[] {
  return balances.filter((b) => predicate(String(b.accountCode || '').trim()));
}

/** Open revenue/expense leaf balances that must be closed via income-statement closing. */
export function openPlBalances(balances: AccountNetBalance[]): AccountNetBalance[] {
  return filterLeafBalances(balances, (code) => isPlAccount(code) && code.length >= 5).filter(
    (b) => Math.abs(roundMoney(b.netDebit)) > MONEY_TOLERANCE,
  );
}

export { isPlAccount, isBalanceSheetAccount };
