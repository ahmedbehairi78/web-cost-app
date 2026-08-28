/**
 * Certificate-style document builders — IPC (client/subcontractor), MOS and
 * variation orders. Produce section-based `ReportDocument`s for the unified
 * print platform (letterhead + flowing items table + summary + signatures).
 */
import { formatNumber } from '../numberLocale';
import { roundMoney } from '../money';
import { amountInWordsEgyptianPounds } from '../amountInWordsEn';
import { buildIpcCoverClosingData } from '../ipcCoverClosing';
import { BILLING_DEFAULTS, IPC_KIND } from '../../constants/billingDefaults';
import {
  buildIpcCoverSheetModel,
  defaultIpcCoverSheetRates,
} from '../ipcCoverSheet';
import {
  groupIpcItemsByChapter,
  ipcPrintTitle,
  type CompanyPrintInfo,
  type IpcPrintData,
} from '../ipcPrintData';
import { ipcLineToDateAmount } from '../ipcCoverFromQtyList';
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
  input: CertificateDocBase & {
    data: IpcPrintData;
    printId: IpcPrintProfileId;
    /** Cover sheet only (no quantities table) — single A4 portrait page. */
    coverOnly?: boolean;
  },
): ReportDocument {
  const { data, language, formatMoney, coverOnly = false } = input;
  const isAr = language === 'ar';
  const cover = data.coverWorks;
  const works =
    cover && cover.periodWorksTotal > 0 ? cover.periodWorksTotal : data.worksValueExVat;
  const schedule = data.coverSchedule;
  const sums = data.coverContractSums;
  const mos = Number(data.materialsOnSite || 0);
  const priceAdj = Number(data.priceAdjustment || 0);

  const meta: ReportDocKeyValueItem[] = [
    { label: isAr ? 'رقم المستخلص' : 'IPC Number', value: data.documentNumber },
    { label: isAr ? 'التاريخ' : 'Date', value: data.dateLabel },
  ];
  if (data.projectName) meta.push({ label: isAr ? 'المشروع' : 'Project', value: data.projectName });
  if (data.contractName) meta.push({ label: isAr ? 'العقد' : 'Contract', value: data.contractName });
  if (data.contractorName) {
    meta.push({ label: isAr ? 'المقاول' : 'Contractor', value: data.contractorName });
  }
  if (data.subcontractorName) {
    meta.push({ label: isAr ? 'مقاول الباطن' : 'Subcontractor', value: data.subcontractorName });
  }
  if (data.statusLabel) meta.push({ label: isAr ? 'الحالة' : 'Status', value: data.statusLabel });

  const contractSumItems: ReportDocKeyValueItem[] = [
    {
      label: isAr ? 'قيمة العقد الأصلية' : 'Original Contract Sum',
      value: formatMoney(sums?.originalContractSum ?? 0),
    },
    {
      label: isAr
        ? 'مبالغ مؤقتة / أوامر تغيير على الحساب'
        : "Provisional Sums / On Account V.O.'s",
      value: formatMoney(sums?.provisionalSums ?? 0),
    },
    {
      label: isAr ? 'أوامر تغيير معتمدة (إضافات)' : "Approved V.O.'s (Additions)",
      value: formatMoney(sums?.approvedVoAdditions ?? 0),
    },
    {
      label: isAr ? 'أوامر تغيير معتمدة (حذف)' : "Approved V.O.'s (Omissions)",
      value: formatMoney(sums?.approvedVoOmissions ?? 0),
    },
    {
      label: isAr ? 'قيمة العقد المعدّلة' : 'Adjusted Contract Sum',
      value: formatMoney(sums?.adjustedContractSum ?? 0),
      emphasize: true,
    },
    {
      label: isAr ? "إجمالي قيم أوامر الموافقة (CAI)" : "Total Values of CAI's",
      value: formatMoney(sums?.totalCaiValues ?? 0),
    },
  ];

  const scheduleItems: ReportDocKeyValueItem[] = [
    {
      label: isAr ? 'تاريخ توقيع خطاب الترسية (LOA)' : 'Date of signing LOA',
      value: schedule?.loaDate ?? '—',
    },
    {
      label: isAr ? 'تاريخ المباشرة' : 'Commencement Date',
      value: schedule?.commencementDate ?? '—',
    },
    {
      label: isAr ? 'مدة العقد' : 'Contract Duration',
      value: schedule?.durationLabel ?? '—',
    },
    {
      label: isAr ? 'تمديد المدة' : 'Time Extension',
      value: schedule?.timeExtensionLabel ?? '—',
    },
    {
      label: isAr ? 'تاريخ الإنجاز' : 'Date of Completion',
      value: schedule?.completionDate ?? '—',
    },
  ];

  // Same sheet model as on-screen IpcCoverPanel (rates VAT-inclusive; Sub = sum of lines).
  const sheetRates = defaultIpcCoverSheetRates({
    ...(typeof data.vatPct === 'number' && data.vatPct > 0 ? { vatPct: data.vatPct } : {}),
    ...data.coverRates,
  });
  const sheet = buildIpcCoverSheetModel({
    grossBasic: cover?.basic.toDateValue ?? 0,
    provisionalWorks: 0,
    approvedVoWorks: cover?.additional.toDateValue ?? 0,
    materialsOnSite: mos,
    priceAdjustment: priceAdj,
    rates: sheetRates,
    advancePaymentTotal: data.advancePaymentTotal,
    advanceRecovery: data.advancePaymentRecovery,
    backCharge: data.backChargeAmount,
    previousPayments: data.previousPayments,
  });
  const {
    grossBasic,
    provisionalWorks,
    approvedVoWorks,
    materialsOnSite: mosLine,
    priceAdjustment: priceAdjLine,
    subTotal: workDoneSubTotal,
    vatPct,
  } = sheet;
  const vatPctLabel = ` ${vatPct}%`;

  const coverWorksItems: ReportDocKeyValueItem[] = [
    {
      label: isAr
        ? 'إجمالي قيمة الأعمال المنفذة حتى نهاية فترة المستخلص'
        : 'Gross Value of Works Executed To End of Invoice Period',
      value: formatMoney(grossBasic),
    },
    {
      label: isAr
        ? 'قيمة أعمال المبالغ المؤقتة / أوامر على الحساب حتى نهاية الفترة'
        : "Value Work Executed Provisional Sums / On Account V.O.'s To End of Invoice Period",
      value: formatMoney(provisionalWorks),
    },
    {
      label: isAr
        ? 'قيمة أعمال أوامر التغيير المعتمدة حتى نهاية الفترة'
        : "Value Work Executed Approved V.O.'s To End of Invoice Period",
      value: formatMoney(approvedVoWorks),
    },
    {
      label: isAr
        ? 'مواد بالموقع حتى نهاية الفترة'
        : 'Materials On Site To End of Invoice Period',
      value: formatMoney(mosLine),
    },
    {
      label: isAr
        ? 'دفعات مقابل تعديل الأسعار بسبب تغير التكلفة'
        : 'Payment against Price Adjustment due to Change in Cost',
      value: formatMoney(priceAdjLine),
    },
    {
      label: isAr
        ? `ضريبة القيمة المضافة (VAT${vatPctLabel})`
        : `Value Added Tax (VAT${vatPctLabel})`,
      value: isAr ? 'مشمولة' : 'Included',
    },
    {
      label: isAr ? 'Sub - Total' : 'Sub - Total',
      value: formatMoney(workDoneSubTotal),
      emphasize: true,
    },
  ];

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
      const toDateAmount = ipcLineToDateAmount(item);
      chapterTotal += toDateAmount;
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
        amount: toDateAmount,
      });
    }
    rows.push({
      chapter: isAr ? `إجمالي الفصل: ${chapterName}` : `Chapter total: ${chapterName}`,
      amount: chapterTotal,
    });
  }

  const moneyPrefix = isAr ? '' : 'EGP ';
  const moneyCell = (n: number) => `${moneyPrefix}${formatMoney(n)}`;
  const deductionAmt = (n: number) => (n === 0 ? moneyCell(0) : `(${moneyCell(Math.abs(n))})`);

  type DeductionPrintRow = {
    item: string;
    base: string;
    pct: string;
    amount: string;
  };

  const showCoverJll = data.variant === 'billing';
  const deductionRows: DeductionPrintRow[] = [];

  if (showCoverJll) {
    deductionRows.push({
      item: isAr ? 'إجمالي الدفعة المقدمة' : 'Total Advance Payment',
      base: '',
      pct: '',
      amount: moneyCell(sheet.advancePaymentTotal),
    });
    deductionRows.push({
      item: isAr ? 'ناقص: استرداد المقدمة حتى تاريخه' : 'Less : Recovery to Date (AP)',
      base: '',
      pct: '',
      amount: deductionAmt(sheet.advanceRecovery),
    });
    deductionRows.push({
      item: '',
      base: '',
      pct: '',
      amount: moneyCell(sheet.advanceNet),
    });
    for (const row of sheet.deductions) {
      const pctLabel =
        row.pct != null && Number.isFinite(row.pct)
          ? `${Number(row.pct).toFixed(row.pct % 1 ? 1 : 0)}%`
          : '';
      deductionRows.push({
        item: isAr ? row.labelAr : row.labelEn,
        base: row.base != null ? moneyCell(row.base) : '',
        pct: pctLabel,
        amount: row.isDeduction ? deductionAmt(row.amount) : moneyCell(row.amount),
      });
    }
    deductionRows.push({
      item: isAr ? 'مدفوعات سابقة' : 'Previous Payments',
      base: '',
      pct: '',
      amount: deductionAmt(sheet.previousPayments),
    });
  } else {
    const pushSub = (item: string, amount: number) => {
      if (!(amount > 0)) return;
      deductionRows.push({ item, base: '', pct: '', amount: deductionAmt(amount) });
    };
    pushSub(isAr ? 'حجز ضمان أعمال' : 'Retention Withheld', data.execGuaranteeAmount);
    pushSub(isAr ? 'خصم وإضافة' : 'WHT', data.whtAmount);
    pushSub(isAr ? 'تأمينات' : 'Insurance', data.labourInsuranceAmount);
    pushSub(isAr ? 'قوى عاملة' : 'Labour Force', data.manpowerLevyAmount);
    pushSub(isAr ? 'استرداد مقدمة' : 'Advance Recovery', data.advancePaymentRecovery);
  }

  const deductionColumns: ReportDocColumn[] = [
    { key: 'item', header: isAr ? 'البند' : 'Item', width: 40 },
    { key: 'base', header: isAr ? 'الأساس' : 'Base', width: 22, numeric: true, align: 'right' },
    { key: 'pct', header: isAr ? '٪' : '%', width: 10, numeric: true, align: 'right' },
    { key: 'amount', header: isAr ? 'المبلغ' : 'Amount', width: 28, numeric: true, align: 'right' },
  ];

  const sections: ReportDocSection[] = [];

  if (showCoverJll) {
    sections.push({
      kind: 'twoColumn',
      left: contractSumItems,
      right: scheduleItems,
    });
    sections.push({
      kind: 'ipcCoverMain',
      worksTitle: isAr
        ? `الأعمال المنفذة والتشوينات حتى ${data.dateLabel}`
        : `WORK DONE & MATERIALS ON SITE AS OF : ${data.dateLabel}`,
      worksItems: coverWorksItems,
      deductionsTitle: isAr ? 'إضافات / استقطاعات' : 'ADDITIONS / OMISSIONS',
      deductionColumns,
      deductionRows,
    });
    sections.push({
      kind: 'summary',
      width: 'wide',
      items: [
        {
          label: isAr ? 'صافي المستحق للتحصيل' : 'NET PAYMENT DUE',
          value: moneyCell(sheet.netPayable),
          emphasize: true,
        },
      ],
    });
    const closing = buildIpcCoverClosingData(amountInWordsEgyptianPounds(sheet.netPayable), {
      preparedBy: input.company.coverPreparedBy,
      approvedBy: input.company.coverApprovedBy,
      rowHeightMm: 4.0,
    });
    sections.push({ kind: 'ipcCoverClosing', ...closing });
  } else {
    sections.push({ kind: 'keyValue', items: meta, columnsPerRow: 3 });
    // Subcontractor IPC — compact summary (not Cover-JLL client layout)
    const subSummary: ReportDocKeyValueItem[] = [
      {
        label: isAr ? 'قيمة أعمال الفترة (بدون ضريبة)' : 'Period Work Value (Excl. VAT)',
        value: formatMoney(works),
      },
      { label: isAr ? 'قيمة الضريبة المضافة' : 'VAT Amount', value: formatMoney(data.vatAmount) },
    ];
    for (const row of deductionRows) {
      subSummary.push({
        label: row.item,
        value: row.amount,
        tone: row.amount.trimStart().startsWith('(') ? 'danger' : undefined,
      });
    }
    subSummary.push({
      label: isAr ? 'صافي المستحق' : 'Net Payable',
      value: formatMoney(data.netPayable),
      emphasize: true,
    });
    sections.push({
      kind: 'summary',
      title: isAr ? 'الملخص المالي' : 'Financial Summary',
      items: subSummary,
    });
  }

  if (!coverOnly) {
    sections.push({
      kind: 'table',
      title: isAr ? 'بنود المستخلص (قائمة الكميات)' : 'IPC line items (quantities)',
      columns,
      rows,
      flow: true,
      totals: { amount: works },
      totalsLabel: isAr ? 'إجمالي أعمال الفترة' : 'Period Works Total',
    });
  }
  // Cover-JLL already has the Excel closing/signature block on page 1.
  if (!showCoverJll && !coverOnly) {
    sections.push(signaturesSection(isAr));
  }

  const certNoLine =
    data.ipcKind === IPC_KIND.FINAL
      ? `Final Payment Certificate No.${data.documentNumber}`
      : `Interim Payment Certificate No.${data.documentNumber}`;
  const coverContractLabel =
    (input.company.coverContractLabel || '').trim() || 'CONSTRUCTION CONTRACT';
  const coverPage = showCoverJll
    ? {
        // Always isolate so the cover sheet gets expanded triple-logo header + title lines
        // (cover-only is still one physical page — no flowing qty table).
        isolate: true,
        hideFooter: true,
        headerVariant: 'tripleLogo' as const,
        titleLines: [
          (data.projectName || '').trim() || '—',
          coverContractLabel,
          certNoLine,
        ],
      }
    : undefined;

  const coverLayout =
    showCoverJll
      ? {
          pageSize: 'A4' as const,
          orientation: 'portrait' as const,
          density: 'compact' as const,
          marginPreset: 'narrow' as const,
          headerShowCompany: false,
          headerShowAddress: false,
          headerShowTaxId: false,
          headerShowTitle: coverOnly ? false : true,
          headerShowMeta: coverOnly ? false : true,
          ...(coverOnly ? { showFooter: false as const } : {}),
        }
      : undefined;

  return buildTableReportDocument({
    reportId: input.printId,
    title: coverOnly
      ? isAr
        ? `كفر المستخلص — ${data.documentNumber}`
        : `IPC Cover — ${data.documentNumber}`
      : ipcPrintTitle(data, language),
    language,
    company: input.company,
    storedProfiles: input.storedProfiles,
    scopeLabel: input.scopeLabel,
    dateLabel: input.dateLabel,
    columns: [],
    rows: [],
    sections,
    coverPage,
    layoutOverrides: coverLayout,
    footerNote: coverOnly ? undefined : CERT_FOOTER_NOTE[language],
    filename: coverOnly ? `ipc-cover-${data.documentNumber}` : `ipc-${data.documentNumber}`,
  });
}

