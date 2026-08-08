import { describe, expect, it } from 'vitest';
import {
  assertNoDuplicateBoqItems,
  sumQuantitiesByMaterial,
  validateConsumptionLines,
} from './consumptionAllocation.js';

describe('server validateConsumptionLines', () => {
  it('aggregates qty per material before stock check', () => {
    const maxAvailableByMaterial = new Map([[5, 100]]);
    expect(() =>
      validateConsumptionLines({
        lines: [
          { boqItemId: 'a', materialCategoryId: 5, quantity: 40 },
          { boqItemId: 'b', materialCategoryId: 5, quantity: 35 },
          { boqItemId: 'c', materialCategoryId: 5, quantity: 25 },
        ],
        maxAvailableByMaterial,
      }),
    ).not.toThrow();
  });

  it('rejects duplicate BOQ items in one order', () => {
    expect(() =>
      assertNoDuplicateBoqItems([
        { boqItemId: 'same' },
        { boqItemId: 'same' },
      ]),
    ).toThrow(/duplicate/i);
  });

  it('rejects total qty above warehouse balance', () => {
    const maxAvailableByMaterial = new Map([[5, 50]]);
    expect(() =>
      validateConsumptionLines({
        lines: [
          { boqItemId: 'a', materialCategoryId: 5, quantity: 30 },
          { boqItemId: 'b', materialCategoryId: 5, quantity: 25 },
        ],
        maxAvailableByMaterial,
      }),
    ).toThrow(/insufficient/i);
  });

  it('sums quantities by material category', () => {
    const totals = sumQuantitiesByMaterial([
      { boqItemId: 'a', materialCategoryId: 5, quantity: 10.5 },
      { boqItemId: 'b', materialCategoryId: 5, quantity: 2.25 },
      { boqItemId: 'c', materialCategoryId: 7, quantity: 1 },
    ]);
    expect(totals.get(5)).toBe(12.75);
    expect(totals.get(7)).toBe(1);
  });
});
