import { journalDateKey, isJournalDateInRange } from './journalFilters';
import { resolveEntryCostCenterId } from './costCenterAttribution';
import {
  isLegacyMaterialPurchaseExpenseTransaction,
  isWarehouseReceiptTransaction,
  sumEntryOperatingExpense,
  sumTransactionOperatingExpense,
  type OperatingExpenseMode,
} from './operatingExpenseFromGl';
import {
  cashAndBankBalanceFromGlTxs,
  computeLiquidityContractRow,
  computePortfolioPendingBilling,
  contractCountByProject,
  dashboardIpcCollectionAmountForTx,
  receivablesBalanceFromGlTxs,
  type LiquidityBillingSlice,
  type LiquidityContractSlice,
  type LiquidityGlTxSlice,
} from './liquidityMetrics';

export type DashboardDatePreset = 'month' | 'quarter' | 'year' | 'all';

export interface DashboardFilterState {
  dateFrom: string;
  dateTo: string;
  projectId: string; // 'all' | id
  contractId: string; // '' | id
}

export interface DashboardTxSlice extends LiquidityGlTxSlice {
  id?: string;
  date?: unknown;
  description?: string;
  isDeleted?: boolean;
  journalKind?: string | null;
}

/** Year-end / opening memo journals — keep operational Dashboard costs visible after close. */
export function isFiscalMemoJournal(tx: {
  journalKind?: string | null;
  reference?: string | null;
}): boolean {
  const kind = String(tx.journalKind ?? '').trim();
  if (kind === 'fiscal_pl_close' || kind === 'fiscal_opening') return true;
  const ref = String(tx.reference ?? '').trim();
  return ref.startsWith('YE-PL-') || ref.startsWith('OPEN-');
}

/**
 * Attribute operating expense per journal line so OHA (Dr 512 contracts / Cr 521 pool)
 * moves cost from «unallocated» onto projects instead of netting the whole tx to 0.
 */
export function accumulateOperatingExpenseBuckets(
  tx: DashboardTxSlice,
  expenseMode: OperatingExpenseMode,
  projectIdByContract: Map<string, string>,
): { byProject: Map<string, number>; unallocated: number; total: number } {
  const byProject = new Map<string, number>();
  let unallocated = 0;
  let total = 0;
  const entries = tx.entries;
  if (!entries?.length) return { byProject, unallocated, total };
  if (isWarehouseReceiptTransaction(entries as Parameters<typeof isWarehouseReceiptTransaction>[0])) {
    return { byProject, unallocated, total };
  }
  if (
    expenseMode === 'local' &&
    isLegacyMaterialPurchaseExpenseTransaction(
      entries as Parameters<typeof isLegacyMaterialPurchaseExpenseTransaction>[0],
    )
  ) {
    return { byProject, unallocated, total };
  }

  const headerProject = String(tx.projectId ?? '').trim();

  for (const entry of entries) {
    const amount = sumEntryOperatingExpense(
      entry as Parameters<typeof sumEntryOperatingExpense>[0],
      expenseMode,
      tx.costCenterId,
      'all',
    );
    if (Math.abs(amount) < 0.000001) continue;
    total += amount;

    // Prefer line/header cost center → contract project; fall back to tx.projectId.
    // (Header project alone would mis-attribute OHA pool credits and split journals.)
    const cc = resolveEntryCostCenterId(entry, tx.costCenterId);
    const pid = (cc && projectIdByContract.get(cc)) || headerProject || '';
    if (pid) byProject.set(pid, (byProject.get(pid) ?? 0) + amount);
    else unallocated += amount;
  }

  return { byProject, unallocated, total };
}

export interface DashboardProjectSlice {
  id: string;
  projectName?: string;
  boqValue?: number;
  voValue?: number;
}

export interface DashboardBoqSlice {
  projectId: string;
  contractId?: string;
  tenderAmount?: number;
  isDeleted?: boolean;
}

export interface DashboardBillingEventSlice extends LiquidityBillingSlice {
  id?: string;
  date?: string;
  projectId?: string;
  billingNumber?: string;
  isDeleted?: boolean;
}

export interface MonthlySeriesPoint {
  key: string;
  name: string;
  /** `null` on periods without movement — the line skips to the next one. */
  revenue: number | null;
  cost: number | null;
  collections: number | null;
  cumulativeRevenue: number;
  cumulativeCost: number;
  cumulativeCollections: number;
}

export interface PeriodMoneyStats {
  totalBudget: number;
  totalSpent: number;
  totalCollected: number;
  pendingBilling: number;
  cashBanks: number;
  billed: number;
  advances: number;
}

export interface ProjectCompareRow {
  projectId: string;
  projectName: string;
  budget: number;
  spent: number;
  billed: number;
  ipcCollected: number;
  advances: number;
  retention: number;
  uncollected: number;
  collectionPct: number;
  cashBanks: number;
  /** Billed ÷ budget × 100 (same as Projects module). */
  progressPct: number;
  progressStatus: 'not_started' | 'running' | 'done';
  /** Synthetic row for GL opex without project/contract attribution (G&A / HQ). */
  isUnallocated?: boolean;
}

