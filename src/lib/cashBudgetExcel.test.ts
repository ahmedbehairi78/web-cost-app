import { describe, expect, it } from 'vitest';
import { buildCashBudgetExcelWorkbook } from './cashBudgetExcel';

const labels = {
  sheetSummary: 'Summary',
  sheetObligations: 'Obligations',
  sheetProjects: 'Projects',
  sheetCustody: 'Custody',
  periodNumber: 'Period',
  periodType: 'Type',
  periodStart: 'Start',
  periodEnd: 'End',
  status: 'Status',
  settlementPct: 'Settlement %',
  kpiBanks: 'Banks',
  kpiCash: 'Cash',
  kpiSources: 'Receivables',
  kpiObligations: 'Obligations',
  kpiGap: 'Gap',
  kpiPayPlan: 'Pay plan',
  colAccount: 'Account',
  colProject: 'Project',
  colCategory: 'Category',
  colAmount: 'Amount',
  colAllocated: 'Allocated',
  colAllocPct: 'Share %',
  colExcluded: 'Excluded',
  colOrigin: 'Origin',
  colObligationTotal: 'Obligation total',
  colAllocatedTotal: 'Allocated total',
  colGlBalance: 'GL',
  colMinBalance: 'Min',
  colReplenish: 'Replenish',
  yes: 'Yes',
  no: 'No',
};

describe('buildCashBudgetExcelWorkbook', () => {
  it('builds summary, obligation, project, and custody tables', () => {
    const wb = buildCashBudgetExcelWorkbook({
      labels,
      summary: {
        periodNumber: 'CB-2026-001',
        periodType: 'Weekly',
        periodStart: '2026-08-17',
        periodEnd: '2026-08-23',
        status: 'Draft',
        settlementPct: 100,
        banks: 50000,
        cash: 10000,
        collections: 20000,
        obligations: 40000,
        gap: 40000,
        payPlan: 40000,
      },
      lines: [
        {
          account: 'Supplier A',
          project: 'Nile',
          category: 'Suppliers',
          amount: 30000,
          allocated: 30000,
          allocPct: 75,
          excluded: false,
          origin: 'GL',
        },
        {
          account: 'Skip me',
          project: '—',
          category: 'Other',
          amount: 1000,
          allocated: 0,
          allocPct: 0,
          excluded: true,
          origin: 'Manual',
        },
      ],
      projects: [{ name: 'Nile', obligation: 30000, allocated: 30000, pct: 75 }],
      custody: [
        { account: '12102001 — Site', glBalance: 5000, minBalance: 8000, replenish: 3000 },
      ],
    });
    expect(wb.summary[0]).toEqual(['Period', 'CB-2026-001']);
    expect(wb.summary.find((r) => r[0] === 'Banks')).toEqual(['Banks', 50000]);
    expect(wb.obligations[0][0]).toBe('Account');
    expect(wb.obligations[1][0]).toBe('Supplier A');
    expect(wb.obligations[2][6]).toBe('Yes');
    expect(wb.projects[1]).toEqual(['Nile', 30000, 30000, 75]);
    expect(wb.custody[1][3]).toBe(3000);
  });
});
