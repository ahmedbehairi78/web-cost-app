/**
 * Certificate-style document builders — IPC (client/subcontractor), MOS and
 * variation orders. Produce section-based `ReportDocument`s for the unified
 * print platform (letterhead + flowing items table + summary + signatures).
 */
import { formatNumber } from '../numberLocale';
import {
  deductionPctLabel,
  groupIpcItemsByChapter,
  ipcPrintTitle,
  totalIpcDeductions,
  type CompanyPrintInfo,
  type IpcPrintData,
} from '../ipcPrintData';
import { mosPrintTitle, type MosPrintData } from '../mosPrintData';
import { voPrintTitle, type VoPrintData } from '../voPrintData';
import type { IpcPrintProfileId, StoredReportPrintProfiles } from '../reportPrintProfiles';
import { buildTableReportDocument } from './buildTableDoc';
import type {
  ReportDocColumn,
  ReportDocKeyValueItem,
  ReportDocRow,
  ReportDocSection,
  ReportDocument,
} from './types';

export type CertificateDocBase = {
  language: 'ar' | 'en';
  company: CompanyPrintInfo;
  storedProfiles?: StoredReportPrintProfiles;
  formatMoney: (n: number) => string;
  dateLabel?: string;
  scopeLabel?: string;
};

function signaturesSection(isAr: boolean): ReportDocSection {
  return {
    kind: 'signatures',
    signatures: [
      { role: isAr ? 'إعداد' : 'Prepared by' },
      { role: isAr ? 'مراجعة' : 'Reviewed by' },
      { role: isAr ? 'اعتماد' : 'Approved by' },
    ],
  };
}

const CERT_FOOTER_NOTE = {
  ar: 'تم استخراج هذا المستند آلياً',
  en: 'This document was generated automatically',
};

