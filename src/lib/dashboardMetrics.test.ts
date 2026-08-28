import { describe, expect, it } from 'vitest';
import { AccountCodes } from '../services/accountingService';
import {
  accumulateOperatingExpenseBuckets,
  buildCashFlowSeries,
  buildContractProgressPieSlices,
  buildMonthlySeries,
  buildProjectCompareRows,
  DASHBOARD_UNALLOCATED_PROJECT_ID,
  defaultDashboardFilters,
  filterDashboardTransactions,
  inclusiveDaySpan,
  isFiscalMemoJournal,
  buildDailySeries,
  materialSpentByDay,
  materialSpentByMonth,
  materialSpentByProject,
  percentDelta,
  previousPeriodRange,
  resolveDatePreset,
  sumMaterialSpent,
} from './dashboardMetrics';

describe('previousPeriodRange / inclusiveDaySpan', () => {
  it('computes same-length previous window', () => {
    expect(inclusiveDaySpan('2026-01-01', '2026-01-31')).toBe(31);
    const prev = previousPeriodRange('2026-02-01', '2026-02-28');
    expect(prev).toEqual({ dateFrom: '2026-01-04', dateTo: '2026-01-31' });
  });
});

describe('resolveDatePreset', () => {
  it('resolves year from Jan 1 to today', () => {
    const today = new Date(2026, 6, 28);
    expect(resolveDatePreset('year', today)).toEqual({
      dateFrom: '2026-01-01',
      dateTo: '2026-07-28',
    });
  });

  it('resolves quarter', () => {
    const today = new Date(2026, 6, 28);
    expect(resolveDatePreset('quarter', today)).toEqual({
      dateFrom: '2026-07-01',
      dateTo: '2026-07-28',
    });
  });

  it('all clears dates', () => {
    expect(resolveDatePreset('all')).toEqual({ dateFrom: '', dateTo: '' });
  });
});

describe('percentDelta', () => {
  it('computes relative change', () => {
    expect(percentDelta(120, 100)).toBeCloseTo(20);
    expect(percentDelta(0, 0)).toBe(0);
    expect(percentDelta(50, 0)).toBeNull();
  });
});

describe('filterDashboardTransactions', () => {
  const txs = [
    {
      id: '1',
      date: '2026-03-15',
      projectId: 'p1',
      costCenterId: 'c1',
      entries: [{ accountCode: AccountCodes.BANK, debit: 1, credit: 0 }],
    },
    {
      id: '2',
      date: '2026-05-01',
      projectId: 'p2',
      costCenterId: 'c2',
      entries: [{ accountCode: AccountCodes.BANK, debit: 1, credit: 0 }],
    },
  ];
  const map = new Map([['c1', 'p1'], ['c2', 'p2']]);

  it('filters by date and project', () => {
    const out = filterDashboardTransactions(
      txs,
      { dateFrom: '2026-01-01', dateTo: '2026-04-30', projectId: 'p1', contractId: '' },
      map,
    );
    expect(out.map((t) => t.id)).toEqual(['1']);
  });

  it('filters by contract', () => {
    const out = filterDashboardTransactions(
      txs,
      { dateFrom: '', dateTo: '', projectId: 'all', contractId: 'c2' },
      map,
    );
    expect(out.map((t) => t.id)).toEqual(['2']);
  });
});

describe('material spent helpers', () => {
  const rows = [
    { contractId: 'c1', projectId: 'p1', totalSpent: 100, month: '2026-01' },
    { contractId: 'c2', projectId: 'p1', totalSpent: 50, month: '2026-02' },
    { contractId: 'c3', projectId: 'p2', totalSpent: 80, month: '2026-01' },
  ];

  it('sums and filters materials', () => {
    expect(sumMaterialSpent(rows)).toBe(230);
    expect(sumMaterialSpent(rows, { projectIdFilter: 'p1' })).toBe(150);
    expect(sumMaterialSpent(rows, { contractIdFilter: 'c3' })).toBe(80);
  });

  it('groups by month and project', () => {
    expect(materialSpentByMonth(rows).get('2026-01')).toBe(180);
    expect(materialSpentByProject(rows).get('p1')).toBe(150);
  });
});

