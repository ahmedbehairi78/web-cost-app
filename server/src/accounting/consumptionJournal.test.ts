import { describe, expect, it } from 'vitest';
import { AccountCodes } from './accountCodes.js';
import { buildConsumptionIssueEntries } from './consumptionJournal.js';

describe('buildConsumptionIssueEntries', () => {
  it('builds multiple Dr expense lines and one Cr inventory line', () => {
    const entries = buildConsumptionIssueEntries({
      expenseAccountCode: AccountCodes.EXPENSE_MATERIALS,
      expenseAccountName: 'مواد البناء',
      inventoryAccountCode: '12701001',
      inventoryAccountName: 'مخزون المشروع',
      lines: [
        { totalCost: 2000, boqItemCode: '3.1.1' },
        { totalCost: 1500, boqItemCode: '3.2.1' },
        { totalCost: 1500, boqDescription: 'بند ثالث' },
      ],
    });

    expect(entries).toHaveLength(4);
    const debits = entries.filter((e) => e.debit > 0);
    const credits = entries.filter((e) => e.credit > 0);
    expect(debits).toHaveLength(3);
    expect(credits).toHaveLength(1);
    expect(debits.every((e) => e.accountCode === AccountCodes.EXPENSE_MATERIALS)).toBe(true);
    expect(credits[0]?.accountCode).toBe('12701001');
    expect(credits[0]?.credit).toBe(5000);
    expect(debits.reduce((s, e) => s + e.debit, 0)).toBe(5000);
  });

  it('uses default expense code when header account is missing', () => {
    const entries = buildConsumptionIssueEntries({
      inventoryAccountCode: '12701002',
      inventoryAccountName: 'مخزن',
      lines: [{ totalCost: 100 }],
    });
    expect(entries[0]?.accountCode).toBe(AccountCodes.EXPENSE_MATERIALS);
    expect(entries[1]?.credit).toBe(100);
  });

  it('uses per-line expense accounts when provided', () => {
    const entries = buildConsumptionIssueEntries({
      expenseAccountCode: AccountCodes.EXPENSE_MATERIALS,
      expenseAccountName: 'مواد البناء',
      inventoryAccountCode: '12701001',
      inventoryAccountName: 'مخزون المشروع',
      lines: [
        { totalCost: 2000, boqItemCode: 'A', expenseAccountCode: AccountCodes.EXPENSE_MATERIALS },
        { totalCost: 1500, boqItemCode: 'B', expenseAccountCode: AccountCodes.EXPENSE_LABOUR, expenseAccountName: 'عمالة' },
      ],
    });
    const debits = entries.filter((e) => e.debit > 0);
    expect(debits[0]?.accountCode).toBe(AccountCodes.EXPENSE_MATERIALS);
    expect(debits[1]?.accountCode).toBe(AccountCodes.EXPENSE_LABOUR);
    expect(entries.find((e) => e.credit > 0)?.credit).toBe(3500);
  });

  it('throws when all line costs are zero', () => {
    expect(() =>
      buildConsumptionIssueEntries({
        inventoryAccountCode: '12701001',
        inventoryAccountName: 'مخزون',
        lines: [{ totalCost: 0 }, { totalCost: 0 }],
      }),
    ).toThrow(/no cost to post/i);
  });
});
