import { describe, expect, it } from 'vitest';
import { buildWarehouseReceiptEntries } from './warehouseReceiptJournal.js';

describe('buildWarehouseReceiptEntries', () => {
  it('builds balanced Dr warehouse / Cr supplier', () => {
    const entries = buildWarehouseReceiptEntries({
      totalAmount: 100.5,
      warehouse: { accountCode: '12701001', accountName: 'مخزن' },
      supplierAccountCode: '21101002',
      supplierAccountName: 'مورد',
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]!.debit).toBe(100.5);
    expect(entries[0]!.accountCode).toBe('12701001');
    expect(entries[1]!.credit).toBe(100.5);
    expect(entries[1]!.accountCode).toBe('21101002');
  });

  it('rejects non-leaf supplier code', () => {
    expect(() =>
      buildWarehouseReceiptEntries({
        totalAmount: 10,
        warehouse: { accountCode: '12701001', accountName: 'W' },
        supplierAccountCode: '21101',
        supplierAccountName: 'S',
      }),
    ).toThrow(/8-digit/);
  });
});