describe('buildMonthlySeries', () => {
  it('aggregates revenue cost collections by month', () => {
    const txs = [
      {
        id: 'a',
        date: '2026-01-10',
        entries: [
          { accountCode: AccountCodes.BANK, debit: 1000, credit: 0 },
          { accountCode: AccountCodes.RECEIVABLES, debit: 0, credit: 1000 },
        ],
      },
      {
        id: 'b',
        date: '2026-01-20',
        entries: [
          { accountCode: AccountCodes.EXPENSE_LABOUR, debit: 200, credit: 0 },
          { accountCode: AccountCodes.CASH, debit: 0, credit: 200 },
        ],
      },
      {
        id: 'c',
        date: '2026-02-05',
        entries: [
          { accountCode: AccountCodes.RECEIVABLES, debit: 500, credit: 0 },
          { accountCode: AccountCodes.REVENUE, debit: 0, credit: 500 },
        ],
      },
    ];
    const series = buildMonthlySeries(txs, txs, 'en-US', 'cloud');
    expect(series).toHaveLength(2);
    expect(series[0].collections).toBe(1000);
    expect(series[0].cost).toBe(200);
    expect(series[1].revenue).toBe(500);
    expect(series[1].cumulativeCollections).toBe(1000);
  });

  it('adds materials into monthly cost so chart matches KPI', () => {
    const txs = [
      {
        id: 'b',
        date: '2026-01-20',
        entries: [
          { accountCode: AccountCodes.EXPENSE_LABOUR, debit: 200, credit: 0 },
          { accountCode: AccountCodes.CASH, debit: 0, credit: 200 },
        ],
      },
    ];
    const series = buildMonthlySeries(
      txs,
      txs,
      'en-US',
      'cloud',
      new Map([['2026-01', 50]]),
    );
    expect(series[0].cost).toBe(250);
    expect(series[0].cumulativeCost).toBe(250);
  });

  it('daily series is non-cumulative (period values only)', () => {
    const txs = [
      {
        id: 'a',
        date: '2026-01-10',
        entries: [
          { accountCode: AccountCodes.BANK, debit: 1000, credit: 0 },
          { accountCode: AccountCodes.RECEIVABLES, debit: 0, credit: 1000 },
        ],
      },
      {
        id: 'b',
        date: '2026-01-11',
        entries: [
          { accountCode: AccountCodes.BANK, debit: 400, credit: 0 },
          { accountCode: AccountCodes.RECEIVABLES, debit: 0, credit: 400 },
        ],
      },
    ];
    const series = buildDailySeries(txs, txs, 'en-US', 'cloud');
    expect(series).toHaveLength(2);
    expect(series[0].collections).toBe(1000);
    expect(series[1].collections).toBe(400);
    // Cumulative still computed for compatibility — chart must use period fields.
    expect(series[1].cumulativeCollections).toBe(1400);
  });

  it('keeps every month of the window on the axis, null (not zero) when idle', () => {
    const txs = [
      {
        id: 'a',
        date: '2026-02-03',
        entries: [
          { accountCode: AccountCodes.BANK, debit: 500, credit: 0 },
          { accountCode: AccountCodes.RECEIVABLES, debit: 0, credit: 500 },
        ],
      },
      {
        id: 'b',
        date: '2026-04-10',
        entries: [
          { accountCode: AccountCodes.BANK, debit: 300, credit: 0 },
          { accountCode: AccountCodes.RECEIVABLES, debit: 0, credit: 300 },
        ],
      },
    ];
    const series = buildCashFlowSeries(txs, txs, 'en-US', 'cloud', {
      grain: 'month',
      dateFrom: '2026-01-01',
      dateTo: '2026-04-30',
      includeOrigin: true,
      originLabel: 'Start',
    });
    expect(series.map((p) => p.key)).toEqual([
      '__start__',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
    ]);
    // Origin is always zero so the curve starts at the baseline.
    expect(series[0]).toMatchObject({ revenue: 0, cost: 0, collections: 0 });
    // Idle months skip the line (connectNulls) instead of dropping to zero.
    expect(series[1].collections).toBeNull();
    expect(series[2].collections).toBe(500);
    expect(series[3].collections).toBeNull();
    expect(series[4].collections).toBe(300);
    // Metrics are independent — no revenue anywhere after the origin.
    expect(series.slice(1).every((p) => p.revenue === null)).toBe(true);
  });

  it('rises and falls with each month total from a zero origin', () => {
    const txs = [
      {
        id: 'm1',
        date: '2026-01-20',
        entries: [
          { accountCode: AccountCodes.RECEIVABLES, debit: 150000, credit: 0 },
          { accountCode: AccountCodes.REVENUE, debit: 0, credit: 150000 },
        ],
      },
      {
        id: 'm2',
        date: '2026-02-15',
        entries: [
          { accountCode: AccountCodes.RECEIVABLES, debit: 100000, credit: 0 },
          { accountCode: AccountCodes.REVENUE, debit: 0, credit: 100000 },
        ],
      },
    ];
    const series = buildCashFlowSeries(txs, txs, 'en-US', 'cloud', {
      grain: 'month',
      includeOrigin: true,
    });
    expect(series.map((p) => p.revenue)).toEqual([0, 150000, 100000]);
  });

  it('rolls materials by day into daily cost', () => {
    const txs = [
      {
        id: 'b',
        date: '2026-01-20',
        entries: [
          { accountCode: AccountCodes.EXPENSE_LABOUR, debit: 100, credit: 0 },
          { accountCode: AccountCodes.CASH, debit: 0, credit: 100 },
        ],
      },
    ];
    const series = buildDailySeries(
      txs,
      txs,
      'en-US',
      'cloud',
      new Map([['2026-01-20', 50]]),
    );
    expect(series[0].cost).toBe(150);
    expect(materialSpentByDay([{ contractId: 'c1', day: '2026-01-20', totalSpent: 50 }]).get('2026-01-20')).toBe(
      50,
    );
  });
});