/** Client / subcontractor IPC certificate. */
export function buildIpcCertificateDocument(
  input: CertificateDocBase & { data: IpcPrintData; printId: IpcPrintProfileId },
): ReportDocument {
  const { data, language, formatMoney } = input;
  const isAr = language === 'ar';
  const works = data.worksValueExVat;

  const meta: ReportDocKeyValueItem[] = [
    { label: isAr ? 'رقم المستخلص' : 'IPC Number', value: data.documentNumber },
    { label: isAr ? 'التاريخ' : 'Date', value: data.dateLabel },
  ];
  if (data.projectName) meta.push({ label: isAr ? 'المشروع' : 'Project', value: data.projectName });
  if (data.contractName) meta.push({ label: isAr ? 'العقد' : 'Contract', value: data.contractName });
  if (data.subcontractorName) {
    meta.push({ label: isAr ? 'المقاول' : 'Subcontractor', value: data.subcontractorName });
  }
  if (data.statusLabel) meta.push({ label: isAr ? 'الحالة' : 'Status', value: data.statusLabel });

  const columns: ReportDocColumn[] = [
    { key: 'chapter', header: isAr ? 'الفصل' : 'Chapter', width: 12 },
    { key: 'section', header: isAr ? 'القسم' : 'Section', width: 10 },
    { key: 'code', header: isAr ? 'كود البند' : 'Item Code', width: 8, align: 'center' },
    { key: 'description', header: isAr ? 'الوصف' : 'Description', width: 24 },
    { key: 'unit', header: isAr ? 'الوحدة' : 'Unit', width: 5, align: 'center' },
    { key: 'tenderQty', header: isAr ? 'الكمية' : 'Tender Qty', width: 7, numeric: true },
    { key: 'rate', header: isAr ? 'السعر' : 'Rate', width: 8, money: true },
    { key: 'prev', header: isAr ? 'سابق' : 'Prev', width: 6, numeric: true },
    { key: 'curr', header: isAr ? 'حالي' : 'Curr', width: 6, numeric: true },
    { key: 'total', header: isAr ? 'إجمالي' : 'Total', width: 6, numeric: true },
    { key: 'execPct', header: isAr ? 'نسبة التنفيذ' : 'Exec %', width: 6, numeric: true },
    { key: 'amount', header: isAr ? 'القيمة' : 'Value', width: 9, money: true },
  ];

  const rows: ReportDocRow[] = [];
  for (const { chapterName, items } of groupIpcItemsByChapter(data.items, language)) {
    let chapterTotal = 0;
    for (const item of items) {
      chapterTotal += item.amount;
      const execPct = item.tenderQty ? (item.totalQty / item.tenderQty) * 100 : 0;
      rows.push({
        chapter: chapterName,
        section: item.sectionName || '—',
        code: item.itemCode,
        description: item.description,
        unit: item.unit,
        tenderQty: formatNumber(item.tenderQty || 0),
        rate: item.rate,
        prev: formatNumber(item.previousQty),
        curr: formatNumber(item.currentQty),
        total: formatNumber(item.totalQty),
        execPct: `${execPct.toFixed(1)}%`,
        amount: item.amount,
      });
    }
    rows.push({
      chapter: isAr ? `إجمالي الفصل: ${chapterName}` : `Chapter total: ${chapterName}`,
      amount: chapterTotal,
    });
  }

  const totalDeductions = totalIpcDeductions(data);
  const summary: ReportDocKeyValueItem[] = [
    {
      label: isAr ? 'قيمة الأعمال (بدون ضريبة)' : 'Work Value (Excl. VAT)',
      value: formatMoney(works),
    },
    { label: isAr ? 'قيمة الضريبة المضافة' : 'VAT Amount', value: formatMoney(data.vatAmount) },
  ];
  if (data.execGuaranteeAmount > 0) {
    summary.push({
      label: `${isAr ? 'حجز ضمان أعمال' : 'Execution Guarantee'} (${deductionPctLabel(data.execGuaranteeAmount, works)})`,
      value: formatMoney(data.execGuaranteeAmount),
    });
  }
  if ((data.whtAmount || 0) > 0) {
    summary.push({
      label: `${isAr ? 'خصم وإضافة' : 'WHT'} (${deductionPctLabel(data.whtAmount || 0, works)})`,
      value: formatMoney(data.whtAmount || 0),
    });
  }
  if (data.labourInsuranceAmount > 0) {
    summary.push({
      label: `${isAr ? 'التأمينات' : 'Labour Insurance'} (${deductionPctLabel(data.labourInsuranceAmount, works)})`,
      value: formatMoney(data.labourInsuranceAmount),
    });
  }
  if (data.manpowerLevyAmount > 0) {
    summary.push({
      label: `${isAr ? 'القوى العاملة' : 'Manpower Levy'} (${deductionPctLabel(data.manpowerLevyAmount, works, 3)})`,
      value: formatMoney(data.manpowerLevyAmount),
    });
  }
  if ((data.advancePaymentRecovery || 0) > 0) {
    summary.push({
      label: isAr ? 'استرداد دفعة مقدمة' : 'Advance Recovery',
      value: formatMoney(data.advancePaymentRecovery || 0),
    });
  }
  summary.push({
    label: isAr ? 'إجمالي الاستقطاعات' : 'Total Deductions',
    value: formatMoney(totalDeductions),
  });
  summary.push({
    label: isAr ? 'صافي المستحق الصرف' : 'Net Payable',
    value: formatMoney(data.netPayable),
    emphasize: true,
  });

  const sections: ReportDocSection[] = [
    { kind: 'keyValue', items: meta, columnsPerRow: 3 },
    {
      kind: 'table',
      columns,
      rows,
      flow: true,
      totals: { amount: works },
      totalsLabel: isAr ? 'إجمالي الأعمال' : 'Works Total',
    },
    {
      kind: 'summary',
      title: isAr ? 'ملخص المستخلص والاستقطاعات' : 'Certificate Summary & Deductions',
      items: summary,
    },
    signaturesSection(isAr),
  ];

  return buildTableReportDocument({
    reportId: input.printId,
    title: ipcPrintTitle(data, language),
    language,
    company: input.company,
    storedProfiles: input.storedProfiles,
    scopeLabel: input.scopeLabel,
    dateLabel: input.dateLabel,
    columns: [],
    rows: [],
    sections,
    footerNote: CERT_FOOTER_NOTE[language],
    filename: `ipc-${data.documentNumber}`,
  });
}

