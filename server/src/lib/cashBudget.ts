/** Server copy of client `src/lib/cashBudget.ts` period / floor / summary helpers. */
import { roundMoney } from './money.js';

export const CASH_BUDGET_PERIOD_TYPES = ['weekly', 'biweekly', 'monthly'] as const;
export type CashBudgetPeriodType = (typeof CASH_BUDGET_PERIOD_TYPES)[number];

export const CASH_BUDGET_SIDES = ['obligation', 'source'] as const;
export type CashBudgetSide = (typeof CASH_BUDGET_SIDES)[number];

export const CASH_BUDGET_BILLING_STATUSES = ['submitted', 'review', 'approved'] as const;

export function isCashBudgetPeriodType(value: unknown): value is CashBudgetPeriodType {
  return CASH_BUDGET_PERIOD_TYPES.includes(value as CashBudgetPeriodType);
}

export function ymdKey(raw: unknown): string {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const head = s.split('T')[0]?.trim() ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : '';
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymdKey(ymd).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function lastDayOfMonthYmd(ymd: string): string {
  const [y, m] = ymdKey(ymd).split('-').map(Number);
  const dt = new Date(y, m, 0);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function periodEndFor(type: CashBudgetPeriodType, start: string): string {
  const s = ymdKey(start);
  if (!s) return '';
  if (type === 'weekly') return addDaysYmd(s, 6);
  if (type === 'biweekly') return addDaysYmd(s, 13);
  return lastDayOfMonthYmd(s);
}

export function isDateInRange(value: unknown, start: string, end: string): boolean {
  const key = ymdKey(value);
  if (!key) return false;
  const from = ymdKey(start);
  const to = ymdKey(end);
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

export function payrollMonthOverlapsPeriod(
  year: number,
  month: number,
  start: string,
  end: string,
): boolean {
  if (!year || month < 1 || month > 12) return false;
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = lastDayOfMonthYmd(from);
  const ps = ymdKey(start);
  const pe = ymdKey(end);
  if (!ps || !pe) return false;
  return from <= pe && to >= ps;
}

export function custodyReplenishAmount(
  minBalance: number,
  glBalance: number,
  pendingSettlements = 0,
): number {
  const min = roundMoney(minBalance);
  if (min <= 0) return 0;
  const available = roundMoney(roundMoney(glBalance) - roundMoney(pendingSettlements));
  return roundMoney(Math.max(0, min - available));
}

export type CashBudgetLineLike = {
  side: string;
  category?: string | null;
  amount: number;
  excluded?: boolean | null;
};

export function computeCashBudgetSummary(input: {
  openingBank: number;
  openingCash: number;
  lines: CashBudgetLineLike[];
}): {
  openingBank: number;
  openingCash: number;
  availableLiquidity: number;
  periodSources: number;
  obligations: number;
  gap: number;
} {
  const openingBank = roundMoney(input.openingBank);
  const openingCash = roundMoney(input.openingCash);
  let periodSources = 0;
  let obligations = 0;
  for (const line of input.lines) {
    if (line.excluded) continue;
    const amt = roundMoney(line.amount);
    if (line.side === 'obligation') {
      obligations = roundMoney(obligations + amt);
      continue;
    }
    if (line.side !== 'source') continue;
    if (line.category === 'opening_bank' || line.category === 'opening_cash') continue;
    periodSources = roundMoney(periodSources + amt);
  }
  const availableLiquidity = roundMoney(openingBank + openingCash);
  const gap = roundMoney(availableLiquidity + periodSources - obligations);
  return { openingBank, openingCash, availableLiquidity, periodSources, obligations, gap };
}

export function originKey(originType: string, originId: string): string {
  return `${originType}:${originId}`;
}

export function isCustodyCashLeafCode(code: string): boolean {
  const c = String(code ?? '').trim();
  return /^\d{8}$/.test(c) && c.startsWith('12102');
}

export function isBankLeafCode(code: string): boolean {
  const c = String(code ?? '').trim();
  return /^\d{8}$/.test(c) && c.startsWith('12101');
}