describe('buildProjectCompareRows', () => {
  it('aggregates liquidity columns per project', () => {
    const contracts = [
      { id: 'c1', projectId: 'p1' },
      { id: 'c2', projectId: 'p1' },
    ];
    const billing = [
      {
        contractId: 'c1',
        status: 'approved',
        worksValueExVat: 1000,
        vatAmount: 140,
        netPayable: 1000,
      },
      {
        contractId: 'c2',
        status: 'approved',
        worksValueExVat: 500,
        vatAmount: 0,
        netPayable: 500,
      },
    ];
    const txs = [
      {
        id: 't1',
        date: '2026-03-01',
        projectId: 'p1',
        costCenterId: 'c1',
        entries: [
          { accountCode: AccountCodes.BANK, debit: 400, credit: 0 },
          { accountCode: AccountCodes.RECEIVABLES, debit: 0, credit: 400 },
        ],
      },
    ];
    const rows = buildProjectCompareRows({
      projects: [{ id: 'p1', projectName: 'Alpha' }],
      boqItems: [{ projectId: 'p1', tenderAmount: 10000 }],
      contracts,
      billing,
      filteredTxs: txs,
      allTxsForChequePairing: txs,
      expenseMode: 'cloud',
      projectIdFilter: 'all',
      contractIdFilter: '',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].billed).toBe(1640);
    expect(rows[0].ipcCollected).toBe(400);
    expect(rows[0].budget).toBe(10000);
    expect(rows[0].collectionPct).toBeCloseTo(24.4, 0);
    expect(rows[0].progressPct).toBeCloseTo(16.4, 0);
    expect(rows[0].progressStatus).toBe('running');
  });

  it('adds materials and unallocated G&A into spent so Σ matches company total', () => {
    const contracts = [{ id: 'c1', projectId: 'p1' }];
    const txs = [
      {
        id: 't1',
        date: '2026-03-01',
        projectId: 'p1',
        costCenterId: 'c1',
        entries: [
          { accountCode: AccountCodes.EXPENSE_LABOUR, debit: 100, credit: 0 },
          { accountCode: AccountCodes.CASH, debit: 0, credit: 100 },
        ],
      },
      {
        id: 't2',
        date: '2026-03-02',
        // no project / contract — G&A
        entries: [
          { accountCode: AccountCodes.EXPENSE_ADMIN, debit: 40, credit: 0 },
          { accountCode: AccountCodes.CASH, debit: 0, credit: 40 },
        ],
      },
    ];
    const rows = buildProjectCompareRows({
      projects: [{ id: 'p1', projectName: 'Alpha' }],
      boqItems: [],
      contracts,
      billing: [],
      filteredTxs: txs,
      allTxsForChequePairing: txs,
      expenseMode: 'cloud',
      projectIdFilter: 'all',
      contractIdFilter: '',
      materialByProject: new Map([['p1', 25]]),
      unallocatedLabel: 'Fixed costs',
    });
    const projectRow = rows.find((r) => r.projectId === 'p1');
    const unalloc = rows.find((r) => r.projectId === DASHBOARD_UNALLOCATED_PROJECT_ID);
    expect(projectRow?.spent).toBe(125);
    expect(unalloc?.spent).toBe(40);
    expect(unalloc?.isUnallocated).toBe(true);
    expect(rows.reduce((s, r) => s + r.spent, 0)).toBe(165);
  });

  it('moves OHA pool from unallocated onto contracts via line cost centers', () => {
    const contracts = [{ id: 'c1', projectId: 'p1' }];
    const txs = [
      {
        id: 'ga',
        date: '2026-04-01',
        costCenterId: 'HO-001',
        entries: [
          { accountCode: AccountCodes.EXPENSE_ADMIN, debit: 100, credit: 0, costCenterId: 'HO-001' },
          { accountCode: AccountCodes.CASH, debit: 0, credit: 100 },
        ],
      },
      {
        id: 'oha',
        date: '2026-04-30',
        reference: 'OHA-Q2-2026-HO-001',
        entries: [
          {
            accountCode: '51201001',
            debit: 100,
            credit: 0,
            costCenterId: 'c1',
          },
          {
            accountCode: AccountCodes.EXPENSE_ADMIN,
            debit: 0,
            credit: 100,
            costCenterId: 'HO-001',
          },
        ],
      },
      {
        id: 'ye',
        date: '2026-06-30',
        journalKind: 'fiscal_pl_close',
        reference: 'YE-PL-H1',
        entries: [
          { accountCode: AccountCodes.EXPENSE_ADMIN, debit: 0, credit: 100 },
          { accountCode: AccountCodes.RETAINED_EARNINGS, debit: 100, credit: 0 },
        ],
      },
    ];
    const rows = buildProjectCompareRows({
      projects: [{ id: 'p1', projectName: 'Alpha' }],
      boqItems: [],
      contracts,
      billing: [],
      filteredTxs: txs,
      allTxsForChequePairing: txs,
      expenseMode: 'cloud',
      projectIdFilter: 'all',
      contractIdFilter: '',
    });
    const projectRow = rows.find((r) => r.projectId === 'p1');
    const unalloc = rows.find((r) => r.projectId === DASHBOARD_UNALLOCATED_PROJECT_ID);
    expect(projectRow?.spent).toBe(100);
    expect(unalloc).toBeUndefined();
  });
});

