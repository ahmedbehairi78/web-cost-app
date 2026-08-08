import { roundMoney } from './money.js';

export const QTY_EPSILON = 0.01;

export interface AllocationLineInput {
  boqItemId: string;
  materialCategoryId: number;
  quantity: number;
}

/** Quantity rounding — same 2 decimal places as money. */
export function roundQty(n: number): number {
  return roundMoney(n);
}

/** @deprecated use roundQty */
export const roundQty3 = roundQty;

export function assertNoDuplicateBoqItems(lines: Array<{ boqItemId: string }>): void {
  const seen = new Set<string>();
  for (const line of lines) {
    const id = String(line.boqItemId || '').trim();
    if (!id) throw new Error('Each line requires boqItemId');
    if (seen.has(id)) throw new Error('Duplicate BOQ item in the same consumption order');
    seen.add(id);
  }
}

export function sumQuantitiesByMaterial(lines: AllocationLineInput[]): Map<number, number> {
  const totals = new Map<number, number>();
  for (const line of lines) {
    const materialCategoryId = Number(line.materialCategoryId);
    totals.set(
      materialCategoryId,
      roundQty((totals.get(materialCategoryId) ?? 0) + Number(line.quantity || 0)),
    );
  }
  return totals;
}

export function validateConsumptionLines(params: {
  lines: AllocationLineInput[];
  maxAvailableByMaterial: Map<number, number>;
}): void {
  if (!Array.isArray(params.lines) || params.lines.length === 0) {
    throw new Error('At least one consumption line is required');
  }

  assertNoDuplicateBoqItems(params.lines);

  for (const [idx, line] of params.lines.entries()) {
    if (!line.boqItemId || !line.materialCategoryId || !(Number(line.quantity) > 0)) {
      throw new Error(`Line ${idx + 1}: boqItemId, materialCategoryId, and positive quantity required`);
    }
    if (Number(line.quantity) < 0) {
      throw new Error(`Line ${idx + 1}: quantity cannot be negative`);
    }
  }

  const totalsByMaterial = sumQuantitiesByMaterial(params.lines);
  for (const [materialCategoryId, totalQty] of totalsByMaterial.entries()) {
    const available = params.maxAvailableByMaterial.get(materialCategoryId);
    if (available == null) {
      throw new Error(`No project warehouse stock for material category ${materialCategoryId}`);
    }
    if (totalQty > available + QTY_EPSILON) {
      throw new Error(
        `Insufficient project warehouse balance for material ${materialCategoryId}. Available: ${available.toFixed(2)}, requested: ${totalQty.toFixed(2)}`,
      );
    }
  }
}
