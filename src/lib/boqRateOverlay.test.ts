import { describe, expect, it } from 'vitest';
import { boqRowNeedsRateOverlay, mergeBoqRowWithRateSource } from './boqRateOverlay';

describe('boqRateOverlay', () => {
  it('merges Firestore breakdown when Postgres row only has totals', () => {
    const api = {
      id: 'a1',
      unitRateTotal: 123.2,
      tenderAmount: 1232,
      rateMaterials: 0,
      rateLabour: 0,
      rateEquipment: 0,
    };
    const fs = {
      id: 'a1',
      rateMaterials: 50,
      rateLabour: 30,
      rateEquipment: 20,
      rateOverheadPct: 10,
      rateProfitPct: 12,
    };
    expect(boqRowNeedsRateOverlay(api)).toBe(true);
    const merged = mergeBoqRowWithRateSource(api, fs);
    expect(merged.rateMaterials).toBe(50);
    expect(merged.rateLabour).toBe(30);
    expect(merged.rateEquipment).toBe(20);
  });

  it('leaves row unchanged when Postgres already has rates', () => {
    const api = { id: 'a1', rateMaterials: 10, rateLabour: 5, rateEquipment: 0, unitRateTotal: 20 };
    const fs = { id: 'a1', rateMaterials: 99 };
    expect(boqRowNeedsRateOverlay(api)).toBe(false);
    expect(mergeBoqRowWithRateSource(api, fs)).toEqual(api);
  });
});
