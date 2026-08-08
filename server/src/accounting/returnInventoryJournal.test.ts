import { describe, expect, it } from 'vitest';
import { AccountCodes } from './accountCodes.js';
import { buildReturnToWarehouseEntries } from './returnInventoryJournal.js';

describe('buildReturnToWarehouseEntries', () => {
  it('builds Dr inventory and one Cr expense', () => {
    const entries = buildReturnToWarehouseEntries({
      inventoryAccountCode: '12701001',
      inventoryAccountName: 'مخزن',
      expenseGroups: [
        {
          expenseAccountCode: AccountCodes.EXPENSE_MATERIALS,
          expenseAccountName: 'مواد',
          totalCost: 1500,
        },
      ],
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ accountCode: '12701001', debit: 1500, credit: 0 });
    expect(entries[1]).toMatchObject({
      accountCode: AccountCodes.EXPENSE_MATERIALS,
      debit: 0,
      credit: 1500,
    });
  });

  it('groups multiple expense accounts', () => {
    const entries = buildReturnToWarehouseEntries({
      inventoryAccountCode: '12701002',
      inventoryAccountName: 'مخزن ب',
      expenseGroups: [
        { expenseAccountCode: '51101001', expenseAccountName: 'مواد', totalCost: 100 },
        { expenseAccountCode: '51102001', expenseAccountName: 'عمالة', totalCost: 50 },
        { expenseAccountCode: '51101001', expenseAccountName: 'مواد', totalCost: 25 },
      ],
    });
    expect(entries[0]?.debit).toBe(175);
    const credits = entries.filter((e) => e.credit > 0);
    expect(credits).toHaveLength(2);
    expect(credits.find((e) => e.accountCode === '51101001')?.credit).toBe(125);
    expect(credits.find((e) => e.accountCode === '51102001')?.credit).toBe(50);
  });

  it('throws when all costs are zero', () => {
    expect(() =>
      buildReturnToWarehouseEntries({
        inventoryAccountCode: '12701001',
        inventoryAccountName: 'مخزن',
        expenseGroups: [{ expenseAccountCode: '51101001', expenseAccountName: 'م', totalCost: 0 }],
      }),
    ).toThrow(/no cost/i);
  });
});
