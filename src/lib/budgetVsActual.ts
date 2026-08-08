import { tenderAmountExcludingProfit, BOQ_DEFAULT_PROFIT_PCT } from './boqPricing';
import { roundMoney } from './money';

export type BudgetDetailLevel = 'project' | 'contract' | 'boq_item';

export type BudgetVsActualBoqItem = {
  id: string;
  projectId: string;
  contractId?: string | null;
  tenderAmount?: number | null;
  rateMaterials?: number | null;
  rateLabour?: number | null;
  rateEquipment?: number | null;
  rateOverheadPct?: number | null;
  rateProfitPct?: number | null;
  unitRateTotal?: number | null;
  itemCode?: string | null;
  description?: string | null;
};

export type BudgetVsActualProject = {
  id: string;
  projectName: string;
  projectCode?: string | null;
  voValue?: number | null;
};

export type BudgetVsActualContract = {
  id: string;
  projectId: string;
  contractName?: string | null;
  contractNumber?: string | null;
};

/** Actual cost keyed by projectId | contractId | boqItemId depending on level. */
export type ActualCostMap = Map<string, number>;

export type BudgetVsActualRow = {
  id: string;
  level: BudgetDetailLevel;
  label: string;
  meta?: string;
  projectId: string;
  contractId?: string;
  boqItemId?: string;
  boqSelling: number;
  estCost: number;
  voValue: number;
  costBudget: number;
  actual: number;
  variance: number;
  variancePct: number;
};

function itemEstCost(item: BudgetVsActualBoqItem): number {
  const fromBreakdown = tenderAmountExcludingProfit(item);
  if (fromBreakdown > 0) return fromBreakdown;
  const selling = Number(item.tenderAmount || 0);
  if (selling > 0) return selling / (1 + BOQ_DEFAULT_PROFIT_PCT / 100);
  return 0;
}

function finishRow(
  partial: Omit<BudgetVsActualRow, 'costBudget' | 'variance' | 'variancePct'>,
): BudgetVsActualRow {
  const costBudget = roundMoney(partial.estCost + partial.voValue);
  const actual = roundMoney(partial.actual);
  const variance = roundMoney(costBudget - actual);
  const variancePct = costBudget > 0 ? (variance / costBudget) * 100 : 0;
  return {
    ...partial,
    boqSelling: roundMoney(partial.boqSelling),
    estCost: roundMoney(partial.estCost),
    voValue: roundMoney(partial.voValue),
    costBudget,
    actual,
    variance,
    variancePct,
  };
}

/**
 * Build budget vs actual rows at project, contract, or BOQ-item detail.
 * - Budget (est): BOQ tenderAmountExcludingProfit (+ project VO only on project rows)
 * - Actual: provided via `actualByKey` (projectId / contractId / boqItemId)
 */
