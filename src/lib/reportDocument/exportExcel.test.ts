import { describe, expect, it } from 'vitest';
import { buildReportDocumentExcelAoA } from './exportExcel';
import type { ReportDocument } from './types';

function stubDoc(over: Partial<ReportDocument>): ReportDocument {
  return {
    id: 'cash_budget',
    title: 'Cash budget',
    language: 'ar',
    orientation: 'landscape',
    pageSize: 'A4',
    accent: '#003B71',
    showHeader: true,
    showFooter: true,
    showLogo: false,
    fontFamily: 'calibri',
    textDirection: 'auto',
    titleAlign: 'center',
    footerAlign: 'center',
    logoAlign: 'start',
    marginPreset: 'normal',
    fitPageCount: 0,
    density: 'normal',
    headerShowCompany: true,
    headerShowAddress: false,
    headerShowTaxId: false,
    headerShowTitle: true,
    headerShowMeta: true,
    headerExtraText: '',
    footerShowCompany: true,
    footerShowText: true,
    footerShowNote: true,
    footerShowPageNum: true,
    footerExtraText: '',
    company: { companyName: 'Co' },
    columns: [],
    rows: [],
    filename: 'cash-budget',
    ...over,
  };
}

describe('buildReportDocumentExcelAoA', () => {
  it('stacks title, summary, and tables into a single sheet array', () => {
    const aoa = buildReportDocumentExcelAoA(
      stubDoc({
        scopeLabel: 'CB-1 · 2026-08-17 → 2026-08-23',
        sections: [
          {
            kind: 'keyValue',
            title: 'Summary',
            items: [
              { label: 'Banks', value: '50,000.00' },
              { label: 'Obligations', value: '40,000.00' },
            ],
          },
          {
            kind: 'table',
            title: 'Obligations',
            columns: [
              { key: 'description', header: 'Account' },
              { key: 'amount', header: 'Amount', money: true },
            ],
            rows: [{ description: 'Supplier A', amount: 30000 }],
            totals: { amount: 30000 },
            totalsLabel: 'Total',
          },
          {
            kind: 'table',
            title: 'By project',
            columns: [
              { key: 'name', header: 'Project' },
              { key: 'obligation', header: 'Obligation', money: true },
            ],
            rows: [{ name: 'Nile', obligation: 30000 }],
          },
        ],
        footerNote: 'Banks: 50000',
      }),
      (n) => n.toFixed(2),
    );
    expect(aoa[0]).toEqual(['Cash budget']);
    expect(aoa[1]).toEqual(['CB-1 · 2026-08-17 → 2026-08-23']);
    expect(aoa.some((r) => r[0] === 'Summary')).toBe(true);
    expect(aoa.some((r) => r[0] === 'Banks' && r[1] === '50,000.00')).toBe(true);
    expect(aoa.some((r) => r[0] === 'Obligations')).toBe(true);
    expect(aoa.some((r) => r[0] === 'Supplier A' && r[1] === 30000)).toBe(true);
    expect(aoa.some((r) => r[0] === 'By project')).toBe(true);
    expect(aoa.some((r) => r[0] === 'Nile' && r[1] === 30000)).toBe(true);
    expect(aoa[aoa.length - 1]).toEqual(['Banks: 50000']);
  });
});
