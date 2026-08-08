import { describe, expect, it } from 'vitest';
import { chartLeafAccountOptions, isChartLeafAccount, isPayrollPaymentAccount } from './chartOfAccountsPicker';
import type { Account } from '../services/accountingService';

const base = (over: Partial<Account>): Account => ({
  id: '1',
  accountCode: '12101001',
  accountName: 'Bank',
  parentCode: '12101',
  isGroup: false,
  status: 'active',
  type: 'asset',
  ...over,
});

describe('isChartLeafAccount', () => {
  it('accepts active 8-digit leaves', () => {
    expect(isChartLeafAccount(base({ accountCode: '51101001' }))).toBe(true);
  });

  it('rejects group accounts', () => {
    expect(isChartLeafAccount(base({ isGroup: true, accountCode: '12101001' }))).toBe(false);
  });

  it('rejects non-8-digit codes', () => {
    expect(isChartLeafAccount(base({ accountCode: '12101' }))).toBe(false);
  });
});

describe('isPayrollPaymentAccount', () => {
  it('accepts bank and cash leaves', () => {
    expect(isPayrollPaymentAccount(base({ accountCode: '12101001', parentCode: '12101' }))).toBe(true);
    expect(isPayrollPaymentAccount(base({ accountCode: '12102001', parentCode: '12102' }))).toBe(true);
  });

  it('rejects other 12… leaves (receivables etc.)', () => {
    expect(isPayrollPaymentAccount(base({ accountCode: '12201001', parentCode: '12201' }))).toBe(false);
  });

  it('rejects fixed-asset leaves even if misnamed', () => {
    expect(isPayrollPaymentAccount(base({ accountCode: '11101001', parentCode: '11101' }))).toBe(false);
  });
});

describe('chartLeafAccountOptions', () => {
  it('returns sorted leaf options only', () => {
    const opts = chartLeafAccountOptions(
      [
        base({ id: 'a', accountCode: '21101002', accountName: 'Supplier B' }),
        base({ id: 'b', accountCode: '12101', accountName: 'Group', isGroup: true }),
        base({ id: 'c', accountCode: '12101001', accountName: 'Bank' }),
      ],
      'ar',
    );
    expect(opts.map((o) => o.value)).toEqual(['12101001', '21101002']);
  });
});
