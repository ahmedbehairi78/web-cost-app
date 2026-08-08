import { describe, expect, it } from 'vitest';
import { isFixedAssetCostAccount } from './fixedAssetGlSync.js';

describe('isFixedAssetCostAccount', () => {
  it('accepts 8-digit 11… cost leaves excluding 119…', () => {
    expect(isFixedAssetCostAccount('11101001')).toBe(true);
    expect(isFixedAssetCostAccount('11201001')).toBe(true);
  });

  it('rejects accum. depr., groups, and non-11 codes', () => {
    expect(isFixedAssetCostAccount('11901001')).toBe(false);
    expect(isFixedAssetCostAccount('11101')).toBe(false);
    expect(isFixedAssetCostAccount('12101001')).toBe(false);
    expect(isFixedAssetCostAccount('')).toBe(false);
  });
});