export function buildBudgetVsActualRows(input: {
  level: BudgetDetailLevel;
  projects: BudgetVsActualProject[];
  contracts: BudgetVsActualContract[];
  boqItems: BudgetVsActualBoqItem[];
  actualByKey: ActualCostMap;
  projectFilter?: string | 'all';
  contractFilter?: string | 'all';
}): BudgetVsActualRow[] {
  const projectFilter =
    input.projectFilter && input.projectFilter !== 'all' ? input.projectFilter : null;
  const contractFilter =
    input.contractFilter && input.contractFilter !== 'all' ? input.contractFilter : null;

  const projects = input.projects.filter((p) => !projectFilter || p.id === projectFilter);
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const contracts = input.contracts.filter((c) => {
    if (projectFilter && c.projectId !== projectFilter) return false;
    if (contractFilter && c.id !== contractFilter) return false;
    return projectMap.has(c.projectId);
  });
  const contractMap = new Map(contracts.map((c) => [c.id, c]));
  const boqItems = input.boqItems.filter((item) => {
    if (projectFilter && item.projectId !== projectFilter) return false;
    if (contractFilter && item.contractId !== contractFilter) return false;
    if (!projectMap.has(item.projectId)) return false;
    if (item.contractId && !contractMap.has(item.contractId) && contracts.length > 0) {
      // allow orphan BOQ if contracts list empty for that project
      const hasAnyContract = contracts.some((c) => c.projectId === item.projectId);
      if (hasAnyContract) return false;
    }
    return true;
  });

  if (input.level === 'boq_item') {
    return boqItems
      .map((item) => {
        const project = projectMap.get(item.projectId);
        const contract = item.contractId ? contractMap.get(item.contractId) : undefined;
        const selling = Number(item.tenderAmount || 0);
        const est = itemEstCost(item);
        const actual = input.actualByKey.get(item.id) ?? 0;
        const code = String(item.itemCode || '').trim();
        const desc = String(item.description || '').trim();
        const label =
          code && desc ? `${code} — ${desc}` : code || desc || item.id;
        return finishRow({
          id: item.id,
          level: 'boq_item',
          label,
          meta: [project?.projectName, contract?.contractName || contract?.contractNumber]
            .filter(Boolean)
            .join(' · '),
          projectId: item.projectId,
          contractId: item.contractId || undefined,
          boqItemId: item.id,
          boqSelling: selling,
          estCost: est,
          voValue: 0,
          actual,
        });
      })
      .filter((r) => r.boqSelling !== 0 || r.estCost !== 0 || r.actual !== 0)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }

  if (input.level === 'contract') {
    return contracts
      .map((c) => {
        const project = projectMap.get(c.projectId);
        const items = boqItems.filter((i) => i.contractId === c.id);
        const boqSelling = items.reduce((s, i) => s + Number(i.tenderAmount || 0), 0);
        const estCost = items.reduce((s, i) => s + itemEstCost(i), 0);
        const actual = input.actualByKey.get(c.id) ?? 0;
        return finishRow({
          id: c.id,
          level: 'contract',
          label: c.contractName || c.contractNumber || c.id,
          meta: project?.projectName,
          projectId: c.projectId,
          contractId: c.id,
          boqSelling,
          estCost,
          voValue: 0,
          actual,
        });
      })
      .filter((r) => r.boqSelling !== 0 || r.estCost !== 0 || r.actual !== 0)
      .sort((a, b) => (a.meta || '').localeCompare(b.meta || '') || a.label.localeCompare(b.label));
  }

  // project
  return projects
    .map((p) => {
      const items = boqItems.filter((i) => i.projectId === p.id);
      const boqSelling = items.reduce((s, i) => s + Number(i.tenderAmount || 0), 0);
      const estCost = items.reduce((s, i) => s + itemEstCost(i), 0);
      const voValue = Number(p.voValue || 0);
      const actual = input.actualByKey.get(p.id) ?? 0;
      return finishRow({
        id: p.id,
        level: 'project',
        label: p.projectName,
        meta: p.projectCode || undefined,
        projectId: p.id,
        boqSelling,
        estCost,
        voValue,
        actual,
      });
    })
    .filter((r) => r.boqSelling !== 0 || r.estCost !== 0 || r.voValue !== 0 || r.actual !== 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function sumBudgetVsActualRows(rows: BudgetVsActualRow[]): {
  boqSelling: number;
  estCost: number;
  voValue: number;
  costBudget: number;
  actual: number;
  variance: number;
} {
  const boqSelling = roundMoney(rows.reduce((s, r) => s + r.boqSelling, 0));
  const estCost = roundMoney(rows.reduce((s, r) => s + r.estCost, 0));
  const voValue = roundMoney(rows.reduce((s, r) => s + r.voValue, 0));
  const costBudget = roundMoney(rows.reduce((s, r) => s + r.costBudget, 0));
  const actual = roundMoney(rows.reduce((s, r) => s + r.actual, 0));
  return {
    boqSelling,
    estCost,
    voValue,
    costBudget,
    actual,
    variance: roundMoney(costBudget - actual),
  };
}

/** Rows per sheet on screen (larger type / A4 desk preview). */
export function budgetVsActualRowsPerPage(level: BudgetDetailLevel): number {
  if (level === 'boq_item') return 9;
  if (level === 'contract') return 10;
  return 11;
}

/** Rows per printed sheet — denser so data fills the page (compact letterhead + 3-line footer). */
export function budgetVsActualPrintRowsPerPage(level: BudgetDetailLevel): number {
  if (level === 'boq_item') return 18;
  if (level === 'contract') return 20;
  return 22;
}

export function chunkBudgetVsActualPages<T>(rows: T[], pageSize: number): T[][] {
  const size = Math.max(1, pageSize);
  if (rows.length === 0) return [[]];
  const pages: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    pages.push(rows.slice(i, i + size));
  }
  return pages;
}
