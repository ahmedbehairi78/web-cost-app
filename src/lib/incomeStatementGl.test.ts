import { describe, expect, it } from 'vitest';
import {
  buildIncomeStatementLeafBalances,
  buildIncomeStatementTotals,
  entryMatchesProjectFilter,
  isExcludedFromIncomeStatement,
  transactionMatchesProjectFilter,
} from './incomeStatementGl';

describe('buildIncomeStatementLeafBalances', () => {
  it('sums every journal line on the same account within one transaction', () => {
    const leafBalances = buildIncomeStatementLeafBalances(
      [
        {
          costCenterId: null,
          entries: [
            { accountCode: '52101001', accountName: 'رواتب', debit: 65682, credit: 0, costCenterId: 'cc-a' },
            { accountCode: '52101001', accountName: 'رواتب', debit: 16455, credit: 0, costCenterId: 'cc-b' },
            { accountCode: '52101001', accountName: 'رواتب', debit: 19500, credit: 0, costCenterId: 'cc-c' },
            { accountCode: '52101001', accountName: 'رواتب', debit: 14000, credit: 0, costCenterId: 'cc-d' },
            { accountCode: '21501003', accountName: 'رواتب مستحقة', debit: 0, credit: 115637, costCenterId: null },
          ],
        },
      ],
      ['52101001', '52102001'],
    );

    expect(leafBalances['52101001']).toBe(115637);
    expect(leafBalances['52102001']).toBe(0);
  });

  it('matches backup PAY-style undercount regression (find vs filter)', () => {
    const tx = {
      entries: [
        { accountCode: '52101001', accountName: 'رواتب', debit: 65682, credit: 0 },
        { accountCode: '51102001', accountName: 'عمالة', debit: 29705, credit: 0 },
        { accountCode: '52101001', accountName: 'رواتب', debit: 16455, credit: 0 },
        { accountCode: '52101001', accountName: 'رواتب', debit: 19500, credit: 0 },
        { accountCode: '52101001', accountName: 'رواتب', debit: 14000, credit: 0 },
      ],
    };
    const buggyFind = (tx.entries || []).find((e) => e.accountCode === '52101001');
    const findAmount = buggyFind ? buggyFind.debit - buggyFind.credit : 0;
    expect(findAmount).toBe(65682);

    const leafBalances = buildIncomeStatementLeafBalances([tx], ['52101001']);
    expect(leafBalances['52101001']).toBe(115637);
  });

  it('respects entry cost-center filter', () => {
    const leafBalances = buildIncomeStatementLeafBalances(
      [
        {
          costCenterId: 'header-cc',
          entries: [
            { accountCode: '52101001', accountName: 'رواتب', debit: 100, credit: 0, costCenterId: 'cc-a' },
            { accountCode: '52101001', accountName: 'رواتب', debit: 50, credit: 0, costCenterId: 'cc-b' },
          ],
        },
      ],
      ['52101001'],
      (_t, e) => (e.costCenterId ?? _t.costCenterId) === 'cc-a',
    );
    expect(leafBalances['52101001']).toBe(100);
  });
});

describe('isExcludedFromIncomeStatement', () => {
  it('excludes fiscal_pl_close and YE-PL references', () => {
    expect(isExcludedFromIncomeStatement({ journalKind: 'fiscal_pl_close' })).toBe(true);
    expect(isExcludedFromIncomeStatement({ journalKind: null, reference: 'YE-PL-2026' })).toBe(true);
    expect(isExcludedFromIncomeStatement({ journalKind: 'fiscal_opening', reference: 'OPEN-2027' })).toBe(false);
    expect(isExcludedFromIncomeStatement({ journalKind: null, reference: 'PAY-001' })).toBe(false);
  });
});

describe('buildIncomeStatementTotals with pl close', () => {
  it('keeps contract costs when fiscal_pl_close is filtered out (all-projects case)', () => {
    const leaves = ['41101001', '51101001', '52101001'];
    const activity = [
      {
        projectId: 'bel',
        entries: [
          { accountCode: '51101001', accountName: 'مواد', debit: 175516.56, credit: 0 },
          { accountCode: '21101001', accountName: 'مورد', debit: 0, credit: 175516.56 },
        ],
      },
      {
        projectId: 'bel',
        entries: [
          { accountCode: '41101001', accountName: 'إيراد', debit: 0, credit: 200000 },
          { accountCode: '12201001', accountName: 'عملاء', debit: 200000, credit: 0 },
        ],
      },
    ];
    const close = {
      projectId: null,
      journalKind: 'fiscal_pl_close',
      reference: 'YE-PL-2026',
      entries: [
        { accountCode: '41101001', accountName: 'إيراد', debit: 200000, credit: 0 },
        { accountCode: '51101001', accountName: 'مواد', debit: 0, credit: 175516.56 },
        { accountCode: '31301001', accountName: 'أرباح', debit: 0, credit: 24483.44 },
      ],
    };

    const withClose = buildIncomeStatementTotals([...activity, close], leaves);
    expect(withClose.contractCosts).toBeCloseTo(0, 2);
    expect(withClose.revenue).toBeCloseTo(0, 2);

    const withoutClose = buildIncomeStatementTotals(
      [...activity, close].filter((t) => !isExcludedFromIncomeStatement(t)),
      leaves,
    );
    expect(withoutClose.contractCosts).toBeCloseTo(175516.56, 2);
    expect(withoutClose.revenue).toBeCloseTo(200000, 2);
    expect(withoutClose.grossContractProfit).toBeCloseTo(24483.44, 2);
    expect(withoutClose.profitBeforeTax).toBeCloseTo(24483.44, 2);
  });
});

describe('project filter helpers', () => {
  const contractIds = new Set(['c-bel-1']);

  it('matches by projectId or contract cost center', () => {
    expect(
      transactionMatchesProjectFilter({ projectId: 'bel', costCenterId: null, entries: [] }, 'bel', contractIds),
    ).toBe(true);
    expect(
      transactionMatchesProjectFilter(
        { projectId: null, costCenterId: 'c-bel-1', entries: [] },
        'bel',
        contractIds,
      ),
    ).toBe(true);
    expect(
      transactionMatchesProjectFilter(
        { projectId: 'other', costCenterId: null, entries: [{ costCenterId: 'c-other' }] },
        'bel',
        contractIds,
      ),
    ).toBe(false);
  });

  it('filters entries by project cost centers', () => {
    expect(
      entryMatchesProjectFilter(
        { projectId: 'bel', costCenterId: null },
        { costCenterId: 'c-bel-1' },
        'bel',
        contractIds,
      ),
    ).toBe(true);
    expect(
      entryMatchesProjectFilter(
        { projectId: 'bel', costCenterId: null },
        { costCenterId: 'c-other' },
        'bel',
        contractIds,
      ),
    ).toBe(false);
    expect(
      entryMatchesProjectFilter(
        { projectId: 'bel', costCenterId: null },
        { costCenterId: null },
        'bel',
        contractIds,
      ),
    ).toBe(true);
  });
});