/** Materials (`boq_actual_costs` cost_element=materials) for Dashboard spent alignment. */
export interface MaterialSpentSlice {
  contractId: string;
  projectId?: string;
  totalSpent: number;
  /** YYYY-MM when loaded with groupBy=month */
  month?: string;
  /** YYYY-MM-DD when loaded with groupBy=day */
  day?: string;
}

/** Synthetic compare-row id — not a real project; do not use as project filter. */
export const DASHBOARD_UNALLOCATED_PROJECT_ID = '__unallocated__';

export function resolveMaterialProjectId(
  row: MaterialSpentSlice,
  projectIdByContract: Map<string, string>,
): string {
  const fromRow = String(row.projectId ?? '').trim();
  if (fromRow) return fromRow;
  return projectIdByContract.get(String(row.contractId ?? '').trim()) ?? '';
}

export function sumMaterialSpent(
  rows: MaterialSpentSlice[],
  opts?: {
    projectIdFilter?: string;
    contractIdFilter?: string;
    projectIdByContract?: Map<string, string>;
  },
): number {
  const projectFilter = opts?.projectIdFilter && opts.projectIdFilter !== 'all' ? opts.projectIdFilter : '';
  const contractFilter = opts?.contractIdFilter?.trim() || '';
  const map = opts?.projectIdByContract ?? new Map<string, string>();
  let sum = 0;
  for (const row of rows) {
    if (contractFilter && row.contractId !== contractFilter) continue;
    if (projectFilter) {
      const pid = resolveMaterialProjectId(row, map);
      if (pid !== projectFilter) continue;
    }
    sum += Number(row.totalSpent) || 0;
  }
  return sum;
}

export function materialSpentByMonth(
  rows: MaterialSpentSlice[],
  opts?: {
    projectIdFilter?: string;
    contractIdFilter?: string;
    projectIdByContract?: Map<string, string>;
  },
): Map<string, number> {
  const projectFilter = opts?.projectIdFilter && opts.projectIdFilter !== 'all' ? opts.projectIdFilter : '';
  const contractFilter = opts?.contractIdFilter?.trim() || '';
  const map = opts?.projectIdByContract ?? new Map<string, string>();
  const out = new Map<string, number>();
  for (const row of rows) {
    // Prefer explicit month; else roll up from day key (groupBy=day responses).
    const month =
      String(row.month ?? '').trim().slice(0, 7) ||
      String(row.day ?? '').trim().slice(0, 7);
    if (!month || month.length < 7) continue;
    if (contractFilter && row.contractId !== contractFilter) continue;
    if (projectFilter) {
      const pid = resolveMaterialProjectId(row, map);
      if (pid !== projectFilter) continue;
    }
    out.set(month, (out.get(month) ?? 0) + (Number(row.totalSpent) || 0));
  }
  return out;
}

export function materialSpentByDay(
  rows: MaterialSpentSlice[],
  opts?: {
    projectIdFilter?: string;
    contractIdFilter?: string;
    projectIdByContract?: Map<string, string>;
  },
): Map<string, number> {
  const projectFilter = opts?.projectIdFilter && opts.projectIdFilter !== 'all' ? opts.projectIdFilter : '';
  const contractFilter = opts?.contractIdFilter?.trim() || '';
  const map = opts?.projectIdByContract ?? new Map<string, string>();
  const out = new Map<string, number>();
  for (const row of rows) {
    const day = String(row.day ?? '').trim().slice(0, 10);
    if (!day || day.length < 10) continue;
    if (contractFilter && row.contractId !== contractFilter) continue;
    if (projectFilter) {
      const pid = resolveMaterialProjectId(row, map);
      if (pid !== projectFilter) continue;
    }
    out.set(day, (out.get(day) ?? 0) + (Number(row.totalSpent) || 0));
  }
  return out;
}

export function materialSpentByProject(
  rows: MaterialSpentSlice[],
  opts?: {
    contractIdFilter?: string;
    projectIdByContract?: Map<string, string>;
  },
): Map<string, number> {
  const contractFilter = opts?.contractIdFilter?.trim() || '';
  const map = opts?.projectIdByContract ?? new Map<string, string>();
  const out = new Map<string, number>();
  for (const row of rows) {
    if (contractFilter && row.contractId !== contractFilter) continue;
    const pid = resolveMaterialProjectId(row, map);
    if (!pid) continue;
    out.set(pid, (out.get(pid) ?? 0) + (Number(row.totalSpent) || 0));
  }
  return out;
}

/** Approved MOS certificate / extract amounts for completed-works pie & progress. */
export interface DashboardMosClaimSlice {
  contractId: string;
  status?: string;
  /** Certificate header total (preferred). */
  totalClaimed?: number;
  /** Legacy per-line extract amount. */
  claimedAmount?: number;
}

export interface ContractProgressPieSlice {
  contractId: string;
  projectId: string;
  projectName: string;
  name: string;
  /** Completed works: interim/final billed + approved MOS claimed. */
  completedValue: number;
  /** Share of completed works in current pie scope (all contracts or one project). */
  sharePct: number;
  /** Contract progress vs its own budget (0–100). */
  progressPct: number;
  budget: number;
  color: string;
}

export interface ProjectProgressPieSlice {
  projectId: string;
  name: string;
  completedValue: number;
  sharePct: number;
  progressPct: number;
  budget: number;
  color: string;
}

