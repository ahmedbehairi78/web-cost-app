import { describe, expect, it } from 'vitest';
import { buildTableReportDocument } from './buildTableDoc';
import { formatDocCell, isNumericReportColumn } from './types';
import { buildReportsModuleDocument } from './buildReportsModuleDoc';
import {
  buildIncomeStatementPrintRows,
  buildBalanceSheetPrintRows,
  buildSchedulePrintRows,
} from './buildAnalyticalPrintRows';
import { renderReportDocumentHtml } from './renderHtml';

const company = {
  companyName: 'شركة اختبار',
  companyNameEn: 'Test Co',
  footerText: 'footer',
};

describe('reportDocument', () => {
  it('builds table document from profile defaults', () => {
    const doc = buildTableReportDocument({
      reportId: 'budget',
      title: 'Budget',
      language: 'ar',
      company,
      columns: [
        { key: 'a', header: 'A', width: 50 },
        { key: 'b', header: 'B', width: 50, money: true },
      ],
      rows: [{ a: 'x', b: 10.5 }],
      filename: 't',
    });
    expect(doc.orientation).toBe('landscape');
    expect(doc.pageSize).toBe('A4');
    expect(doc.rows).toHaveLength(1);
    expect(doc.showHeader).toBe(true);
  });

  it('formats money cells', () => {
    expect(formatDocCell(12.5, { key: 'x', header: 'X', money: true }, (n) => n.toFixed(2))).toBe('12.50');
    expect(formatDocCell(-72.5, { key: 'x', header: 'X', money: true }, (n) => n.toFixed(2))).toBe('(72.50)');
    expect(formatDocCell('', { key: 'x', header: 'X' }, (n) => String(n))).toBe('');
    expect(formatDocCell(null, { key: 'x', header: 'X' }, (n) => String(n))).toBe('—');
  });

  it('marks money columns as numeric', () => {
    expect(isNumericReportColumn({ key: 'a', header: 'A', money: true })).toBe(true);
    expect(isNumericReportColumn({ key: 'a', header: 'A', numeric: true })).toBe(true);
    expect(isNumericReportColumn({ key: 'a', header: 'A' })).toBe(false);
  });

  it('renders numeric cells with LTR decimal alignment wrapper', () => {
    const html = renderReportDocumentHtml(
      {
        id: 't',
        title: 'T',
        language: 'ar',
        orientation: 'portrait',
        pageSize: 'A4',
        accent: '#003B71',
        showHeader: true,
        showFooter: false,
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
        headerShowAddress: true,
        headerShowTaxId: true,
        headerShowTitle: true,
        headerShowMeta: true,
        headerExtraText: '',
        footerShowCompany: true,
        footerShowText: true,
        footerShowNote: true,
        footerShowPageNum: true,
        footerExtraText: '',
        company,
        columns: [
          { key: 'label', header: 'بند', align: 'right' },
          { key: 'amount', header: 'مبلغ', money: true },
        ],
        rows: [{ label: 'أ', amount: 12.5 }],
        filename: 't',
      },
      (n) => n.toFixed(2),
    );
    expect(html).toContain('class="num"');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('num-val');
    expect(html).toContain('th.num, td.num');
    expect(html).toContain('text-align: right !important');
    expect(html).toContain('Calibri');
    // Margins are sheet padding (visible in preview + Electron PDF), not @page.
    expect(html).toContain('padding: 10mm 8mm 10mm 8mm');
    expect(html).toMatch(/@page\s*\{[^}]*margin:\s*0/);
    expect(html).toContain('class="sheet');
  });

  it('applies forced RTL and wide margins from profile fields', () => {
    const html = renderReportDocumentHtml(
      {
        id: 't',
        title: 'T',
        language: 'en',
        orientation: 'portrait',
        pageSize: 'A4',
        accent: '#003B71',
        showHeader: true,
        showFooter: true,
        showLogo: false,
        fontFamily: 'tahoma',
        textDirection: 'rtl',
        titleAlign: 'end',
        footerAlign: 'end',
        logoAlign: 'start',
        marginPreset: 'wide',
        fitPageCount: 0,
        density: 'normal',
        headerShowCompany: true,
        headerShowAddress: true,
        headerShowTaxId: true,
        headerShowTitle: true,
        headerShowMeta: true,
        headerExtraText: '',
        footerShowCompany: false,
        footerShowText: true,
        footerShowNote: true,
        footerShowPageNum: false,
        footerExtraText: '',
        company,
        columns: [{ key: 'a', header: 'A' }],
        rows: [{ a: 'x' }],
        filename: 't',
      },
      (n) => String(n),
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('Tahoma');
    expect(html).toContain('padding: 14mm 12mm 14mm 12mm');
    expect(html).toContain('text-align: end');
  });

  it('renders a single-line footer with company / center / page slots', () => {
    const html = renderReportDocumentHtml(
      {
        id: 't',
        title: 'Ftr',
        language: 'ar',
        orientation: 'portrait',
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
        headerShowMeta: false,
        headerExtraText: '',
        footerShowCompany: true,
        footerShowText: true,
        footerShowNote: true,
        footerShowPageNum: true,
        footerExtraText: '',
        company,
        columns: [{ key: 'a', header: 'A' }],
        rows: [{ a: '1' }],
        footerNote: 'ملاحظة التوليد',
        filename: 'ftr',
      },
      (n) => String(n),
    );
    expect(html).toContain('class="ftr-side ftr-company"');
    expect(html).toContain('class="ftr-center"');
    expect(html).toContain('class="ftr-side ftr-page"');
    expect(html).toContain('شركة اختبار');
    expect(html).toContain('footer');
    expect(html).toContain('ملاحظة التوليد');
    expect(html).toContain('صفحة 1 من 1');
    expect(html).toMatch(/dir="rtl"/);
    // One footer band — not stacked multi-line slots.
    expect((html.match(/class="ftr"/g) || []).length).toBe(1);
  });

  it('distributes rows across a user-chosen page count', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ a: `r${i}` }));
    const html = renderReportDocumentHtml(
      {
        id: 't',
        title: 'Fit pages',
        language: 'ar',
        orientation: 'portrait',
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
        fitPageCount: 3,
        density: 'normal',
        headerShowCompany: true,
        headerShowAddress: false,
        headerShowTaxId: false,
        headerShowTitle: true,
        headerShowMeta: false,
        headerExtraText: '',
        footerShowCompany: false,
        footerShowText: false,
        footerShowNote: false,
        footerShowPageNum: true,
        footerExtraText: '',
        company,
        columns: [{ key: 'a', header: 'A' }],
        rows,
        filename: 'fit',
      },
      (n) => String(n),
    );
    const sheetCount = (html.match(/class="sheet(?:\s|")/g) || []).length;
    expect(sheetCount).toBe(3);
    expect(html).toContain('صفحة 1 من 3');
    expect(html).toContain('صفحة 3 من 3');
  });

  it('omits header/footer parts per content toggles', () => {
    const html = renderReportDocumentHtml(
      {
        id: 't',
        title: 'Hidden Title Report',
        language: 'ar',
        orientation: 'portrait',
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
        headerShowCompany: false,
        headerShowAddress: false,
        headerShowTaxId: false,
        headerShowTitle: false,
        headerShowMeta: false,
        headerExtraText: 'سطر رأس مخصص',
        footerShowCompany: false,
        footerShowText: false,
        footerShowNote: false,
        footerShowPageNum: false,
        footerExtraText: 'سطر تذييل مخصص',
        company,
        columns: [{ key: 'a', header: 'A' }],
        rows: [{ a: '1' }],
        filename: 't',
        footerNote: 'should not show',
      },
      (n) => String(n),
    );
    expect(html).not.toContain('شركة اختبار');
    expect(html).not.toContain('<h1');
    expect(html).toContain('سطر رأس مخصص');
    expect(html).toContain('سطر تذييل مخصص');
    expect(html).not.toContain('should not show');
    expect(html).not.toContain('>footer<');
  });

  it('emits one sheet per budget page chunk', () => {
    const doc = buildReportsModuleDocument({
      language: 'ar',
      company,
      activeReport: 'budget',
      budgetLevel: 'boq_item',
      formatMoney: (n) => n.toFixed(2),
      budgetProjects: [{ id: 'p1', projectName: 'P' }],
      budgetContracts: [{ id: 'c1', projectId: 'p1', contractName: 'C' }],
      budgetBoqItems: Array.from({ length: 20 }, (_, i) => ({
        id: `b${i}`,
        projectId: 'p1',
        contractId: 'c1',
        tenderAmount: 100,
        itemCode: `${i}`,
        description: `Item ${i}`,
      })),
      budgetActualByKey: new Map(),
    });
    expect(doc).not.toBeNull();
    expect(doc!.pageChunks).toBeDefined();
    expect(doc!.pageChunks!.length).toBeGreaterThan(1);
    const html = renderReportDocumentHtml(doc!, (n) => n.toFixed(2));
    const sheetCount = (html.match(/class="sheet(?:\s|")/g) || []).length;
    expect(sheetCount).toBe(doc!.pageChunks!.length);
  });

  it('builds budget module document with status column', () => {
    const doc = buildReportsModuleDocument({
      language: 'ar',
      company,
      activeReport: 'budget',
      budgetLevel: 'project',
      formatMoney: (n) => n.toFixed(2),
      budgetProjects: [{ id: 'p1', projectName: 'Bel', voValue: 100 }],
      budgetContracts: [],
      budgetBoqItems: [
        {
          id: 'b1',
          projectId: 'p1',
          tenderAmount: 112,
          rateMaterials: 50,
          rateLabour: 30,
          rateEquipment: 20,
          rateOverheadPct: 0,
          rateProfitPct: 12,
          itemCode: '1',
          description: 'بند',
        },
      ],
      budgetActualByKey: new Map([['p1', 50]]),
    });
    expect(doc).toBeTruthy();
    expect(doc!.columns.some((c) => c.key === 'status')).toBe(true);
    expect(doc!.rows.length).toBeGreaterThan(0);
  });

  it('builds analytical income statement rows with leaf accounts', () => {
    const { rows } = buildIncomeStatementPrintRows({
      language: 'ar',
      showAnalytical: true,
      glPnL: {
        revenue: 1000,
        contractCosts: 400,
        grossContractProfit: 600,
        gaExpenses: 50,
        financeExpenses: 0,
        profitBeforeTax: 550,
        leafBalances: {
          '41101001': -1000,
          '51101001': 400,
          '52101001': 50,
        },
      },
      accounts: [
        { accountCode: '41101001', accountName: 'إيرادات', isGroup: false },
        { accountCode: '51101001', accountName: 'مواد', isGroup: false },
        { accountCode: '52101001', accountName: 'إدارية', isGroup: false },
      ],
    });
    expect(rows.some((r) => String(r.label).includes('41101001'))).toBe(true);
    expect(rows.some((r) => String(r.label).includes('ربح الفترة'))).toBe(true);
  });

  it('builds balance sheet analytical leaves', () => {
    const codeBalMap = new Map<string, number>([
      ['12101001', 500],
      ['21101001', -200],
      ['31101001', -300],
    ]);
    const { rows } = buildBalanceSheetPrintRows({
      language: 'ar',
      showAnalytical: true,
      accounts: [
        { accountCode: '12101001', accountName: 'بنك', isGroup: false },
        { accountCode: '21101001', accountName: 'موردون', isGroup: false },
        { accountCode: '31101001', accountName: 'رأس مال', isGroup: false },
      ],
      bs: {
        codeBalMap,
        accBal: (code, nature) => {
          const net = codeBalMap.get(code) ?? 0;
          return nature === 'debit' ? net : -net;
        },
        sectionBal: () => 0,
        nonCurrentAssets: 0,
        currentAssets: 500,
        totalAssets: 500,
        nonCurrentLiab: 0,
        currentLiab: 200,
        totalLiab: 200,
        totalEquity: 300,
        inventory127: { debit: 0, credit: 0 },
      },
    });
    expect(rows.some((r) => String(r.label).includes('12101001'))).toBe(true);
    expect(rows.some((r) => String(r.label).includes('إجمالي الأصول'))).toBe(true);
  });

  it('builds schedule print rows from BOQ items', () => {
    const { rows, columns } = buildSchedulePrintRows({
      language: 'ar',
      locale: 'ar-EG',
      items: [
        {
          id: '1',
          itemCode: 'A-1',
          description: 'أعمال',
          startDate: '2026-01-01',
          expectedDuration: 30,
          tenderQty: 10,
        },
      ],
      physicalPctByItemId: new Map([['1', 50]]),
      normalizeDate: (d) => String(d).slice(0, 10),
    });
    expect(columns.some((c) => c.key === 'physical')).toBe(true);
    expect(rows[0].item).toContain('A-1');
  });

  it('renders certificate sections: keyValue first sheet, signatures last sheet', () => {
    const doc = buildTableReportDocument({
      reportId: 'billing_ipc',
      title: 'مستخلص',
      language: 'ar',
      company,
      columns: [],
      rows: [],
      sections: [
        {
          kind: 'keyValue',
          title: 'بيانات المستخلص',
          items: [
            { label: 'المشروع', value: 'بيل' },
            { label: 'العقد', value: 'ع-1' },
          ],
        },
        {
          kind: 'table',
          flow: true,
          columns: [
            { key: 'item', header: 'البند' },
            { key: 'amount', header: 'المبلغ', money: true },
          ],
          rows: Array.from({ length: 60 }, (_, i) => ({ item: `بند ${i}`, amount: i * 10 })),
          totals: { amount: 17700 },
        },
        {
          kind: 'summary',
          items: [{ label: 'الصافي المستحق', value: '17,700.00', emphasize: true }],
        },
        {
          kind: 'signatures',
          signatures: [{ role: 'إعداد' }, { role: 'مراجعة' }, { role: 'اعتماد' }],
        },
      ],
      filename: 'ipc-test',
    });
    const html = renderReportDocumentHtml(doc, (n) => n.toFixed(2));
    const sheets = html.split('class="sheet').length - 1 - (html.match(/class="sheet-body"/g) || []).length;
    expect(html).toContain('kv-grid');
    expect(html).toContain('summary-box');
    expect(html).toContain('sign-row');
    // keyValue block only on the first sheet, signatures only on the last
    const firstSheet = html.slice(html.indexOf('<section'), html.indexOf('</section>'));
    expect(firstSheet).toContain('kv-grid');
    expect(firstSheet).not.toContain('sign-row');
    const lastSheet = html.slice(html.lastIndexOf('<section'));
    expect(lastSheet).toContain('sign-row');
    expect(lastSheet).toContain('summary-box');
    expect(sheets).toBeGreaterThanOrEqual(0);
    // Flowing table spans more than one sheet with 60 rows portrait A4 landscape compact
    expect((html.match(/<section class="sheet/g) || []).length).toBeGreaterThan(1);
  });

  it('renders single-sheet section document when no flow table', () => {
    const doc = buildTableReportDocument({
      reportId: 'gl_journal_entry',
      title: 'قيد يومية',
      language: 'ar',
      company,
      columns: [],
      rows: [],
      sections: [
        {
          kind: 'keyValue',
          items: [
            { label: 'رقم القيد', value: 'JV-001' },
            { label: 'التاريخ', value: '2026-07-31' },
          ],
        },
        {
          kind: 'table',
          columns: [
            { key: 'account', header: 'الحساب' },
            { key: 'debit', header: 'مدين', money: true },
            { key: 'credit', header: 'دائن', money: true },
          ],
          rows: [
            { account: 'البنك', debit: 100, credit: '' },
            { account: 'الإيرادات', debit: '', credit: 100 },
          ],
        },
        { kind: 'note', text: 'ملاحظة' },
      ],
      filename: 'jv-test',
    });
    expect(doc.orientation).toBe('portrait');
    const html = renderReportDocumentHtml(doc, (n) => n.toFixed(2));
    expect((html.match(/<section class="sheet/g) || []).length).toBe(1);
    expect(html).toContain('sec-table');
    expect(html).toContain('class="note"');
  });

  it('builds costs document with totals and boq columns', () => {
    const doc = buildReportsModuleDocument({
      language: 'ar',
      company,
      formatMoney: (n) => n.toFixed(2),
      activeReport: 'costs',
      costLevel: 'boq_item',
      costRows: [
        {
          projectName: 'P',
          projectCode: 'P1',
          contractName: 'C',
          contractNumber: 'C1',
          chapterCode: '1',
          sectionCode: '1.1',
          itemCode: '1.1.1',
          boqDescription: 'بند',
          directCost: 100,
          indirectCost: 20,
          totalCost: 120,
        },
      ],
      costTotals: { directCost: 100, indirectCost: 20, totalCost: 120 },
    });
    expect(doc!.columns.some((c) => c.key === 'chapterCode')).toBe(true);
    expect(doc!.totals?.totalCost).toBe(120);
  });
});

describe('buildConsumptionOrderSections', () => {
  it('includes requester / receiver / storekeeper signature roles', async () => {
    const { buildConsumptionOrderSections } = await import('./buildCertificateDocs');
    const sections = buildConsumptionOrderSections(
      {
        orderNumber: 'CON-20260805-0001',
        orderDate: '2026-08-05',
        projectName: 'مشروع',
        contractName: 'عقد',
        statusLabel: 'مؤكد',
        lines: [
          {
            materialCode: 'M1',
            materialName: 'أسمنت',
            unit: 'طن',
            sectionName: 'أعمال خرسانية',
            quantity: 2,
          },
        ],
        requesterName: 'أحمد',
        receiverName: 'محمود',
        storekeeperName: 'خالد',
        formatQuantity: (n) => String(n),
      },
      'ar',
    );
    const table = sections.find((s) => s.kind === 'table');
    expect(table?.kind).toBe('table');
    if (table?.kind === 'table') {
      expect(table.columns.map((c) => c.key)).toEqual(['code', 'material', 'unit', 'section', 'qty']);
      expect(table.columns.some((c) => c.money)).toBe(false);
      expect(table.totals).toBeUndefined();
    }
    expect(sections.some((s) => s.kind === 'summary')).toBe(false);
    const sig = sections.find((s) => s.kind === 'signatures');
    expect(sig?.kind).toBe('signatures');
    if (sig?.kind !== 'signatures') return;
    expect(sig.signatures.map((s) => s.role)).toEqual(['طالب الصرف', 'المستلم', 'أمين المخزن']);
    expect(sig.signatures.map((s) => s.name)).toEqual(['أحمد', 'محمود', 'خالد']);
    const html = renderReportDocumentHtml(
      buildTableReportDocument({
        reportId: 'consumption_order',
        title: 'إذن صرف',
        language: 'ar',
        company,
        columns: [],
        rows: [],
        sections,
        filename: 'con',
      }),
      (n) => n.toFixed(2),
    );
    expect(html).toContain('طالب الصرف');
    expect(html).toContain('أحمد');
    expect(html).toContain('أسمنت');
    expect(html).toContain('أعمال خرسانية');
    expect(html).not.toContain('التكلفة');
    expect(html).not.toContain('القيمة');
    expect(html).not.toContain('إجمالي قيمة');
    expect(html).not.toContain('حساب المصروف');
    expect(html).not.toContain('1.1.1');
  });
});
