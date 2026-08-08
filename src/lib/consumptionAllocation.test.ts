import { describe, expect, it } from 'vitest';
import {
  allocateByPercentages,
  allocateByWeights,
  assertNoDuplicateBoqItems,
  roundQty,
  sumAllocatedQuantity,
  validateAllocationLines,
} from './consumptionAllocation';

describe('allocateByWeights', () => {
  const items = [
    { boqItemId: 'a', selected: true, tenderQty: 200, tenderAmount: 200000 },
    { boqItemId: 'b', selected: true, tenderQty: 100, tenderAmount: 100000 },
    { boqItemId: 'c', selected: true, tenderQty: 100, tenderAmount: 100000 },
  ];

  it('distributes by BOQ quantity with exact total', () => {
    const { allocations, error } = allocateByWeights(50, items, 'boq_qty');
    expect(error).toBeUndefined();
    expect(sumAllocatedQuantity(Object.entries(allocations).map(([boqItemId, quantity]) => ({ boqItemId, quantity })))).toBe(50);
  });

  it('assigns 100% to a single selected item', () => {
    const { allocations } = allocateByWeights(12.5, [{ ...items[0], selected: true }], 'boq_qty');
    expect(allocations.a).toBe(12.5);
  });

  it('returns zero_weights when all selected items have zero basis', () => {
    const { error } = allocateByWeights(
      10,
      [{ boqItemId: 'z', selected: true, tenderQty: 0, tenderAmount: 0 }],
      'boq_qty',
    );
    expect(error).toBe('zero_weights');
  });

  it('allocates by saved template percentages', () => {
    const { allocations } = allocateByPercentages(100, { a: 40, b: 35, c: 25 });
    expect(allocations.a).toBe(40);
    expect(allocations.b).toBe(35);
    expect(allocations.c).toBe(25);
  });

  it('uses largest remainder so totals match exactly at 2dp', () => {
    const { allocations } = allocateByWeights(
      10,
      [
        { boqItemId: 'a', selected: true, tenderQty: 1, tenderAmount: 1 },
        { boqItemId: 'b', selected: true, tenderQty: 1, tenderAmount: 1 },
        { boqItemId: 'c', selected: true, tenderQty: 1, tenderAmount: 1 },
      ],
      'boq_qty',
    );
    const total = Object.values(allocations).reduce((sum, qty) => sum + qty, 0);
    expect(roundQty(total)).toBe(10);
    for (const qty of Object.values(allocations)) {
      expect(Number.isInteger(Math.round(qty * 100))).toBe(true);
    }
  });
});

describe('validateAllocationLines', () => {
  it('accepts matching totals within tolerance', () => {
    const result = validateAllocationLines({
      totalIssued: 50,
      maxAvailable: 120,
      lines: [
        { boqItemId: 'a', quantity: 20 },
        { boqItemId: 'b', quantity: 15 },
        { boqItemId: 'c', quantity: 15 },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.allocatedTotal).toBe(50);
      expect(result.remaining).toBe(0);
    }
  });

  it('rejects mismatched totals', () => {
    const result = validateAllocationLines({
      totalIssued: 50,
      maxAvailable: 120,
      lines: [
        { boqItemId: 'a', quantity: 20 },
        { boqItemId: 'b', quantity: 20 },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('mismatch_total');
    }
  });

  it('rejects duplicate BOQ items', () => {
    expect(assertNoDuplicateBoqItems([{ boqItemId: 'a' }, { boqItemId: 'a' }])).toBe('duplicate_boq_item');
  });

  it('rejects totals above available stock', () => {
    const result = validateAllocationLines({
      totalIssued: 60,
      maxAvailable: 50,
      lines: [{ boqItemId: 'a', quantity: 60 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('exceeds_available');
    }
  });

  it('rejects negative quantities', () => {
    const result = validateAllocationLines({
      totalIssued: 10,
      maxAvailable: 20,
      lines: [{ boqItemId: 'a', quantity: -1 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('negative_quantity');
    }
  });
});