/** High-contrast slice colors — assigned by pie order so neighbors never clash. */
export const PROJECT_PIE_PALETTE = [
  '#F58220', // Concord orange
  '#003B71', // Concord navy
  '#0D9488', // teal
  '#E11D48', // rose
  '#2563EB', // blue
  '#CA8A04', // gold
  '#475569', // slate
  '#0891B2', // cyan
  '#C2410C', // deep orange
  '#1D4ED8', // royal blue
  '#059669', // emerald
  '#9A3412', // rust
] as const;

export function projectPieColor(projectId: string, fallbackIndex = 0): string {
  return entityPieColor(projectId, fallbackIndex);
}

/** Sum approved MOS claimed amounts by contract (certificates or extracts). */
export function sumApprovedMosByContract(
  mos: DashboardMosClaimSlice[] | undefined | null,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!mos?.length) return map;
  for (const m of mos) {
    const status = String(m.status || '').trim();
    if (status && status !== 'approved') continue;
    const cid = String(m.contractId || '').trim();
    if (!cid) continue;
    const amount = Number(m.totalClaimed ?? m.claimedAmount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    map.set(cid, (map.get(cid) ?? 0) + amount);
  }
  return map;
}

/** Stable color for a contract (or any entity id). */
export function entityPieColor(entityId: string, fallbackIndex = 0): string {
  const id = String(entityId || '');
  if (!id) return PROJECT_PIE_PALETTE[fallbackIndex % PROJECT_PIE_PALETTE.length];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PROJECT_PIE_PALETTE[(hash + fallbackIndex) % PROJECT_PIE_PALETTE.length];
}

/** Distinct color per slice index (use after sorting the pie list). */
export function pieSliceColorByIndex(index: number): string {
  return PROJECT_PIE_PALETTE[index % PROJECT_PIE_PALETTE.length];
}

export const contractPieColor = entityPieColor;

function progressStatusFromPct(pct: number): ProjectCompareRow['progressStatus'] {
  if (pct >= 99.9) return 'done';
  if (pct <= 0.05) return 'not_started';
  return 'running';
}

function safePct(num: number, denom: number): number {
  return denom > 0 ? (num / denom) * 100 : 0;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseYmd(s: string): Date | null {
  const key = s.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

/** Inclusive calendar-day span between two YYYY-MM-DD strings. */
export function inclusiveDaySpan(dateFrom: string, dateTo: string): number {
  const a = parseYmd(dateFrom);
  const b = parseYmd(dateTo);
  if (!a || !b) return 0;
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.round(ms / 86400000)) + 1;
}

/** Previous period of the same length ending the day before `dateFrom`. */
export function previousPeriodRange(
  dateFrom: string,
  dateTo: string,
): { dateFrom: string; dateTo: string } {
  const from = parseYmd(dateFrom);
  const span = inclusiveDaySpan(dateFrom, dateTo);
  if (!from || span <= 0) return { dateFrom: '', dateTo: '' };
  const prevTo = new Date(from);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (span - 1));
  return { dateFrom: toYmd(prevFrom), dateTo: toYmd(prevTo) };
}

export function resolveDatePreset(
  preset: DashboardDatePreset,
  today: Date = new Date(),
): { dateFrom: string; dateTo: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const to = toYmd(today);
  if (preset === 'all') return { dateFrom: '', dateTo: '' };
  if (preset === 'month') {
    return { dateFrom: `${y}-${pad2(m + 1)}-01`, dateTo: to };
  }
  if (preset === 'quarter') {
    const qStart = Math.floor(m / 3) * 3;
    return { dateFrom: `${y}-${pad2(qStart + 1)}-01`, dateTo: to };
  }
  return { dateFrom: `${y}-01-01`, dateTo: to };
}

