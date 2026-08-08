import { describe, expect, it } from 'vitest';
import { computeBoqUnitRate, tenderAmountExcludingProfit } from './boqPricing';

describe('tenderAmountExcludingProfit', () => {
  it('uses rate breakdown (direct + OH) × qty when components exist', () => {
    const item = {
      tenderQty: 100,
      rateMaterials: 50,
      rateLabour: 30,
      rateEquipment: 20,
      rateOverheadPct: 10,
      rateProfitPct: 12,
    };
    const { subtotalAfterOverhead } = computeBoqUnitRate({
      rateMaterials: 50,
      rateLabour: 30,
      rateEquipment: 20,
      rateOverheadPct: 10,
      rateProfitPct: 12,
    });
    expect(tenderAmountExcludingProfit(item)).toBe(subtotalAfterOverhead * 100);
  });

  it('strips default profit from unitRateTotal when rate fields missing (Postgres BOQ)', () => {
    const item = {
      tenderQty: 10,
      unitRateTotal: 123.2,
      tenderAmount: 1232,
      rateMaterials: 0,
      rateLabour: 0,
      rateEquipment: 0,
    };
    // direct 100 × OH 1.1 × profit 1.12 = 123.2 → cost budget = 110 × 10
    expect(tenderAmountExcludingProfit(item)).toBeCloseTo(1100, 2);
  });

  it('selling tenderAmount exceeds ex-profit cost when only totals stored', () => {
    const item = {
      tenderQty: 10,
      unitRateTotal: 123.2,
      tenderAmount: 1232,
    };
    const selling = 1232;
    const cost = tenderAmountExcludingProfit(item);
    expect(selling).toBeGreaterThan(cost);
    expect(cost).toBeCloseTo(selling / 1.12, 2);
  });
});