export type ServiceIpcPrintLine = {
  contractLabel: string;
  chapterLabel?: string;
  description: string;
  unit: string;
  rate: number;
  previousQty: number;
  currentQty: number;
  netQty: number;
  periodAmount: number;
};

export type ServiceIpcPrintData = {
  documentNumber: string;
  dateLabel: string;
  /** Draft / awaiting approval / approved — shown prominently on the printout. */
  statusLabel: string;
  serviceKindLabel: string;
  contractorName: string;
  projectName?: string;
  lines: ServiceIpcPrintLine[];
  worksValueExVat: number;
  vatAmount: number;
  execGuaranteeAmount: number;
  whtAmount: number;
  labourInsuranceAmount: number;
  manpowerLevyAmount: number;
  advancePaymentRecovery: number;
  netPayable: number;
};

/** Sections for service contractor IPC (multi cost-center, optional chapter). */
export function buildServiceIpcCertificateSections(
  data: ServiceIpcPrintData,
  language: 'ar' | 'en',
  formatMoney: (n: number) => string,
): ReportDocSection[] {
  const isAr = language === 'ar';
  const meta: ReportDocKeyValueItem[] = [
    { label: isAr ? 'رقم المستخلص' : 'IPC Number', value: data.documentNumber || '—' },
    { label: isAr ? 'التاريخ' : 'Date', value: data.dateLabel },
    { label: isAr ? 'الحالة' : 'Status', value: data.statusLabel, emphasize: true },
    { label: isAr ? 'نوع الخدمة' : 'Service kind', value: data.serviceKindLabel },
    { label: isAr ? 'مقاول الخدمة' : 'Service contractor', value: data.contractorName },
  ];
  if (data.projectName) meta.push({ label: isAr ? 'المشروع' : 'Project', value: data.projectName });

  const columns: ReportDocColumn[] = [
    { key: 'costCenter', header: isAr ? 'مركز التكلفة' : 'Cost center', width: 16 },
    { key: 'chapter', header: isAr ? 'الفصل' : 'Chapter', width: 10 },
    { key: 'description', header: isAr ? 'البيان' : 'Description', width: 22 },
    { key: 'unit', header: isAr ? 'الوحدة' : 'Unit', width: 6, align: 'center' },
    { key: 'rate', header: isAr ? 'الفئة' : 'Rate', width: 8, money: true },
    { key: 'prev', header: isAr ? 'سابق' : 'Prev', width: 7, numeric: true },
    { key: 'curr', header: isAr ? 'حالي' : 'Curr', width: 7, numeric: true },
    { key: 'net', header: isAr ? 'صافي' : 'Net', width: 7, numeric: true },
    { key: 'amount', header: isAr ? 'قيمة الفترة' : 'Period value', width: 10, money: true },
  ];

  const rows: ReportDocRow[] = data.lines.map((line) => ({
    costCenter: line.contractLabel || '—',
    chapter: line.chapterLabel || '—',
    description: line.description || '—',
    unit: line.unit || '—',
    rate: line.rate,
    prev: formatNumber(line.previousQty),
    curr: formatNumber(line.currentQty),
    net: formatNumber(line.netQty),
    amount: line.periodAmount,
  }));

  const deductionAmt = (n: number) => (n > 0 ? `(${formatMoney(n)})` : formatMoney(0));
  const summary: ReportDocKeyValueItem[] = [
    {
      label: isAr ? 'قيمة أعمال الفترة (بدون ضريبة)' : 'Period work value (excl. VAT)',
      value: formatMoney(data.worksValueExVat),
    },
    { label: isAr ? 'ضريبة القيمة المضافة' : 'VAT', value: formatMoney(data.vatAmount) },
  ];
  if (data.execGuaranteeAmount > 0) {
    summary.push({
      label: isAr ? 'حجز ضمان أعمال' : 'Retention',
      value: deductionAmt(data.execGuaranteeAmount),
      tone: 'danger',
    });
  }
  if (data.whtAmount > 0) {
    summary.push({ label: isAr ? 'خصم وإضافة' : 'WHT', value: deductionAmt(data.whtAmount), tone: 'danger' });
  }
  if (data.labourInsuranceAmount > 0) {
    summary.push({
      label: isAr ? 'تأمينات' : 'Insurance',
      value: deductionAmt(data.labourInsuranceAmount),
      tone: 'danger',
    });
  }
  if (data.manpowerLevyAmount > 0) {
    summary.push({
      label: isAr ? 'قوى عاملة' : 'Manpower levy',
      value: deductionAmt(data.manpowerLevyAmount),
      tone: 'danger',
    });
  }
  if (data.advancePaymentRecovery > 0) {
    summary.push({
      label: isAr ? 'استرداد مقدمة' : 'Advance recovery',
      value: deductionAmt(data.advancePaymentRecovery),
      tone: 'danger',
    });
  }
  summary.push({
    label: isAr ? 'صافي المستحق' : 'Net payable',
    value: formatMoney(data.netPayable),
    emphasize: true,
  });

  return [
    { kind: 'keyValue', items: meta, columnsPerRow: 3 },
    {
      kind: 'summary',
      title: isAr ? 'الملخص المالي' : 'Financial summary',
      items: summary,
    },
    {
      kind: 'table',
      title: isAr ? 'بنود مستخلص الخدمة' : 'Service IPC lines',
      columns,
      rows,
      flow: true,
      totals: { amount: data.worksValueExVat },
      totalsLabel: isAr ? 'إجمالي أعمال الفترة' : 'Period works total',
    },
    signaturesSection(isAr),
  ];
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

export type ConsumptionOrderPrintData = {
  orderNumber: string;
  orderDate: string;
  projectName?: string;
  contractName?: string;
  contractNumber?: string;
  statusLabel: string;
  notes?: string;
  lines: Array<{
    materialCode?: string;
    materialName: string;
    unit: string;
    chapterName?: string;
    quantity: number;
  }>;
  /** Optional typed names printed under the signature line. */
  requesterName?: string;
  receiverName?: string;
  storekeeperName?: string;
  formatQuantity: (n: number) => string;
};

/** Warehouse issue slip (إذن صرف) — quantities + chapter only; no expense/BOQ/cost on print. */
export function buildConsumptionOrderSections(
  data: ConsumptionOrderPrintData,
  language: 'ar' | 'en',
  _formatMoney?: (n: number) => string,
): ReportDocSection[] {
  const isAr = language === 'ar';

  const meta: ReportDocKeyValueItem[] = [
    { label: isAr ? 'رقم الإذن' : 'Issue No.', value: data.orderNumber },
    { label: isAr ? 'التاريخ' : 'Date', value: data.orderDate },
    { label: isAr ? 'الحالة' : 'Status', value: data.statusLabel },
  ];
  if (data.projectName) meta.push({ label: isAr ? 'المشروع' : 'Project', value: data.projectName });
  if (data.contractName || data.contractNumber) {
    const contractLabel = [data.contractNumber, data.contractName].filter(Boolean).join(' — ');
    meta.push({ label: isAr ? 'العقد' : 'Contract', value: contractLabel });
  }

  const columns: ReportDocColumn[] = [
    { key: 'code', header: isAr ? 'كود الصنف' : 'Code', width: 12, align: 'center' },
    { key: 'material', header: isAr ? 'الصنف' : 'Material', width: 28 },
    { key: 'unit', header: isAr ? 'الوحدة' : 'Unit', width: 8, align: 'center' },
    { key: 'chapter', header: isAr ? 'الفصل' : 'Chapter', width: 32 },
    { key: 'qty', header: isAr ? 'الكمية' : 'Qty', width: 12, numeric: true },
  ];

  const rows: ReportDocRow[] = data.lines.map((line) => ({
    code: line.materialCode || '—',
    material: line.materialName,
    unit: line.unit || '—',
    chapter: line.chapterName?.trim() || '—',
    qty: data.formatQuantity(line.quantity),
  }));

  const sections: ReportDocSection[] = [
    { kind: 'keyValue', items: meta, columnsPerRow: 3 },
    {
      kind: 'table',
      title: isAr ? 'بنود الصرف' : 'Issued Materials',
      columns,
      rows,
      flow: true,
    },
  ];
  if (data.notes?.trim()) {
    sections.push({ kind: 'note', text: `${isAr ? 'ملاحظات: ' : 'Notes: '}${data.notes.trim()}` });
  }
  sections.push({
    kind: 'signatures',
    signatures: [
      {
        role: isAr ? 'طالب الصرف' : 'Requested by',
        name: data.requesterName?.trim() || undefined,
      },
      {
        role: isAr ? 'المستلم' : 'Received by',
        name: data.receiverName?.trim() || undefined,
      },
      {
        role: isAr ? 'أمين المخزن' : 'Storekeeper',
        name: data.storekeeperName?.trim() || undefined,
      },
    ],
  });
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
