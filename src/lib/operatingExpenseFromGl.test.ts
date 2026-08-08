import { describe, it, expect } from 'vitest';
import { AccountCodes } from '../services/accountingService';
import {
  isLegacyMaterialPurchaseExpenseTransaction,
  isWarehouseReceiptTransaction,
  sumTransactionOperatingExpense,
} from './operatingExpenseFromGl';

const e = (accountCode: string, debit: number, credit: number) => ({
  accountCode,
  accountName: accountCode,
  debit,
  credit,
});

describe('operatingExpenseFromGl', () => {
  it('ignores warehouse receipt (Dr 127 8-digit leaf only)', () => {
    const entries = [
      e('12701001', 1140000, 0),
      e('21101001', 0, 1140000),
    ];
    expect(isWarehouseReceiptTransaction(entries)).toBe(true);
    expect(sumTransactionOperatingExpense(entries, 'cloud')).toBe(0);
    expect(sumTransactionOperatingExpense(entries, 'local')).toBe(0);
  });

  it('counts subcontractor IPC expense in local mode', () => {
    const entries = [
      e('51103001', 50000, 0),
      e('21102001', 0, 50000),
    ];
    expect(sumTransactionOperatingExpense(entries, 'local')).toBe(50000);
  });

  it('excludes legacy material purchase (Dr 51101, no 127 warehouse debit) in local mode', () => {
    const entries = [
      e('51101001', 100000, 0),
      e('21101001', 0, 100000),
    ];
    expect(isLegacyMaterialPurchaseExpenseTransaction(entries)).toBe(true);
    expect(sumTransactionOperatingExpense(entries, 'local')).toBe(0);
    expect(sumTransactionOperatingExpense(entries, 'cloud')).toBe(100000);
  });

  it('includes VAT input in cloud mode', () => {
    const entries = [
      e(AccountCodes.VAT_INPUT, 14000, 0),
      e('21101001', 0, 14000),
    ];
    expect(sumTransactionOperatingExpense(entries, 'cloud')).toBe(14000);
  });
});
