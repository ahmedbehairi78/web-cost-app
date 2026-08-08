import { roundMoney } from './money';

export interface GlBalanceTxSlice {
  isDeleted?: boolean;
  entries?: { accountCode: string | number; debit: number; credit: number }[];
}

export interface GlAccountTotals {
  debit: number;
  credit: number;
  /** Net = debit − credit (same as bank statement running balance sign). */
  balance: number;
}

/** Per account code: Σ debit, Σ credit, and net balance from GL journal lines. */
export function buildGlAccountTotalsMap(transactions: GlBalanceTxSlice[]): Map<string, GlAccountTotals> {
  const map = new Map<string, GlAccountTotals>();
  for (const tx of transactions) {
    if (tx.isDeleted) continue;
    for (const entry of tx.entries ?? []) {
      const code = String(entry.accountCode ?? '').trim();
      if (!code) continue;
      const prev = map.get(code) ?? { debit: 0, credit: 0, balance: 0 };
      const debit = roundMoney(prev.debit + Number(entry.debit || 0));
      const credit = roundMoney(prev.credit + Number(entry.credit || 0));
      map.set(code, { debit, credit, balance: roundMoney(debit - credit) });
    }
  }
  return map;
}

/** Net GL balance per 8-digit account code: Σ(debit − credit). */
export function buildGlAccountBalanceMap(transactions: GlBalanceTxSlice[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const [code, totals] of buildGlAccountTotalsMap(transactions)) {
    map.set(code, totals.balance);
  }
  return map;
}

export function resolveBankGlAccountCode(
  bank: { code: string; coaAccountId?: string },
  coaAccounts: { id: string; accountCode: string }[],
): string {
  if (bank.coaAccountId) {
    const linked = coaAccounts.find((c) => c.id === bank.coaAccountId);
    if (linked?.accountCode) return String(linked.accountCode).trim();
  }
  return String(bank.code).trim();
}

export function coaIdToAccountCode(
  coaId: string,
  coaAccounts: { id: string; accountCode: string }[],
): string {
  if (!coaId.trim()) return '';
  const acc = coaAccounts.find((c) => c.id === coaId);
  return acc ? String(acc.accountCode).trim() : '';
}

export type GlBalanceSide = 'debit' | 'credit' | 'zero';

export function resolveGlBalanceSide(netDebitMinusCredit: number): GlBalanceSide {
  if (Math.abs(netDebitMinusCredit) < 0.005) return 'zero';
  return netDebitMinusCredit > 0 ? 'debit' : 'credit';
}