export function percentDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (Math.abs(previous) < 0.005) {
    if (Math.abs(current) < 0.005) return 0;
    return null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function defaultDashboardFilters(today: Date = new Date()): DashboardFilterState {
  const range = resolveDatePreset('year', today);
  return {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo || toYmd(today),
    projectId: 'all',
    contractId: '',
  };
}

function matchesProjectContract(
  tx: { projectId?: string | null; costCenterId?: string | null },
  filters: Pick<DashboardFilterState, 'projectId' | 'contractId'>,
  projectIdByContractId: Map<string, string>,
): boolean {
  if (filters.contractId) {
    return String(tx.costCenterId ?? '') === filters.contractId;
  }
  if (filters.projectId && filters.projectId !== 'all') {
    const pid = String(tx.projectId ?? '').trim();
    if (pid === filters.projectId) return true;
    const viaCc = projectIdByContractId.get(String(tx.costCenterId ?? ''));
    return viaCc === filters.projectId;
  }
  return true;
}

export function filterDashboardTransactions<T extends DashboardTxSlice>(
  txs: T[],
  filters: DashboardFilterState,
  projectIdByContractId: Map<string, string>,
): T[] {
  const hasDate = !!(filters.dateFrom.trim() || filters.dateTo.trim());
  return txs.filter((tx) => {
    if (tx.isDeleted) return false;
    if (hasDate && !isJournalDateInRange(tx.date, filters.dateFrom, filters.dateTo)) return false;
    return matchesProjectContract(tx, filters, projectIdByContractId);
  });
}

export function filterDashboardBilling<T extends DashboardBillingEventSlice>(
  bills: T[],
  filters: DashboardFilterState,
  projectIdByContractId: Map<string, string>,
): T[] {
  const hasDate = !!(filters.dateFrom.trim() || filters.dateTo.trim());
  return bills.filter((b) => {
    if (b.isDeleted) return false;
    if (filters.contractId && b.contractId !== filters.contractId) return false;
    if (filters.projectId && filters.projectId !== 'all') {
      const pid =
        String(b.projectId ?? '').trim() ||
        projectIdByContractId.get(String(b.contractId ?? '')) ||
        '';
      if (pid !== filters.projectId) return false;
    }
    if (hasDate && b.date && !isJournalDateInRange(b.date, filters.dateFrom, filters.dateTo)) {
      return false;
    }
    return true;
  });
}

export function buildContractProjectMap(
  contracts: LiquidityContractSlice[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of contracts) {
    map.set(String(c.id), String(c.projectId));
  }
  return map;
}

export type CashFlowGrain = 'month' | 'day';

function periodKeyFromTxDate(date: unknown, grain: CashFlowGrain): string {
  const full = journalDateKey(date);
  if (!full) return '';
  return grain === 'day' ? full.slice(0, 10) : full.slice(0, 7);
}

function periodLabel(key: string, grain: CashFlowGrain, locale: string): string {
  if (grain === 'day') {
    const d = parseYmd(key) ?? new Date(`${key}T12:00:00`);
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  }
  const d = parseYmd(`${key}-01`) ?? new Date(`${key}-01T12:00:00`);
  return d.toLocaleDateString(locale, { month: 'short', year: '2-digit' });
}

/** Max zero-filled points kept on the cash-flow chart (~2 years of days). */
export const MAX_CASH_FLOW_POINTS = 760;

function normalizePeriodKey(raw: string | undefined, grain: CashFlowGrain): string {
  const key = String(raw ?? '').trim();
  if (!key) return '';
  return grain === 'day' ? key.slice(0, 10) : key.slice(0, 7);
}

/** Every period key from `start` to `end` inclusive — gives a continuous curve. */
function enumeratePeriodKeys(
  start: string,
  end: string,
  grain: CashFlowGrain,
  max = MAX_CASH_FLOW_POINTS,
): string[] {
  const keys: string[] = [];
  if (!start || !end || start > end) return keys;
  if (grain === 'day') {
    const from = parseYmd(start);
    const to = parseYmd(end);
    if (!from || !to) return keys;
    const cursor = new Date(from);
    while (cursor <= to && keys.length < max) {
      keys.push(toYmd(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return keys;
  }
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return keys;
  let key = `${year}-${pad2(month)}`;
  while (key <= end && keys.length < max) {
    keys.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    key = `${year}-${pad2(month)}`;
  }
  return keys;
}

/**
 * Period (month or day) cost / revenue / collections.
 * Points are **not** a running total — each key is that period’s own total so the
 * curve rises when a month is higher than the previous and falls when lower.
 * Always prepends an origin at **0** (`__start__`) so every line begins at zero.
 * With `dateFrom`/`dateTo` every period appears on the axis; idle metrics emit
 * `null` — draw with `connectNulls` so the line jumps to the next movement
 * instead of dipping through zero on empty months.
 */
export function buildCashFlowSeries(
  txs: DashboardTxSlice[],
  allTxsForChequePairing: LiquidityGlTxSlice[],
  locale: string,
  expenseMode: OperatingExpenseMode,
  options?: {
    grain?: CashFlowGrain;
    /** Materials by YYYY-MM or YYYY-MM-DD matching `grain`. */
    materialByPeriod?: Map<string, number> | Record<string, number>;
    /** Period window (YYYY-MM-DD) — every period in it appears on the axis. */
    dateFrom?: string;
    dateTo?: string;
    /** Prepend a zero origin so lines start at 0 (cash-flow chart). */
    includeOrigin?: boolean;
    /** Label for the leading zero point (default: locale-based Start / بداية). */
    originLabel?: string;
  },
): MonthlySeriesPoint[] {
  const grain = options?.grain ?? 'month';
  const materialByPeriod = options?.materialByPeriod;
  interface PeriodBucket {
    name: string;
    revenue: number;
    cost: number;
    collections: number;
    /** Which metrics actually moved — untouched ones emit `null` (no dip to 0). */
    moved: { revenue: boolean; cost: boolean; collections: boolean };
  }
  const periodMap: Record<string, PeriodBucket> = {};

  const ensurePeriod = (key: string) => {
    if (periodMap[key]) return;
    periodMap[key] = {
      name: periodLabel(key, grain, locale),
      revenue: 0,
      cost: 0,
      collections: 0,
      moved: { revenue: false, cost: false, collections: false },
    };
  };

  for (const tx of txs) {
    if (!tx.entries?.length) continue;
    if (isFiscalMemoJournal(tx)) continue;
    const key = periodKeyFromTxDate(tx.date, grain);
    if (!key || (grain === 'month' ? key.length < 7 : key.length < 10)) continue;
    ensurePeriod(key);

    const expense = sumTransactionOperatingExpense(
      tx.entries as Parameters<typeof sumTransactionOperatingExpense>[0],
      expenseMode,
    );
    // Include credits (OHA pool / reversals) so period cost can decrease.
    if (Math.abs(expense) > 0.000001) {
      periodMap[key].cost += expense;
      periodMap[key].moved.cost = true;
    }

    for (const e of tx.entries) {
      if (String(e.accountCode ?? '').trim().startsWith('4')) {
        periodMap[key].revenue += Number(e.credit || 0) - Number(e.debit || 0);
        periodMap[key].moved.revenue = true;
      }
    }

    const ipc = dashboardIpcCollectionAmountForTx(tx, allTxsForChequePairing);
    if (ipc > 0) {
      periodMap[key].collections += ipc;
      periodMap[key].moved.collections = true;
    }
  }

  if (materialByPeriod) {
    const entries =
      materialByPeriod instanceof Map
        ? materialByPeriod.entries()
        : Object.entries(materialByPeriod);
    for (const [period, amount] of entries) {
      const key =
        grain === 'day' ? String(period).slice(0, 10) : String(period).slice(0, 7);
      const add = Number(amount) || 0;
      if (!key || add === 0) continue;
      if (grain === 'day' ? key.length < 10 : key.length < 7) continue;
      ensurePeriod(key);
      periodMap[key].cost += add;
      periodMap[key].moved.cost = true;
    }
  }

  const observed = Object.keys(periodMap).sort();
  const fillStart = normalizePeriodKey(options?.dateFrom, grain) || observed[0] || '';
  const fillEnd = normalizePeriodKey(options?.dateTo, grain) || observed[observed.length - 1] || '';
  for (const key of enumeratePeriodKeys(fillStart, fillEnd, grain)) ensurePeriod(key);

  const sorted = Object.keys(periodMap).sort();
  if (sorted.length === 0) return [];

  let runningRevenue = 0;
  let runningCost = 0;
  let runningCollections = 0;
  const points: MonthlySeriesPoint[] = sorted.map((key) => {
    const bucket = periodMap[key];
    runningRevenue += bucket.revenue;
    runningCost += bucket.cost;
    runningCollections += bucket.collections;
    return {
      key,
      name: bucket.name,
      revenue: bucket.moved.revenue ? bucket.revenue : null,
      cost: bucket.moved.cost ? bucket.cost : null,
      collections: bucket.moved.collections ? bucket.collections : null,
      // Kept for callers/tests; cash-flow chart uses period fields only.
      cumulativeRevenue: runningRevenue,
      cumulativeCost: runningCost,
      cumulativeCollections: runningCollections,
    };
  });

  if (!options?.includeOrigin) return points;

  const originLabel =
    options?.originLabel?.trim() ||
    (String(locale).toLowerCase().startsWith('ar') ? 'بداية' : 'Start');

  return [
    {
      key: '__start__',
      name: originLabel,
      revenue: 0,
      cost: 0,
      collections: 0,
      cumulativeRevenue: 0,
      cumulativeCost: 0,
      cumulativeCollections: 0,
    },
    ...points,
  ];
}

/** @deprecated Prefer `buildCashFlowSeries` — monthly grain wrapper. */
export function buildMonthlySeries(
  txs: DashboardTxSlice[],
  allTxsForChequePairing: LiquidityGlTxSlice[],
  locale: string,
  expenseMode: OperatingExpenseMode,
  materialByMonth?: Map<string, number> | Record<string, number>,
): MonthlySeriesPoint[] {
  return buildCashFlowSeries(txs, allTxsForChequePairing, locale, expenseMode, {
    grain: 'month',
    materialByPeriod: materialByMonth,
  });
}

export function buildDailySeries(
  txs: DashboardTxSlice[],
  allTxsForChequePairing: LiquidityGlTxSlice[],
  locale: string,
  expenseMode: OperatingExpenseMode,
  materialByDay?: Map<string, number> | Record<string, number>,
  range?: { dateFrom?: string; dateTo?: string },
): MonthlySeriesPoint[] {
  return buildCashFlowSeries(txs, allTxsForChequePairing, locale, expenseMode, {
    grain: 'day',
    materialByPeriod: materialByDay,
    dateFrom: range?.dateFrom,
    dateTo: range?.dateTo,
  });
}

export function computeDashboardPeriodStats(input: {
  projects: DashboardProjectSlice[];
  boqItems: DashboardBoqSlice[];
  contracts: LiquidityContractSlice[];
  billing: LiquidityBillingSlice[];
  filteredTxs: DashboardTxSlice[];
  allTxsForChequePairing: LiquidityGlTxSlice[];
  expenseMode: OperatingExpenseMode;
  materialSpentExtra?: number;
  projectIdFilter: string;
}): PeriodMoneyStats {
  const {
    projects,
    boqItems,
    contracts,
    billing,
    filteredTxs,
    allTxsForChequePairing,
    expenseMode,
    materialSpentExtra = 0,
    projectIdFilter,
  } = input;

  const scopedProjects =
    projectIdFilter && projectIdFilter !== 'all'
      ? projects.filter((p) => p.id === projectIdFilter)
      : projects;

  const totalBudget = scopedProjects.reduce((sum, p) => {
    const calculated = boqItems
      .filter((item) => item.projectId === p.id && !item.isDeleted)
      .reduce((s, item) => s + Number(item.tenderAmount || 0), 0);
    const boqValue = calculated > 0 ? calculated : Number(p.boqValue || 0);
    return sum + boqValue + Number(p.voValue || 0);
  }, 0);

  let totalSpent = 0;
  let totalCollected = 0;
  for (const tx of filteredTxs) {
    if (!tx.entries) continue;
    if (isFiscalMemoJournal(tx)) continue;
    totalSpent += sumTransactionOperatingExpense(
      tx.entries as Parameters<typeof sumTransactionOperatingExpense>[0],
      expenseMode,
    );
    totalCollected += dashboardIpcCollectionAmountForTx(tx, allTxsForChequePairing);
  }
  totalSpent += materialSpentExtra;

  const countMap = contractCountByProject(contracts);
  const glSlice = filteredTxs.map((tx) => ({
    costCenterId: tx.costCenterId,
    projectId: tx.projectId,
    reference: tx.reference,
    entries: tx.entries,
  }));
  const scopedContracts =
    projectIdFilter && projectIdFilter !== 'all'
      ? contracts.filter((c) => c.projectId === projectIdFilter)
      : contracts;
  const rows = scopedContracts.map((c) =>
    computeLiquidityContractRow(c, billing, glSlice, countMap),
  );
  const uncollectedSum = rows.reduce((s, r) => s + r.uncollected, 0);
  const advances = rows.reduce((s, r) => s + r.totalAdvances, 0);
  const billed = rows.reduce((s, r) => s + r.totalBilled, 0);
  const pendingBilling = computePortfolioPendingBilling(glSlice, uncollectedSum);
  const cashBanks = cashAndBankBalanceFromGlTxs(glSlice);

  return {
    totalBudget,
    totalSpent,
    totalCollected,
    pendingBilling,
    cashBanks,
    billed,
    advances,
  };
}

export function buildProjectCompareRows(input: {
  projects: DashboardProjectSlice[];
  boqItems: DashboardBoqSlice[];
  contracts: (LiquidityContractSlice & { contractName?: string; contractNumber?: string })[];
  billing: LiquidityBillingSlice[];
  filteredTxs: DashboardTxSlice[];
  allTxsForChequePairing: LiquidityGlTxSlice[];
  expenseMode: OperatingExpenseMode;
  projectIdFilter: string;
  contractIdFilter: string;
  /** Approved MOS claimed — added to progress billed (not liquidity KPI cards). */
  mosClaims?: DashboardMosClaimSlice[];
  /** Materials spent by project — same source as KPI materialSpentExtra. */
  materialByProject?: Map<string, number> | Record<string, number>;
  /** Label for synthetic unallocated G&A row (when project=all). */
  unallocatedLabel?: string;
}): ProjectCompareRow[] {
  const {
    projects,
    boqItems,
    contracts,
    billing,
    filteredTxs,
    expenseMode,
    projectIdFilter,
    contractIdFilter,
    mosClaims,
    materialByProject,
    unallocatedLabel,
  } = input;
  const mosByContract = sumApprovedMosByContract(mosClaims);

  let scopedContracts = contracts;
  if (contractIdFilter) {
    scopedContracts = contracts.filter((c) => c.id === contractIdFilter);
  } else if (projectIdFilter && projectIdFilter !== 'all') {
    scopedContracts = contracts.filter((c) => c.projectId === projectIdFilter);
  }

  const countMap = contractCountByProject(contracts);
  const glSlice = filteredTxs.map((tx) => ({
    costCenterId: tx.costCenterId,
    projectId: tx.projectId,
    reference: tx.reference,
    entries: tx.entries,
  }));

  const spentByProject = new Map<string, number>();
  const cashByProject = new Map<string, number>();
  const projectIdByContract = buildContractProjectMap(contracts);
  let unallocatedSpent = 0;

  for (const tx of filteredTxs) {
    if (!tx.entries?.length) continue;
    if (isFiscalMemoJournal(tx)) continue;

    const buckets = accumulateOperatingExpenseBuckets(tx, expenseMode, projectIdByContract);
    unallocatedSpent += buckets.unallocated;
    for (const [pid, amount] of buckets.byProject) {
      spentByProject.set(pid, (spentByProject.get(pid) ?? 0) + amount);
    }

    let pid = String(tx.projectId ?? '').trim();
    if (!pid && tx.costCenterId) {
      pid = projectIdByContract.get(String(tx.costCenterId)) ?? '';
    }
    if (!pid) continue;
    const cashNet = cashAndBankBalanceFromGlTxs([
      { projectId: tx.projectId, costCenterId: tx.costCenterId, entries: tx.entries },
    ]);
    if (Math.abs(cashNet) > 0.0001) {
      cashByProject.set(pid, (cashByProject.get(pid) ?? 0) + cashNet);
    }
  }

  if (materialByProject) {
    const entries =
      materialByProject instanceof Map
        ? materialByProject.entries()
        : Object.entries(materialByProject);
    for (const [pid, amount] of entries) {
      const id = String(pid).trim();
      const add = Number(amount) || 0;
      if (!id || add === 0) continue;
      spentByProject.set(id, (spentByProject.get(id) ?? 0) + add);
    }
  }

  const byProject = new Map<
    string,
    {
      billed: number;
      ipcCollected: number;
      advances: number;
      retention: number;
      uncollected: number;
    }
  >();

  for (const c of scopedContracts) {
    const row = computeLiquidityContractRow(c, billing, glSlice, countMap);
    const mosClaimed = mosByContract.get(c.id) ?? 0;
    const cur = byProject.get(c.projectId) ?? {
      billed: 0,
      ipcCollected: 0,
      advances: 0,
      retention: 0,
      uncollected: 0,
    };
    cur.billed += row.totalBilled + mosClaimed;
    cur.ipcCollected += row.ipcCollected;
    cur.advances += row.totalAdvances;
    cur.retention += row.totalRetention;
    cur.uncollected += row.uncollected;
    byProject.set(c.projectId, cur);
  }

  const projectIds = new Set<string>([
    ...scopedContracts.map((c) => c.projectId),
    ...(projectIdFilter && projectIdFilter !== 'all' ? [projectIdFilter] : []),
  ]);

  const scopedProjects =
    projectIds.size > 0
      ? projects.filter((p) => projectIds.has(p.id))
      : projectIdFilter && projectIdFilter !== 'all'
        ? projects.filter((p) => p.id === projectIdFilter)
        : projects;

  const rows: ProjectCompareRow[] = scopedProjects.map((p) => {
    const calculated = boqItems
      .filter((item) => item.projectId === p.id && !item.isDeleted)
      .reduce((s, item) => s + Number(item.tenderAmount || 0), 0);
    const budget =
      (calculated > 0 ? calculated : Number(p.boqValue || 0)) + Number(p.voValue || 0);
    const liq = byProject.get(p.id) ?? {
      billed: 0,
      ipcCollected: 0,
      advances: 0,
      retention: 0,
      uncollected: 0,
    };
    const collectionPct =
      liq.billed > 0 ? Math.round((liq.ipcCollected / liq.billed) * 1000) / 10 : 0;
    const progressPct = Math.round(safePct(liq.billed, budget) * 10) / 10;
    return {
      projectId: p.id,
      projectName: p.projectName || p.id,
      budget,
      spent: spentByProject.get(p.id) ?? 0,
      billed: liq.billed,
      ipcCollected: liq.ipcCollected,
      advances: liq.advances,
      retention: liq.retention,
      uncollected: liq.uncollected,
      collectionPct,
      cashBanks: cashByProject.get(p.id) ?? 0,
      progressPct,
      progressStatus: progressStatusFromPct(progressPct),
    };
  });

  // When viewing all projects, surface G&A / HQ opex so Σ spent reconciles with KPI/chart.
  if (
    (!projectIdFilter || projectIdFilter === 'all') &&
    !contractIdFilter &&
    Math.abs(unallocatedSpent) > 0.005
  ) {
    rows.push({
      projectId: DASHBOARD_UNALLOCATED_PROJECT_ID,
      projectName: unallocatedLabel || 'Unallocated / G&A',
      budget: 0,
      spent: unallocatedSpent,
      billed: 0,
      ipcCollected: 0,
      advances: 0,
      retention: 0,
      uncollected: 0,
      collectionPct: 0,
      cashBanks: 0,
      progressPct: 0,
      progressStatus: 'not_started',
      isUnallocated: true,
    });
  }

  return rows;
}

/** Pie by contract: all contracts when project=all; contracts of one project when filtered. */
export function buildContractProgressPieSlices(input: {
  projects: DashboardProjectSlice[];
  boqItems: DashboardBoqSlice[];
  contracts: (LiquidityContractSlice & { contractName?: string; contractNumber?: string })[];
  billing: LiquidityBillingSlice[];
  filteredTxs: DashboardTxSlice[];
  projectIdFilter: string;
  /** Ignored for pie scope — always show all contracts in the project (or all projects). */
  contractIdFilter?: string;
  /** Approved MOS claimed amounts (certificates / extracts) — included in completed works. */
  mosClaims?: DashboardMosClaimSlice[];
}): ContractProgressPieSlice[] {
  const {
    projects,
    boqItems,
    contracts,
    billing,
    filteredTxs,
    projectIdFilter,
    mosClaims,
  } = input;

  // Scope by project only (not by selected contract) so the pie shows the breakdown.
  const scopedContracts =
    projectIdFilter && projectIdFilter !== 'all'
      ? contracts.filter((c) => c.projectId === projectIdFilter)
      : contracts;

  const countMap = contractCountByProject(contracts);
  const mosByContract = sumApprovedMosByContract(mosClaims);
  const glSlice = filteredTxs.map((tx) => ({
    costCenterId: tx.costCenterId,
    projectId: tx.projectId,
    reference: tx.reference,
    entries: tx.entries,
  }));

  const projectNameById = new Map(projects.map((p) => [p.id, p.projectName || p.id]));
  const showProjectInLabel = !(projectIdFilter && projectIdFilter !== 'all');

  const rows = scopedContracts.map((c) => {
    const liq = computeLiquidityContractRow(c, billing, glSlice, countMap);
    const mosClaimed = mosByContract.get(c.id) ?? 0;
    const completedValue = liq.totalBilled + mosClaimed;
    const contractBoq = boqItems.filter((item) => {
      if (item.isDeleted) return false;
      if (item.contractId) return String(item.contractId) === c.id;
      return item.projectId === c.projectId;
    });
    let budget = contractBoq.reduce((s, item) => s + Number(item.tenderAmount || 0), 0);
    if (budget <= 0) {
      const projectBoq = boqItems
        .filter((item) => item.projectId === c.projectId && !item.isDeleted)
        .reduce((s, item) => s + Number(item.tenderAmount || 0), 0);
      const siblings = contracts.filter((x) => x.projectId === c.projectId).length || 1;
      budget = siblings === 1 ? projectBoq : 0;
    }
    const progressPct = Math.round(safePct(completedValue, budget) * 10) / 10;
    const projectName = projectNameById.get(c.projectId) || c.projectId;
    const contractLabel = c.contractNumber || c.contractName || c.id;
    const name = showProjectInLabel ? `${projectName} — ${contractLabel}` : contractLabel;
    return {
      contractId: c.id,
      projectId: c.projectId,
      projectName,
      name,
      completedValue,
      sharePct: 0,
      progressPct,
      budget,
      color: pieSliceColorByIndex(0),
    };
  });

  const totalCompleted = rows.reduce((s, r) => s + r.completedValue, 0);
  const withShare = rows.map((r) => ({
    ...r,
    sharePct: Math.round(safePct(r.completedValue, totalCompleted) * 10) / 10,
  }));

  const positive = withShare.filter((r) => r.completedValue > 0);
  // Prefer contracts with completed work; if none yet, keep scoped list (empty pie UI).
  const list = positive.length > 0 ? positive : withShare.filter((r) => r.completedValue > 0);
  return list
    .sort((a, b) => b.completedValue - a.completedValue)
    .map((s, i) => ({ ...s, color: pieSliceColorByIndex(i) }));
}

/** Pie slices by project: share of portfolio completed (billed) works. */
export function buildProjectProgressPieSlices(input: {
  projects: DashboardProjectSlice[];
  boqItems: DashboardBoqSlice[];
  contracts: (LiquidityContractSlice & { contractName?: string; contractNumber?: string })[];
  billing: LiquidityBillingSlice[];
  filteredTxs: DashboardTxSlice[];
  projectIdFilter: string;
  contractIdFilter: string;
}): ProjectProgressPieSlice[] {
  const contractSlices = buildContractProgressPieSlices(input);
  const byProject = new Map<
    string,
    { name: string; completedValue: number; budget: number }
  >();

  for (const s of contractSlices) {
    const cur = byProject.get(s.projectId) ?? {
      name: input.projects.find((p) => p.id === s.projectId)?.projectName || s.name,
      completedValue: 0,
      budget: 0,
    };
    cur.completedValue += s.completedValue;
    cur.budget += s.budget;
    // Prefer project display name when available
    const pname = input.projects.find((p) => p.id === s.projectId)?.projectName;
    if (pname) cur.name = pname;
    byProject.set(s.projectId, cur);
  }

  // Include projects in scope that have budget but zero billed (still show when few projects)
  let scopedProjects = input.projects;
  if (input.projectIdFilter && input.projectIdFilter !== 'all') {
    scopedProjects = input.projects.filter((p) => p.id === input.projectIdFilter);
  } else if (input.contractIdFilter) {
    const cid = input.contracts.find((c) => c.id === input.contractIdFilter)?.projectId;
    scopedProjects = cid ? input.projects.filter((p) => p.id === cid) : scopedProjects;
  }

  for (const p of scopedProjects) {
    if (byProject.has(p.id)) continue;
    const budget = input.boqItems
      .filter((item) => item.projectId === p.id && !item.isDeleted)
      .reduce((s, item) => s + Number(item.tenderAmount || 0), 0);
    if (budget <= 0 && scopedProjects.length > 6) continue;
    byProject.set(p.id, {
      name: p.projectName || p.id,
      completedValue: 0,
      budget: budget + Number(p.voValue || 0),
    });
  }

  const rows = [...byProject.entries()].map(([projectId, v], index) => ({
    projectId,
    name: v.name,
    completedValue: v.completedValue,
    budget: v.budget,
    progressPct: Math.round(safePct(v.completedValue, v.budget) * 10) / 10,
    sharePct: 0,
    color: projectPieColor(projectId, index),
  }));

  const totalCompleted = rows.reduce((s, r) => s + r.completedValue, 0);
  const withShare = rows.map((r) => ({
    ...r,
    sharePct: Math.round(safePct(r.completedValue, totalCompleted) * 10) / 10,
  }));

  // Prefer slices with completed work; if none, keep scoped projects for empty-state UI
  const positive = withShare.filter((r) => r.completedValue > 0);
  const list = positive.length > 0 ? positive : withShare;
  return list.sort((a, b) => b.completedValue - a.completedValue);
}

/** Re-export helper often needed next to portfolio pending billing. */
export { receivablesBalanceFromGlTxs };
