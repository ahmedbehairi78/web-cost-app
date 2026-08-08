import { describe, expect, it } from 'vitest';
import { AccountCodes } from './accountCodes.js';
import {
  balanceSheetGapFromNets,
  buildIncomeClosingEntries,
  buildOpeningBalanceEntries,
  dayAfterIsoDate,
  isBalanceSheetBalanced,
  openPlBalances,
} from './fiscalPeriodClosing.js';
import { roundMoney } from '../lib/money.js';

describe('openPlBalances', () => {
  it('returns only open 4…/5… leaves with non-zero net', () => {
    const open = openPlBalances([
      { accountCode: '41101001', accountName: 'إيراد', netDebit: -100 },
      { accountCode: '51101001', accountName: 'مصروف', netDebit: 40 },
      { accountCode: '12101001', accountName: 'بنك', netDebit: 50 },
      { accountCode: '41101002', accountName: 'صفر', netDebit: 0 },
    ]);
    expect(open.map((r) => r.accountCode).sort()).toEqual(['41101001', '51101001']);
  });
});

describe('dayAfterIsoDate', () => {
  it('rolls month and year', () => {
    expect(dayAfterIsoDate('2026-12-31')).toBe('2027-01-01');
    expect(dayAfterIsoDate('2026-01-31')).toBe('2026-02-01');
  });
});

describe('buildIncomeClosingEntries', () => {
  it('closes revenue and expense into retained earnings (net profit)', () => {
    const { entries, netProfit } = buildIncomeClosingEntries([
      { accountCode: '41101001', accountName: 'إيراد', netDebit: -100_000 },
      { accountCode: '51101001', accountName: 'مواد', netDebit: 60_000 },
    ]);
    expect(netProfit).toBe(40_000);
    const rev = entries.find((e) => e.accountCode === '41101001');
    const exp = entries.find((e) => e.accountCode === '51101001');
    const re = entries.find((e) => e.accountCode === AccountCodes.RETAINED_EARNINGS);
    expect(rev?.debit).toBe(100_000);
    expect(exp?.credit).toBe(60_000);
    expect(re?.credit).toBe(40_000);
    const dr = roundMoney(entries.reduce((s, e) => s + e.debit, 0));
    const cr = roundMoney(entries.reduce((s, e) => s + e.credit, 0));
    expect(dr).toBe(cr);
  });

  it('posts net loss as debit on retained earnings', () => {
    const { entries, netProfit } = buildIncomeClosingEntries([
      { accountCode: '41101001', accountName: 'إيراد', netDebit: -10_000 },
      { accountCode: '51101001', accountName: 'مواد', netDebit: 25_000 },
    ]);
    expect(netProfit).toBe(-15_000);
    const re = entries.find((e) => e.accountCode === AccountCodes.RETAINED_EARNINGS);
    expect(re?.debit).toBe(15_000);
  });
});

describe('buildOpeningBalanceEntries + balanceSheetGapFromNets', () => {
  it('builds balanced opening from BS nets', () => {
    const balances = [
      { accountCode: '12101001', accountName: 'بنك', netDebit: 50_000 },
      { accountCode: '21101001', accountName: 'موردون', netDebit: -20_000 },
      { accountCode: '31301001', accountName: 'أرباح', netDebit: -30_000 },
    ];
    expect(balanceSheetGapFromNets(balances)).toBe(0);
    const entries = buildOpeningBalanceEntries(balances);
    const dr = roundMoney(entries.reduce((s, e) => s + e.debit, 0));
    const cr = roundMoney(entries.reduce((s, e) => s + e.credit, 0));
    expect(dr).toBe(cr);
    expect(dr).toBe(50_000);
  });

  it('detects unbalanced BS', () => {
    expect(
      balanceSheetGapFromNets([
        { accountCode: '12101001', accountName: 'بنك', netDebit: 100 },
        { accountCode: '21101001', accountName: 'موردون', netDebit: -40 },
      ]),
    ).toBe(60);
  });

  it('absorbs rounding gap ≤ 1 into retained earnings on opening', () => {
    const balances = [
      { accountCode: '12101001', accountName: 'بنك', netDebit: 100.01 },
      { accountCode: '21101001', accountName: 'موردون', netDebit: -100 },
    ];
    expect(balanceSheetGapFromNets(balances)).toBe(0.01);
    expect(isBalanceSheetBalanced(0.01)).toBe(true);
    expect(isBalanceSheetBalanced(1)).toBe(true);
    expect(isBalanceSheetBalanced(1.01)).toBe(false);
    const entries = buildOpeningBalanceEntries(balances);
    const dr = roundMoney(entries.reduce((s, e) => s + e.debit, 0));
    const cr = roundMoney(entries.reduce((s, e) => s + e.credit, 0));
    expect(dr).toBe(cr);
    const re = entries.find((e) => e.accountCode === AccountCodes.RETAINED_EARNINGS);
    expect(re?.credit).toBe(0.01);
  });
});
