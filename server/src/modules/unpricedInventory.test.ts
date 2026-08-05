import { describe, expect, it } from 'vitest';
import {
  consumptionTouchesUnpriced,
  getPricedAvailableQuantity,
} from '../modules/inventoryHelpers.js';

describe('unpriced consumption helpers', () => {
  it('returns false when no unpriced stock', () => {
    expect(
      consumptionTouchesUnpriced(
        { quantityBalance: 10, quantityUnpriced: 0, avgUnitCost: 5 },
        3,
      ),
    ).toBe(false);
  });

  it('returns true when issue exceeds priced available', () => {
    expect(
      consumptionTouchesUnpriced(
        { quantityBalance: 10, quantityUnpriced: 8, avgUnitCost: 5 },
        5,
      ),
    ).toBe(true);
  });

  it('returns false when issue fits in priced portion', () => {
    expect(
      consumptionTouchesUnpriced(
        { quantityBalance: 10, quantityUnpriced: 3, avgUnitCost: 5 },
        5,
      ),
    ).toBe(false);
  });

  it('priced available = balance − unpriced', () => {
    expect(getPricedAvailableQuantity({ quantityBalance: 10, quantityUnpriced: 4 })).toBe(6);
  });
});