/** Material On-Site (MOS) certificate. */
export function buildMosCertificateDocument(
  input: CertificateDocBase & { data: MosPrintData },
): ReportDocument {
  const { data, language, formatMoney } = input;
  const isAr = language === 'ar';

  const meta: ReportDocKeyValueItem[] = [
    { label: isAr ? 'رقم الشهادة' : 'Certificate No.', value: data.certificateNo },
    { label: isAr ? 'التاريخ' : 'Date', value: data.extractDate },
    { label: isAr ? 'المرحلة' : 'Phase', value: data.phaseLabel },
    { label: isAr ? 'الحالة' : 'Status', value: data.statusLabel },
  ];
  if (data.projectName) meta.push({ label: isAr ? 'المشروع' : 'Project', value: data.projectName });
  if (data.contractName) meta.push({ label: isAr ? 'العقد' : 'Contract', value: data.contractName });
  if (data.deliveryNoteRef) {
    meta.push({ label: isAr ? 'مرجع إذن الاستلام' : 'Delivery Note Ref', value: data.deliveryNoteRef });
  }

  const columns: ReportDocColumn[] = [
    { key: 'code', header: isAr ? 'كود البند' : 'Item Code', width: 8, align: 'center' },
    { key: 'description', header: isAr ? 'الوصف' : 'Description', width: 28 },
    { key: 'unit', header: isAr ? 'الوحدة' : 'Unit', width: 6, align: 'center' },
    { key: 'supplied', header: isAr ? 'الكمية الموردة' : 'Supplied Qty', width: 9, numeric: true },
    { key: 'pct', header: isAr ? 'نسبة التشوين %' : 'On-site %', width: 8, numeric: true },
    { key: 'equivalent', header: isAr ? 'الكمية المعادلة' : 'Equivalent Qty', width: 9, numeric: true },
    { key: 'cumulative', header: isAr ? 'معادل تراكمي' : 'Cumulative Equiv.', width: 9, numeric: true },
    { key: 'price', header: isAr ? 'سعر الوحدة' : 'Unit Price', width: 9, money: true },
    { key: 'amount', header: isAr ? 'المبلغ المستحق' : 'Claimed Amount', width: 10, money: true },
  ];

  const rows: ReportDocRow[] = data.lines.map((line) => ({
    code: line.itemCode || '—',
    description: line.description,
    unit: line.unit || '—',
    supplied: formatNumber(line.suppliedQtyThisPeriod),
    pct: `${formatNumber(line.onSitePercentage)}%`,
    equivalent: formatNumber(line.equivalentQty),
    cumulative: formatNumber(line.equivalentCumulative),
    price: line.unitPrice,
    amount: line.claimedAmount,
  }));

  const sections: ReportDocSection[] = [
    { kind: 'keyValue', items: meta, columnsPerRow: 3 },
    {
      kind: 'table',
      columns,
      rows,
      flow: true,
      totals: { amount: data.totalClaimed },
      totalsLabel: isAr ? 'إجمالي المستحق' : 'Total Claimed',
    },
    {
      kind: 'summary',
      items: [
        {
          label: isAr ? 'إجمالي المستحق عن التشوينات' : 'Total Claimed (MOS)',
          value: formatMoney(data.totalClaimed),
          emphasize: true,
        },
      ],
    },
  ];
  if (data.notes) {
    sections.push({ kind: 'note', text: `${isAr ? 'ملاحظات: ' : 'Notes: '}${data.notes}` });
  }
  sections.push(signaturesSection(isAr));

  return buildTableReportDocument({
    reportId: 'mos',
    title: mosPrintTitle(data, language),
    language,
    company: input.company,
    storedProfiles: input.storedProfiles,
    scopeLabel: input.scopeLabel,
    dateLabel: input.dateLabel,
    columns: [],
    rows: [],
    sections,
    footerNote: CERT_FOOTER_NOTE[language],
    filename: `mos-${data.certificateNo}`,
  });
}

export type CustodySettlementPrintData = {
  settlementNumber: string;
  date: string;
  projectLabel: string;
  custodyAccountLabel: string;
  statusLabel: string;
  postedLabel?: string;
  description?: string;
  totalAmount: number;
  items: {
    costCenterLabel: string;
    accountName: string;
    accountCode: string;
    description?: string;
    amount: number;
  }[];
};

