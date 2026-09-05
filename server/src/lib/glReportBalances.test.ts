import { describe, expect, it } from 'vitest';
import {
  computeBalanceSheetSummary,
  isExcludedFiscalOpeningJournal,
  splitNetToDebitCredit,
  trialRowsFromOpeningAndMovements,
} from './glReportBalances.js';

describe('isExcludedFiscalOpeningJournal', () => {
  it('excludes fiscal_opening and OPEN- references', () => {
    expect(isExcludedFiscalOpeningJournal({ journalKind: 'fiscal_opening' })).toBe(true);
    expect(isExcludedFiscalOpeningJournal({ journalKind: null, reference: 'OPEN-2027-H1' })).toBe(
      true,
    );
    expect(isExcludedFiscalOpeningJournal({ journalKind: 'fiscal_pl_close', reference: 'YE-PL-H1' })).toBe(
      false,
    );
    expect(isExcludedFiscalOpeningJournal({ journalKind: null, reference: 'INV-1' })).toBe(false);
  });
});

describe('trialRowsFromOpeningAndMovements', () => {
  it('builds closing nets and drops empty rows', () => {
    const rows = trialRowsFromOpeningAndMovements([
      { accountCode: '41101001', openingNet: -100, debitMovements: 100, creditMovements: 0 },
      { accountCode: '31301001', openingNet: 0, debitMovements: 0, creditMovements: 50 },
      { accountCode: '999', openingNet: 0, debitMovements: 0, creditMovements: 0 },
    ]);
    expect(rows).toHaveLength(2);
    const rev = rows.find((r) => r.accountCode === '41101001')!;
    expect(rev.closingNet).toBe(0);
    const re = rows.find((r) => r.accountCode === '31301001')!;
    expect(re.closingNet).toBe(-50);
    expect(splitNetToDebitCredit(re.closingNet)).toEqual({ debit: 0, credit: 50 });
  });
});

describe('computeBalanceSheetSummary', () => {
  it('treats unclosed P&L as gap when equity is prefix 3 only', () => {
    const summary = computeBalanceSheetSummary({
      '12101001': 1000,
      '21101001': -400,
      '31101001': -200,
      '41101001': -500,
      '51101001': 100,
    });
    expect(summary.totalAssets).toBe(1000);
    expect(summary.totalLiab).toBe(400);
    expect(summary.equityAccounts).toBe(200);
    expect(summary.unclosedPeriodPl).toBe(400); // 500 revenue - 100 costs
    expect(summary.balanceGap).toBe(400); // assets 1000 - (400+200)
    expect(summary.isBalanced).toBe(false);
  });

  it('balances after P&L close into retained earnings', () => {
    const summary = computeBalanceSheetSummary({
      '12101001': 1000,
      '21101001': -400,
      '31101001': -200,
      '31301001': -400, // closed profit
      // 4/5 zeroed
    });
    expect(summary.unclosedPeriodPl).toBeCloseTo(0);
    expect(summary.equityAccounts).toBe(600);
    expect(summary.balanceGap).toBeCloseTo(0);
    expect(summary.isBalanced).toBe(true);
  });
});
