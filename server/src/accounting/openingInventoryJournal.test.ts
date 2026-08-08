import { describe, expect, it } from 'vitest';
import { AccountCodes } from './accountCodes.js';
import {
  buildOpeningInventoryEntries,
  buildOpeningInventoryReference,
} from './openingInventoryJournal.js';

describe('buildOpeningInventoryEntries', () => {
  it('builds balanced Dr warehouse / Cr partners current', () => {
    const entries = buildOpeningInventoryEntries(12500.5, {
      accountCode: '12701002',
      accountName: 'مخزن مشروع أ',
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      accountCode: '12701002',
      debit: 12500.5,
      credit: 0,
    });
    expect(entries[1]).toMatchObject({
      accountCode: AccountCodes.PARTNERS_CURRENT,
      debit: 0,
      credit: 12500.5,
    });
    expect(entries[1]?.accountCode).toBe('31401001');
  });

  it('rounds money to 2 decimals', () => {
    const entries = buildOpeningInventoryEntries(10.006, {
      accountCode: '12701001',
      accountName: 'مخزن',
    });
    expect(entries[0]?.debit).toBe(10.01);
    expect(entries[1]?.credit).toBe(10.01);
  });

  it('throws when total is zero', () => {
    expect(() =>
      buildOpeningInventoryEntries(0, { accountCode: '12701001', accountName: 'مخزن' }),
    ).toThrow(/greater than zero/i);
  });
});

describe('buildOpeningInventoryReference', () => {
  it('includes project code and INV-OPEN prefix', () => {
    const ref = buildOpeningInventoryReference('PRJ-01', new Date('2026-08-05T12:34:56'));
    expect(ref).toMatch(/^INV-OPEN-PRJ-01-20260805-123456$/);
  });
});
