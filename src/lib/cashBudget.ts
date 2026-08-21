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

export function lineCostCenterId(line: {
  contractId?: string | null;
  originId?: string | null;
}): string | null {
  const fromField = String(line.contractId ?? '').trim();
  if (fromField && fromField !== '_') return fromField;
  const origin = String(line.originId ?? '');
  const sep = origin.indexOf('::');
  if (sep < 0) return null;
  const tail = origin.slice(sep + 2).trim();
  return tail && tail !== '_' ? tail : null;
}

export function isBlankBudgetLabel(name: string | null | undefined): boolean {
  const s = String(name ?? '').trim();
  return !s || s === '—' || s === '-';
}

/** Group unlabeled project rows together even when contract ids differ. */
export function budgetProjectGroupKey(line: {
  projectId?: string | null;
  contractId?: string | null;
  originId?: string | null;
  costCenterName?: string | null;
}): string {
  const projectId = String(line.projectId ?? '').trim();
  if (projectId) return `p:${projectId}`;
  const name = String(line.costCenterName ?? '').trim();
  if (isBlankBudgetLabel(name)) return '__none__';
  const cc = lineCostCenterId(line);
  if (cc) return `c:${cc}`;
  return `__name:${name}`;
}

const ACCOUNT_PREFIX_RE =
  /^(موردون|مقاولو باطن|رواتب مستحقة|بنك|خزينة \/ عهدة|خزينة \/ عهدة|مستخلصات تحت التحصيل|Suppliers|Subcontractors|Payroll|Bank|Treasury \/ custody|Uncollected IPCs)\s*[—–-]\s*/i;

/** Leaf name only: "مقاولو باطن — مقاولو الباطن - ماي فارم (21102002)" → "ماي فارم". */
export function subAccountLabel(raw: string | null | undefined, code = ''): string {
  let s = String(raw ?? '').trim();
  if (code) s = s.replace(new RegExp(`\\s*\\(${code}\\)\\s*$`), '');
  s = s.replace(/\s*\(\d{8}\)\s*$/, '');
  s = s.replace(ACCOUNT_PREFIX_RE, '');
  const parts = s.split(/\s+[—–-]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) s = parts[parts.length - 1];
  return s.trim() || code || String(raw ?? '').trim();
}

export function isNamedCustodyAccount(name: string | null | undefined, nameEn?: string | null): boolean {
  const blob = `${name ?? ''} ${nameEn ?? ''}`;
  return /عهد/.test(blob) || /custod/i.test(blob);
}

/** Every 12102 leaf is a cash/custody fund — never bank cash for supplier settlement. */
export function isCustodyFundAccount(acc: {
  accountCode: string;
  minBalance?: unknown;
  accountName?: string | null;
  accountNameEn?: string | null;
}): boolean {
  return isCustodyCashLeafCode(acc.accountCode);
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

/** Banks 12101 only. 12102 cash/custody and 12201 IPCs are never in the settlement pool. */
export function distributableBankAndCashPool(
  lines: Array<{
    category?: string | null;
    amount: number;
    excluded?: boolean | null;
    originId?: string | null;
  }>,
  _custodyCodes?: Set<string>,
): number {
  let pool = 0;
  for (const line of lines) {
    if (line.excluded) continue;
    const cat = String(line.category ?? '');
    const amt = roundMoney(line.amount);
    const code = glLeafOriginCode(line.originId);
    if (code && (isCustodyCashLeafCode(code) || isClientReceivableLeafCode(code))) continue;
    if (cat === 'opening_cash' || cat === 'opening_custody' || cat === 'collection') continue;
    if (cat === 'opening_bank') pool = roundMoney(pool + amt);
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

/** 0–100. Invalid / empty → 100. */
export function clampSettlementPct(value: unknown): number {
  if (value == null || value === '') return 100;
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return roundMoney(Math.min(100, Math.max(0, n)));
}

export function obligationPayTarget(obligationTotal: number, settlementPct: unknown): number {
  const pct = clampSettlementPct(settlementPct);
  return roundMoney((Math.max(0, roundMoney(obligationTotal)) * pct) / 100);
}

/** Cash to allocate: min(banks, obligations × settlement%). */
export function settlementCashPool(
  availableBankAndCash: number,
  obligationTotal: number,
  settlementPct: unknown = 100,
): number {
  return roundMoney(Math.min(
    Math.max(0, roundMoney(availableBankAndCash)),
    obligationPayTarget(obligationTotal, settlementPct),
  ));
}

/**
 * After approve (and live preview): pay the chosen % of obligations from banks 12101.
 * If cash ≥ target, each line gets its share of the target (full line when pct = 100).
 * If cash is short, split available cash by account weight, then by cost-center rows.
 */
export function distributePoolByAccountWeight(
  lines: AllocatableCashBudgetLine[],
  pool: number,
  settlementPct: unknown = 100,
): Map<string, number> {
  const out = new Map<string, number>();
  const eligible = lines.filter((line) => {
    if (line.excluded) return false;
    if (line.side && line.side !== 'obligation') return false;
    return roundMoney(line.amount) > 0;
  });

  for (const line of lines) out.set(line.id, 0);
  if (eligible.length === 0) return out;

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
  const pooled = settlementCashPool(pool, totalWeight, settlementPct);
  if (totalWeight <= 0 || pooled <= 0) return out;

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

export function allocationSharePct(part: number, whole: number): number {
  const denom = roundMoney(whole);
  if (denom <= 0) return 0;
  return roundMoney((roundMoney(part) / denom) * 100);
}

export type CostCenterAllocationTotal = {
  key: string;
  name: string;
  nameEn: string;
  obligation: number;
  allocated: number;
  pct: number;
};

export function summarizeAllocationByCostCenter(
  lines: Array<{
    side?: string | null;
    excluded?: boolean | null;
    amount: number;
    allocatedCash?: number | null;
    costCenterName?: string | null;
    costCenterNameEn?: string | null;
    projectId?: string | null;
    contractId?: string | null;
    originId?: string | null;
  }>,
  pool = 0,
): CostCenterAllocationTotal[] {
  const map = new Map<string, Omit<CostCenterAllocationTotal, 'pct'>>();
  for (const line of lines) {
    if (line.side && line.side !== 'obligation') continue;
    if (line.excluded) continue;
    const name = String(line.costCenterName ?? '').trim();
    const nameEn = String(line.costCenterNameEn ?? '').trim() || name;
    const key = budgetProjectGroupKey(line);
    const cur = map.get(key) ?? {
      key,
      name: name || '—',
      nameEn: nameEn || '—',
      obligation: 0,
      allocated: 0,
    };
    if (name) cur.name = name;
    if (nameEn) cur.nameEn = nameEn;
    cur.obligation = roundMoney(cur.obligation + roundMoney(line.amount));
    cur.allocated = roundMoney(cur.allocated + roundMoney(line.allocatedCash ?? 0));
    map.set(key, cur);
  }
  const rows = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const denom = roundMoney(pool) > 0
    ? roundMoney(pool)
    : rows.reduce((sum, row) => roundMoney(sum + row.allocated), 0);
  return rows.map((row) => ({ ...row, pct: allocationSharePct(row.allocated, denom) }));
}
