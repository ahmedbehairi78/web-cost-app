import { describe, expect, it } from 'vitest';
import {
  matchReceiptLinesToInvoiceLines,
  receiptLineTotalExVat,
} from './warehouseReceiptInvoiceLink.js';

describe('matchReceiptLinesToInvoiceLines', () => {
  it('matches by material and quantity', () => {
    const matched = matchReceiptLinesToInvoiceLines(
      'WR-20260809-0001',
      [
        { id: 1, materialCategoryId: 10, quantity: 5 },
        { id: 2, materialCategoryId: 20, quantity: 2.5 },
      ],
      [
        { materialCategoryId: 20, quantity: 2.5, unitCost: 40 },
        { materialCategoryId: 10, quantity: 5, unitCost: 12.5 },
      ],
    );
    expect(matched).toEqual([
      { receiptLineId: 1, materialCategoryId: 10, quantity: 5, unitCostExVat: 12.5 },
      { receiptLineId: 2, materialCategoryId: 20, quantity: 2.5, unitCostExVat: 40 },
    ]);
  });

  it('rejects missing receipt material on invoice', () => {
    expect(() =>
      matchReceiptLinesToInvoiceLines(
        'WR-1',
        [{ id: 1, materialCategoryId: 10, quantity: 5 }],
        [{ materialCategoryId: 99, quantity: 5, unitCost: 1 }],
      ),
    ).toThrow(/تطابق/);
  });

  it('rejects extra invoice materials', () => {
    expect(() =>
      matchReceiptLinesToInvoiceLines(
        'WR-1',
        [{ id: 1, materialCategoryId: 10, quantity: 5 }],
        [
          { materialCategoryId: 10, quantity: 5, unitCost: 1 },
          { materialCategoryId: 11, quantity: 1, unitCost: 2 },
        ],
      ),
    ).toThrow(/إضافية/);
  });
});

describe('receiptLineTotalExVat', () => {
  it('rounds to 2dp', () => {
    expect(receiptLineTotalExVat(3, 10.333)).toBe(31);
  });
});
