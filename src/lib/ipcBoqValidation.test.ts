import { describe, expect, it } from 'vitest';
import { findIpcItemsExceedingTender } from './ipcBoqValidation';

describe('findIpcItemsExceedingTender', () => {
  it('returns empty when all within tender', () => {
    expect(
      findIpcItemsExceedingTender([
        { boqItemId: 'a', tenderQty: 100, totalQty: 100 },
        { boqItemId: 'b', tenderQty: 50, totalQty: 40 },
      ]),
    ).toEqual([]);
  });

  it('flags lines above tender qty', () => {
    const rows = findIpcItemsExceedingTender([
      { boqItemId: 'a', itemCode: '1.1', tenderQty: 100, totalQty: 120 },
      { boqItemId: 'b', tenderQty: 0, totalQty: 999 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].boqItemId).toBe('a');
    expect(rows[0].overBy).toBe(20);
  });

  it('ignores zero tender (no contract qty baseline)', () => {
    expect(
      findIpcItemsExceedingTender([{ boqItemId: 'x', tenderQty: 0, totalQty: 50 }]),
    ).toEqual([]);
  });
});
