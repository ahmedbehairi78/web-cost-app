import { MONEY_TOLERANCE, roundMoney } from './money';

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

export const SOURCE_CATEGORIES = ['opening_bank', 'opening_cash', 'opening_custody', 'collection', 'other'] as const;
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
    if (cat === 'opening_cash' || cat === 'opening_custody') {
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

export type CostCenterNet = {
  costCenterId: string | null;
  netDebit: number;
};

export type CostCenterPayable = {
  costCenterId: string | null;
  amount: number;
};

/**
 * Split an account payable across cost centers.
 * Example: ماي فارم 120,000 = كونكورد فيلا 50,000 + أركمن فيلا 70,000 → two rows.
 */
export function allocatePayableByCostCenter(rows: CostCenterNet[]): CostCenterPayable[] {
  let totalNet = 0;
  for (const row of rows) {
    totalNet = roundMoney(totalNet + roundMoney(row.netDebit));
  }
  const payable = liabilityPayableAmount(totalNet);
  if (payable <= 0) return [];

  const credits = rows
    .map((row) => ({
      costCenterId: String(row.costCenterId ?? '').trim() || null,
      amount: liabilityPayableAmount(row.netDebit),
    }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => String(a.costCenterId ?? '').localeCompare(String(b.costCenterId ?? '')));

  if (credits.length === 0) {
    return [{ costCenterId: null, amount: payable }];
  }

  const creditSum = credits.reduce((sum, row) => roundMoney(sum + row.amount), 0);
  if (Math.abs(creditSum - payable) <= MONEY_TOLERANCE) {
    return credits;
  }

  let allocated = 0;
  return credits
    .map((row, index) => {
      const isLast = index === credits.length - 1;
      const amount = isLast
        ? roundMoney(payable - allocated)
        : roundMoney((row.amount / creditSum) * payable);
      allocated = roundMoney(allocated + amount);
      return { costCenterId: row.costCenterId, amount };
    })
    .filter((row) => row.amount > 0);
}

export function glLeafOriginCode(originId: string | null | undefined): string {
  const head = String(originId ?? '').split('::')[0]?.trim() ?? '';
  return isEightDigitLeafCode(head) ? head : '';
}

export function isNamedCustodyAccount(name: string | null | undefined, nameEn?: string | null): boolean {
  const blob = `${name ?? ''} ${nameEn ?? ''}`;
  return /عهد/.test(blob) || /custod/i.test(blob);
}

export function isCustodyFundAccount(acc: {
  accountCode: string;
  minBalance?: unknown;
  accountName?: string | null;
  accountNameEn?: string | null;
}): boolean {
  if (!isCustodyCashLeafCode(acc.accountCode)) return false;
  if (roundMoney(Number(acc.minBalance) || 0) > 0) return true;
  return isNamedCustodyAccount(acc.accountName, acc.accountNameEn);
}

export function classifyCustodyAccountCodes(
  accounts: Array<{
    accountCode: string;
    minBalance?: unknown;
    accountName?: string | null;
    accountNameEn?: string | null;
  }>,
): Set<string> {
  const codes = new Set<string>();
  for (const acc of accounts) {
    const code = String(acc.accountCode ?? '').trim();
    if (isCustodyFundAccount({ ...acc, accountCode: code })) codes.add(code);
  }
  return codes;
}

/** Banks 12101 + treasury cash 12102, excluding custody funds and uncollected IPCs. */
export function distributableBankAndCashPool(
  lines: Array<{
    category?: string | null;
    amount: number;
    excluded?: boolean | null;
    originId?: string | null;
  }>,
  custodyCodes: Set<string>,
): number {
  let pool = 0;
  for (const line of lines) {
    if (line.excluded) continue;
    const cat = String(line.category ?? '');
    const amt = roundMoney(line.amount);
    if (cat === 'opening_bank') {
      pool = roundMoney(pool + amt);
      continue;
    }
    if (cat === 'opening_custody') continue;
    if (cat !== 'opening_cash') continue;
    const code = glLeafOriginCode(line.originId);
    if (code && custodyCodes.has(code)) continue;
    pool = roundMoney(pool + amt);
  }
  return pool;
}

export function accountGroupKey(line: {
  originType?: string | null;
  originId?: string | null;
  description?: string | null;
  category?: string | null;
}): string {
  const originType = String(line.originType ?? '');
  if (originType === 'gl_leaf') {
    const code = glLeafOriginCode(line.originId);
    if (code) return `gl:${code}`;
  }
  if (originType === 'custody_min') {
    return `custody:${line.originId || line.description || ''}`;
  }
  return `desc:${String(line.description ?? '').trim()}`;
}

export type AllocatableCashBudgetLine = {
  id: string;
  side?: string;
  category?: string | null;
  amount: number;
  excluded?: boolean | null;
  originType?: string | null;
  originId?: string | null;
  description?: string | null;
};

/**
 * After approve: split banks + treasury cash across obligation *accounts* by balance weight,
 * then split each account share across its cost-center rows.
 * Skips custody replenish lines.
 */
export function distributePoolByAccountWeight(
  lines: AllocatableCashBudgetLine[],
  pool: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const pooled = roundMoney(Math.max(0, pool));
  const eligible = lines.filter((line) => {
    if (line.excluded) return false;
    if (line.side && line.side !== 'obligation') return false;
    if (String(line.category ?? '') === 'custody_replenish') return false;
    return roundMoney(line.amount) > 0;
  });

  for (const line of lines) out.set(line.id, 0);
  if (eligible.length === 0 || pooled <= 0) return out;

  const groups = new Map<string, AllocatableCashBudgetLine[]>();
  for (const line of eligible) {
    const key = accountGroupKey(line);
    const rows = groups.get(key) ?? [];
    rows.push(line);
    groups.set(key, rows);
  }

  const groupList = [...groups.entries()]
    .map(([key, rows]) => ({
      key,
      rows: [...rows].sort((a, b) => a.id.localeCompare(b.id)),
      weight: roundMoney(rows.reduce((sum, row) => roundMoney(sum + roundMoney(row.amount)), 0)),
    }))
    .filter((group) => group.weight > 0)
    .sort((a, b) => a.key.localeCompare(b.key));

  const totalWeight = roundMoney(groupList.reduce((sum, group) => roundMoney(sum + group.weight), 0));
  if (totalWeight <= 0) return out;

  let allocatedGroups = 0;
  groupList.forEach((group, groupIndex) => {
    const isLastGroup = groupIndex === groupList.length - 1;
    const groupShare = isLastGroup
      ? roundMoney(pooled - allocatedGroups)
      : roundMoney((group.weight / totalWeight) * pooled);
    allocatedGroups = roundMoney(allocatedGroups + groupShare);

    let allocatedLines = 0;
    group.rows.forEach((row, rowIndex) => {
      const isLast = rowIndex === group.rows.length - 1;
      const share = isLast
        ? roundMoney(groupShare - allocatedLines)
        : roundMoney((roundMoney(row.amount) / group.weight) * groupShare);
      allocatedLines = roundMoney(allocatedLines + share);
      out.set(row.id, share);
    });
  });

  return out;
}