describe('isFiscalMemoJournal / accumulateOperatingExpenseBuckets', () => {
  it('detects fiscal memo journals', () => {
    expect(isFiscalMemoJournal({ journalKind: 'fiscal_pl_close' })).toBe(true);
    expect(isFiscalMemoJournal({ reference: 'OPEN-2027' })).toBe(true);
    expect(isFiscalMemoJournal({ reference: 'OHA-Q1' })).toBe(false);
  });

  it('attributes OHA lines to project vs pool', () => {
    const map = new Map([['c1', 'p1']]);
    const buckets = accumulateOperatingExpenseBuckets(
      {
        entries: [
          {
            accountCode: '51201001',
            debit: 80,
            credit: 0,
            costCenterId: 'c1',
          },
          {
            accountCode: AccountCodes.EXPENSE_ADMIN,
            debit: 0,
            credit: 80,
            costCenterId: 'HO-001',
          },
        ],
      },
      'cloud',
      map,
    );
    expect(buckets.byProject.get('p1')).toBe(80);
    expect(buckets.unallocated).toBe(-80);
    expect(buckets.total).toBe(0);
  });
});

describe('buildContractProgressPieSlices', () => {
  it('shares completed billed value across all contracts when project=all', () => {
    const contracts = [
      { id: 'c1', projectId: 'p1', contractNumber: 'C-1' },
      { id: 'c2', projectId: 'p2', contractNumber: 'C-2' },
    ];
    const billing = [
      {
        contractId: 'c1',
        status: 'approved',
        worksValueExVat: 750,
        vatAmount: 0,
        netPayable: 750,
      },
      {
        contractId: 'c2',
        status: 'approved',
        worksValueExVat: 250,
        vatAmount: 0,
        netPayable: 250,
      },
    ];
    const slices = buildContractProgressPieSlices({
      projects: [
        { id: 'p1', projectName: 'Alpha' },
        { id: 'p2', projectName: 'Beta' },
      ],
      boqItems: [
        { projectId: 'p1', contractId: 'c1', tenderAmount: 1000 },
        { projectId: 'p2', contractId: 'c2', tenderAmount: 1000 },
      ],
      contracts,
      billing,
      filteredTxs: [],
      projectIdFilter: 'all',
    });
    expect(slices).toHaveLength(2);
    expect(slices[0].sharePct).toBe(75);
    expect(slices[1].sharePct).toBe(25);
    expect(slices[0].color).toBeTruthy();
    expect(slices[0].name).toContain('—');
    expect(slices[0].color).not.toBe(slices[1].color);
  });

  it('scopes shares to contracts of the selected project only', () => {
    const contracts = [
      { id: 'c1', projectId: 'p1', contractNumber: 'A-1' },
      { id: 'c2', projectId: 'p1', contractNumber: 'A-2' },
      { id: 'c3', projectId: 'p2', contractNumber: 'B-1' },
    ];
    const billing = [
      { contractId: 'c1', status: 'approved', worksValueExVat: 400, vatAmount: 0 },
      { contractId: 'c2', status: 'approved', worksValueExVat: 100, vatAmount: 0 },
      { contractId: 'c3', status: 'approved', worksValueExVat: 900, vatAmount: 0 },
    ];
    const slices = buildContractProgressPieSlices({
      projects: [
        { id: 'p1', projectName: 'Beel' },
        { id: 'p2', projectName: 'Other' },
      ],
      boqItems: [
        { projectId: 'p1', contractId: 'c1', tenderAmount: 1000 },
        { projectId: 'p1', contractId: 'c2', tenderAmount: 1000 },
        { projectId: 'p2', contractId: 'c3', tenderAmount: 1000 },
      ],
      contracts,
      billing,
      filteredTxs: [],
      projectIdFilter: 'p1',
    });
    expect(slices).toHaveLength(2);
    expect(slices.every((s) => s.projectId === 'p1')).toBe(true);
    expect(slices[0].sharePct).toBe(80);
    expect(slices[1].sharePct).toBe(20);
    expect(slices[0].name.includes('—')).toBe(false);
  });

  it('includes approved MOS claimed so IPC-only + MOS-only contracts both appear', () => {
    const slices = buildContractProgressPieSlices({
      projects: [{ id: 'p1', projectName: 'Beel' }],
      boqItems: [
        { projectId: 'p1', contractId: 'arcmen', tenderAmount: 1000 },
        { projectId: 'p1', contractId: 'concord', tenderAmount: 1000 },
      ],
      contracts: [
        { id: 'arcmen', projectId: 'p1', contractNumber: 'Arcmen' },
        { id: 'concord', projectId: 'p1', contractNumber: 'Concord' },
      ],
      billing: [
        { contractId: 'arcmen', status: 'approved', worksValueExVat: 600, vatAmount: 0 },
      ],
      filteredTxs: [],
      projectIdFilter: 'p1',
      mosClaims: [
        { contractId: 'concord', status: 'approved', totalClaimed: 400 },
        { contractId: 'concord', status: 'draft', totalClaimed: 999 },
      ],
    });
    expect(slices).toHaveLength(2);
    expect(slices.find((s) => s.contractId === 'arcmen')?.sharePct).toBe(60);
    expect(slices.find((s) => s.contractId === 'concord')?.sharePct).toBe(40);
    expect(slices.find((s) => s.contractId === 'concord')?.completedValue).toBe(400);
    expect(slices[0].color).not.toBe(slices[1].color);
  });
});

describe('defaultDashboardFilters', () => {
  it('defaults to year-to-date', () => {
    const f = defaultDashboardFilters(new Date(2026, 0, 15));
    expect(f.dateFrom).toBe('2026-01-01');
    expect(f.projectId).toBe('all');
  });
});