/** Custody settlement certificate sections — pair with `reportId: 'custody_settlement'`. */
export function buildCustodySettlementSections(
  data: CustodySettlementPrintData,
  language: 'ar' | 'en',
  formatMoney: (n: number) => string,
): ReportDocSection[] {
  const isAr = language === 'ar';

  const meta: ReportDocKeyValueItem[] = [
    { label: isAr ? 'رقم التسوية' : 'Settlement No.', value: data.settlementNumber },
    { label: isAr ? 'التاريخ' : 'Date', value: data.date },
    { label: isAr ? 'المشروع' : 'Project', value: data.projectLabel },
    { label: isAr ? 'حساب العهدة' : 'Custody Account', value: data.custodyAccountLabel },
    { label: isAr ? 'الحالة' : 'Status', value: data.statusLabel },
  ];
  if (data.postedLabel) meta.push({ label: isAr ? 'القيد' : 'Journal', value: data.postedLabel });

  const columns: ReportDocColumn[] = [
    { key: 'costCenter', header: isAr ? 'مركز التكلفة' : 'Cost Center', width: 16 },
    { key: 'account', header: isAr ? 'حساب المصروف' : 'Expense Account', width: 20 },
    { key: 'code', header: isAr ? 'الكود' : 'Code', width: 8, align: 'center' },
    { key: 'description', header: isAr ? 'الوصف' : 'Description', width: 24 },
    { key: 'amount', header: isAr ? 'المبلغ' : 'Amount', width: 12, money: true },
  ];

  const rows: ReportDocRow[] = data.items.map((item) => ({
    costCenter: item.costCenterLabel || '—',
    account: item.accountName || item.accountCode,
    code: item.accountCode,
    description: item.description || '—',
    amount: item.amount,
  }));

  const sections: ReportDocSection[] = [
    { kind: 'keyValue', items: meta, columnsPerRow: 3 },
    {
      kind: 'table',
      title: isAr ? 'بنود المصروفات' : 'Expense Items',
      columns,
      rows,
      flow: true,
      totals: { amount: data.totalAmount },
      totalsLabel: isAr ? 'إجمالي التسوية' : 'Settlement Total',
    },
    {
      kind: 'summary',
      items: [
        {
          label: isAr ? 'إجمالي التسوية' : 'Settlement Total',
          value: formatMoney(data.totalAmount),
          emphasize: true,
        },
      ],
    },
  ];
  if (data.description?.trim()) {
    sections.push({ kind: 'note', text: `${isAr ? 'البيان: ' : 'Description: '}${data.description.trim()}` });
  }
  sections.push(signaturesSection(isAr));
  return sections;
}

/** Variation order (VO) certificate. */
export function buildVoCertificateDocument(
  input: CertificateDocBase & { data: VoPrintData },
): ReportDocument {
  const { data, language, formatMoney } = input;
  const isAr = language === 'ar';

  const meta: ReportDocKeyValueItem[] = [
    { label: isAr ? 'رقم أمر التغيير' : 'VO Number', value: data.voNumber },
    { label: isAr ? 'التاريخ' : 'Date', value: data.voDate },
    { label: isAr ? 'العنوان' : 'Title', value: data.title },
    { label: isAr ? 'الحالة' : 'Status', value: data.statusLabel },
  ];
  if (data.projectName) meta.push({ label: isAr ? 'المشروع' : 'Project', value: data.projectName });
  if (data.contractName) meta.push({ label: isAr ? 'العقد' : 'Contract', value: data.contractName });

  const columns: ReportDocColumn[] = [
    { key: 'type', header: isAr ? 'نوع السطر' : 'Line Type', width: 10 },
    { key: 'description', header: isAr ? 'البند' : 'Item', width: 30 },
    { key: 'detail', header: isAr ? 'التفاصيل' : 'Detail', width: 20, align: 'center' },
    { key: 'amount', header: isAr ? 'قيمة السطر' : 'Line Amount', width: 12, money: true },
  ];

  const rows: ReportDocRow[] = data.lines.map((line) => ({
    type: line.lineTypeLabel,
    description: line.description,
    detail: line.detail,
    amount: line.lineAmount,
  }));

  const sections: ReportDocSection[] = [
    { kind: 'keyValue', items: meta, columnsPerRow: 3 },
    {
      kind: 'table',
      columns,
      rows,
      flow: true,
      totals: { amount: data.totalValue },
      totalsLabel: isAr ? 'إجمالي أمر التغيير' : 'VO Total',
    },
    {
      kind: 'summary',
      items: [
        {
          label: isAr ? 'صافي قيمة أمر التغيير' : 'Net VO Value',
          value: formatMoney(data.totalValue),
          emphasize: true,
        },
      ],
    },
  ];
  if (data.notes) {
    sections.push({ kind: 'note', text: `${isAr ? 'ملاحظات: ' : 'Notes: '}${data.notes}` });
  }
  sections.push(signaturesSection(isAr));

  return buildTableReportDocument({
    reportId: 'variation_order',
    title: voPrintTitle(data, language),
    language,
    company: input.company,
    storedProfiles: input.storedProfiles,
    scopeLabel: input.scopeLabel,
    dateLabel: input.dateLabel,
    columns: [],
    rows: [],
    sections,
    footerNote: CERT_FOOTER_NOTE[language],
    filename: `vo-${data.voNumber}`,
  });
}
