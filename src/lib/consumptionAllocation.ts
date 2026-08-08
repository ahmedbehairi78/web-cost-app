import { roundMoney } from './money';

export const QTY_EPSILON = 0.01;

export type AllocationBasis = 'boq_qty' | 'boq_value';

export interface BoqAllocationWeightItem {
  boqItemId: string;
  selected: boolean;
  tenderQty: number;
  tenderAmount: number;
  unitRateTotal?: number;
}

export interface AllocationLineInput {
  boqItemId: string;
  quantity: number;
}

export type AllocationValidationError =
  | 'duplicate_boq_item'
  | 'negative_quantity'
  | 'empty_lines'
  | 'mismatch_total'
  | 'exceeds_available'
  | 'invalid_total';

/** Quantity rounding — same 2 decimal places as money. */
export function roundQty(n: number): number {
  return roundMoney(n);
}

/** @deprecated use roundQty */
export const roundQty3 = roundQty;

export function computeBoqValue(item: {
  tenderAmount: number;
  tenderQty: number;
  unitRateTotal?: number;
}): number {
  const amount = Number(item.tenderAmount);
  if (amount > 0) return amount;
  return Math.max(0, Number(item.tenderQty) * Number(item.unitRateTotal ?? 0));
}

export function getAllocationWeight(item: BoqAllocationWeightItem, basis: AllocationBasis): number {
  if (!item.selected) return 0;
  if (basis === 'boq_qty') return Math.max(0, Number(item.tenderQty));
  return computeBoqValue(item);
}

export function allocateByWeights(
  totalIssue: number,
  items: BoqAllocationWeightItem[],
  basis: AllocationBasis,
): { allocations: Record<string, number>; error?: 'no_selected' | 'invalid_total' | 'zero_weights' } {
  const selected = items.filter((item) => item.selected);
  if (selected.length === 0) return { allocations: {}, error: 'no_selected' };
  if (!(totalIssue > 0)) return { allocations: {}, error: 'invalid_total' };

  const weights = selected.map((item) => getAllocationWeight(item, basis));
  const sumW = weights.reduce((sum, weight) => sum + weight, 0);
  if (sumW <= 0) return { allocations: {}, error: 'zero_weights' };

  const raw = weights.map((weight) => (totalIssue * weight) / sumW);
  const floors = raw.map((value) => Math.floor(value * 100) / 100);
  let remainderUnits = Math.round((totalIssue - floors.reduce((sum, value) => sum + value, 0)) * 100);

  const fractions = raw.map((value, index) => ({ index, frac: value - floors[index] }));
  fractions.sort((a, b) => b.frac - a.frac);

  for (let step = 0; step < remainderUnits; step += 1) {
    const target = fractions[step % fractions.length];
    floors[target.index] = roundQty(floors[target.index] + 0.01);
  }

  const allocations: Record<string, number> = {};
  selected.forEach((item, index) => {
    allocations[item.boqItemId] = floors[index];
  });

  return { allocations };
}

/** Apply saved template percentages (boqItemId → share %, not required to sum exactly 100). */
export function allocateByPercentages(
  totalIssue: number,
  percentages: Record<string, number>,
): { allocations: Record<string, number>; error?: 'invalid_total' | 'zero_weights' } {
  if (!(totalIssue > 0)) return { allocations: {}, error: 'invalid_total' };
  const entries = Object.entries(percentages).filter(([, pct]) => Number(pct) > 0);
  if (entries.length === 0) return { allocations: {}, error: 'zero_weights' };

  const weights = entries.map(([, pct]) => Number(pct));
  const sumW = weights.reduce((sum, weight) => sum + weight, 0);
  if (sumW <= 0) return { allocations: {}, error: 'zero_weights' };

  const raw = weights.map((weight) => (totalIssue * weight) / sumW);
  const floors = raw.map((value) => Math.floor(value * 100) / 100);
  let remainderUnits = Math.round((totalIssue - floors.reduce((sum, value) => sum + value, 0)) * 100);

  const fractions = raw.map((value, index) => ({ index, frac: value - floors[index] }));
  fractions.sort((a, b) => b.frac - a.frac);
  for (let step = 0; step < remainderUnits; step += 1) {
    const target = fractions[step % fractions.length];
    floors[target.index] = roundQty(floors[target.index] + 0.01);
  }

  const allocations: Record<string, number> = {};
  entries.forEach(([boqItemId], index) => {
    allocations[boqItemId] = floors[index];
  });
  return { allocations };
}

export function assertNoDuplicateBoqItems(lines: Array<{ boqItemId: string }>): AllocationValidationError | null {
  const seen = new Set<string>();
  for (const line of lines) {
    const id = String(line.boqItemId || '').trim();
    if (!id) return 'empty_lines';
    if (seen.has(id)) return 'duplicate_boq_item';
    seen.add(id);
  }
  return null;
}

export function sumAllocatedQuantity(lines: Array<{ quantity: number }>): number {
  return roundQty(lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0));
}

export function validateAllocationLines(params: {
  totalIssued: number;
  lines: AllocationLineInput[];
  maxAvailable: number;
  epsilon?: number;
}): { ok: true; allocatedTotal: number; remaining: number } | { ok: false; error: AllocationValidationError; allocatedTotal: number; remaining: number } {
  const epsilon = params.epsilon ?? QTY_EPSILON;
  const duplicate = assertNoDuplicateBoqItems(params.lines);
  if (duplicate) {
    return { ok: false, error: duplicate, allocatedTotal: 0, remaining: params.totalIssued };
  }

  for (const line of params.lines) {
    if (Number(line.quantity) < 0) {
      return {
        ok: false,
        error: 'negative_quantity',
        allocatedTotal: sumAllocatedQuantity(params.lines),
        remaining: roundQty(params.totalIssued - sumAllocatedQuantity(params.lines)),
      };
    }
  }

  const activeLines = params.lines.filter((line) => Number(line.quantity) > 0);
  if (activeLines.length === 0) {
    return { ok: false, error: 'empty_lines', allocatedTotal: 0, remaining: params.totalIssued };
  }

  const allocatedTotal = sumAllocatedQuantity(activeLines);
  const remaining = roundQty(params.totalIssued - allocatedTotal);

  if (!(params.totalIssued > 0)) {
    return { ok: false, error: 'invalid_total', allocatedTotal, remaining };
  }

  if (Math.abs(remaining) > epsilon) {
    return { ok: false, error: 'mismatch_total', allocatedTotal, remaining };
  }

  if (params.totalIssued > params.maxAvailable + epsilon) {
    return { ok: false, error: 'exceeds_available', allocatedTotal, remaining };
  }

  return { ok: true, allocatedTotal, remaining: 0 };
}

export function sumQuantitiesByMaterial(
  lines: Array<{ materialCategoryId: number; quantity: number }>,
): Map<number, number> {
  const totals = new Map<number, number>();
  for (const line of lines) {
    const materialCategoryId = Number(line.materialCategoryId);
    totals.set(materialCategoryId, roundQty((totals.get(materialCategoryId) ?? 0) + Number(line.quantity || 0)));
  }
  return totals;
}
