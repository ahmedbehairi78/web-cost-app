import { describe, expect, it } from 'vitest';
import { resolveCounterpartEntries, resolveEntrySide } from './glBilingual';

const accounts = [
  { accountCode: '51102001', accountName: 'عمالة مباشرة', accountNameEn: 'Direct labour' },
  { accountCode: '52101001', accountName: 'رواتب إدارية', accountNameEn: 'Admin salaries' },
  { accountCode: '21403001', accountName: 'التأمينات الاجتماعية - دائن', accountNameEn: 'Social insurance payable' },
  { accountCode: '21501002', accountName: 'رواتب مستحقة', accountNameEn: 'Accrued salaries' },
  { accountCode: '41101001', accountName: 'إيرادات عقود المقاولات', accountNameEn: 'Contract revenue' },
];

/** Payroll accrual: two debit expense accounts balanced by several credit accounts. */
const payrollEntries = [
  { accountCode: '51102001', debit: 29705, credit: 0 },
  { accountCode: '52101001', debit: 12875, credit: 0 },
  { accountCode: '21403001', debit: 0, credit: 4200 },
  { accountCode: '21501002', debit: 0, credit: 38380 },
];

describe('resolveEntrySide', () => {
  it('classifies debit and credit lines', () => {
    expect(resolveEntrySide({ debit: 100, credit: 0 })).toBe('debit');
    expect(resolveEntrySide({ debit: 0, credit: 100 })).toBe('credit');
  });

  it('returns null for zero-amount lines', () => {
    expect(resolveEntrySide({ debit: 0, credit: 0 })).toBeNull();
  });
});

describe('resolveCounterpartEntries', () => {
  it('returns only credit accounts for a debit line', () => {
    const result = resolveCounterpartEntries(payrollEntries, '51102001', accounts, 'ar', 'debit');
    expect(result.map((r) => r.code)).toEqual(['21403001', '21501002']);
  });

  it('excludes same-side expense accounts from a debit line', () => {
    const result = resolveCounterpartEntries(payrollEntries, '51102001', accounts, 'ar', 'debit');
    expect(result.map((r) => r.code)).not.toContain('52101001');
  });

  it('returns only debit accounts for a credit line', () => {
    const closingEntries = [
      { accountCode: '41101001', debit: 90000, credit: 0 },
      { accountCode: '51102001', debit: 0, credit: 42580 },
      { accountCode: '52101001', debit: 0, credit: 12875 },
    ];
    const result = resolveCounterpartEntries(closingEntries, '51102001', accounts, 'ar', 'credit');
    expect(result.map((r) => r.code)).toEqual(['41101001']);
  });

  it('never includes the selected account itself', () => {
    const multiLine = [
      { accountCode: '51102001', debit: 100, credit: 0 },
      { accountCode: '51102001', debit: 50, credit: 0 },
      { accountCode: '21501002', debit: 0, credit: 150 },
    ];
    const result = resolveCounterpartEntries(multiLine, '51102001', accounts, 'ar', 'debit');
    expect(result.map((r) => r.code)).toEqual(['21501002']);
  });

  it('dedupes repeated counterpart accounts', () => {
    const repeated = [
      { accountCode: '51102001', debit: 300, credit: 0 },
      { accountCode: '21501002', debit: 0, credit: 100 },
      { accountCode: '21501002', debit: 0, credit: 200 },
    ];
    const result = resolveCounterpartEntries(repeated, '51102001', accounts, 'ar', 'debit');
    expect(result).toHaveLength(1);
  });

  it('keeps legacy behaviour (all other accounts) when side is omitted', () => {
    const result = resolveCounterpartEntries(payrollEntries, '51102001', accounts, 'ar');
    expect(result.map((r) => r.code)).toEqual(['52101001', '21403001', '21501002']);
  });

  it('uses the English account name in English UI', () => {
    const result = resolveCounterpartEntries(payrollEntries, '51102001', accounts, 'en', 'debit');
    expect(result[0].name).toBe('Social insurance payable');
  });
});
