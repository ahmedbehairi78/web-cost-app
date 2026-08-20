import { roundMoney } from './money';

export const CASH_BUDGET_PERIOD_TYPES = ['weekly', 'biweekly', 'monthly'] as const;
export type CashBudgetPeriodType = (typeof CASH_BUDGET_PERIOD_TYPES)[number];

export const CASH_BUDGET_STATUSES = ['draft', 'approved'] as const;
export type CashBudgetStatus = (typeof CASH_BUDGET_STATUSES)[number];

export const CASH_BUDGET_SIDES = ['obligation', 'source'] as const;
export type CashBudgetSide = (typeof CASH_BUDGET_SIDES)[number];

export const CASH_BUDGET_ORIGINS = ['auto', 'manual'] as const;
export type CashBudgetOrigin = (typeof CASH_BUDGET_ORIGINS)[number];

export const OBLIGATION_CATEGORIES = [
  'supplier',
  'subcontractor',
  'custody_settlement',
  'custody_replenish',
  'payroll',
  'other',
] as const;
export type ObligationCategory = (typeof OBLIGATION_CATEGORIES)[number];

export const SOURCE_CATEGORIES = ['opening_bank', 'opening_cash', 'collection', 'other'] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

export type CashBudgetCategory = ObligationCategory | SourceCategory;

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

/**
 * Site-accountant custody floor: replenish when GL (after pending settlements) is below min.
 * minBalance ≤ 0 means no replenish obligation.
 */
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

export type CashBudgetSummary = {
  openingBank: number;
  openingCash: number;
  availableLiquidity: number;
  periodSources: number;
  obligations: number;
  gap: number;
};

/** gap = (banks + cash + uncollected IPCs) − obligations. Bank/cash table lines drive KPIs when present. */
export function computeCashBudgetSummary(input: {
  openingBank: number;
  openingCash: number;
  lines: CashBudgetLineLike[];
}): CashBudgetSummary {
  let bankFromLines = 0;
  let cashFromLines = 0;
  let sawBankLine = false;
  let sawCashLine = false;
  let periodSources = 0;
  let obligations = 0;
  for (const line of input.lines) {
    const amt = roundMoney(line.amount);
    const cat = String(line.category ?? '');
    if (cat === 'opening_bank') {
      sawBankLine = true;
      if (!line.excluded) bankFromLines = roundMoney(bankFromLines + amt);
      continue;
    }
    if (cat === 'opening_cash') {
      sawCashLine = true;
      if (!line.excluded) cashFromLines = roundMoney(cashFromLines + amt);
      continue;
    }
    if (line.excluded) continue;
    if (line.side === 'obligation') {
      obligations = roundMoney(obligations + amt);
      continue;
    }
    if (line.side === 'source') {
      periodSources = roundMoney(periodSources + amt);
    }
  }
  const openingBank = sawBankLine ? bankFromLines : roundMoney(input.openingBank);
  const openingCash = sawCashLine ? cashFromLines : roundMoney(input.openingCash);
  const availableLiquidity = roundMoney(openingBank + openingCash);
  const gap = roundMoney(availableLiquidity + periodSources - obligations);
  return { openingBank, openingCash, availableLiquidity, periodSources, obligations, gap };
}

export type SuggestedCashBudgetLine = {
  side: CashBudgetSide;
  category: CashBudgetCategory;
  description: string;
  amount: number;
  dueDate?: string | null;
  originType: string;
  originId: string;
  projectId?: string | null;
  contractId?: string | null;
};

export type ExistingCashBudgetLine = SuggestedCashBudgetLine & {
  origin: CashBudgetOrigin;
  excluded?: boolean;
  isDeleted?: boolean;
};

export function originKey(originType: string, originId: string): string {
  return `${originType}:${originId}`;
}

/** Refresh auto lines; keep manual rows and excluded flags on matching auto origins. */
export function mergeSuggestedLines(
  existing: ExistingCashBudgetLine[],
  suggested: SuggestedCashBudgetLine[],
): Array<SuggestedCashBudgetLine & { origin: CashBudgetOrigin; excluded: boolean }> {
  const prevAuto = new Map<string, ExistingCashBudgetLine>();
  for (const row of existing) {
    if (row.isDeleted) continue;
    if (row.origin === 'auto' && row.originType && row.originId) {
      prevAuto.set(originKey(row.originType, row.originId), row);
    }
  }
  const auto = suggested.map((s) => {
    const prev = prevAuto.get(originKey(s.originType, s.originId));
    return { ...s, origin: 'auto' as const, excluded: prev?.excluded === true };
  });
  const manual = existing
    .filter((row) => !row.isDeleted && row.origin === 'manual')
    .map((row) => ({
      ...row,
      origin: 'manual' as const,
      excluded: row.excluded === true,
    }));
  return [...auto, ...manual];
}

export function isEightDigitLeafCode(code: string): boolean {
  return /^\d{8}$/.test(String(code ?? '').trim());
}

export function isCustodyCashLeafCode(code: string): boolean {
  const c = String(code ?? '').trim();
  return isEightDigitLeafCode(c) && c.startsWith('12102');
}

export function isBankLeafCode(code: string): boolean {
  const c = String(code ?? '').trim();
  return isEightDigitLeafCode(c) && c.startsWith('12101');
}

export function isClientReceivableLeafCode(code: string): boolean {
  const c = String(code ?? '').trim();
  return isEightDigitLeafCode(c) && c.startsWith('12201');
}

export function isSupplierLeafCode(code: string): boolean {
  const c = String(code ?? '').trim();
  return isEightDigitLeafCode(c) && c.startsWith('21101');
}

export function isSubcontractorLeafCode(code: string): boolean {
  const c = String(code ?? '').trim();
  return isEightDigitLeafCode(c) && c.startsWith('21102');
}

export function isSalariesPayableLeafCode(code: string): boolean {
  const c = String(code ?? '').trim();
  return isEightDigitLeafCode(c) && c.startsWith('21501');
}

/** Liability payable = credit net (what we owe). */
export function liabilityPayableAmount(netDebit: number): number {
  return roundMoney(Math.max(0, -roundMoney(netDebit)));
}
