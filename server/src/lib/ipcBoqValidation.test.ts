import { describe, expect, it } from 'vitest';
import { findIpcItemsExceedingBoq } from './ipcBoqValidation.js';

describe('findIpcItemsExceedingBoq', () => {
  const boqMap = new Map([
    ['a', { itemCode: '1.1', description: 'Item A', tenderQty: 100 }],
    ['b', { itemCode: '1.2', description: 'Item B', tenderQty: 0 }],
  ]);

  it('returns empty when within tender', () => {
    expect(
      findIpcItemsExceedingBoq([{ boqItemId: 'a', totalQty: 100 }], boqMap),
    ).toEqual([]);
  });

  it('flags lines above tender qty', () => {
    const rows = findIpcItemsExceedingBoq([{ boqItemId: 'a', totalQty: 120 }], boqMap);
    expect(rows).toHaveLength(1);
    expect(rows[0].overBy).toBe(20);
  });

  it('ignores zero tender baseline', () => {
    expect(
      findIpcItemsExceedingBoq([{ boqItemId: 'b', totalQty: 500 }], boqMap),
    ).toEqual([]);
  });
});
