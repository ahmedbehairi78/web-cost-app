import { IPC_KIND, type IpcKind } from '../constants/billingDefaults';
import { ipcLineToDateAmount, type IpcCoverWorksSplit } from './ipcCoverFromQtyList';
import type { IpcCoverSchedule } from './ipcCoverSchedule';
import type { IpcCoverContractSums } from './ipcCoverContractSums';
import { roundMoney } from './money';
import { serviceIpcPrintTitle } from './serviceContractor';

export interface CompanyPrintInfo {
  companyName: string;
  companyNameEn?: string;
  /** Center letterhead logo (also used as single-logo fallback). */
  headerLogo?: string;
  /** Optional left / right logos for IPC cover triple letterhead. */
  headerLogoLeft?: string;
  headerLogoRight?: string;
  /**
   * Middle line under center logo on IPC cover (default: CONSTRUCTION CONTRACT).
   * Project name and certificate number come from the IPC / project.
   */
  coverContractLabel?: string;
  /** Cover-JLL “Prepared By” / “Approved By” overrides. */
  coverPreparedBy?: string;
  coverApprovedBy?: string;
  taxId?: string;
  address?: string;
  addressEn?: string;
  footerText?: string;
  footerTextEn?: string;
  reportPrintProfiles?: import('./reportPrintProfiles').StoredReportPrintProfiles;
}

export interface IpcPrintItem {
  chapterName?: string;
  sectionName?: string;
  itemCode: string;
  description: string;
  unit: string;
  tenderQty?: number;
  rate: number;
  previousQty: number;
  currentQty: number;
  totalQty: number;
  amount: number;
  boqItemId?: string;
}

export interface IpcPrintData {
  variant: 'billing' | 'subcontractor';
  ipcKind?: IpcKind;
  documentNumber: string;
  dateLabel: string;
  projectName?: string;
  contractName?: string;
  /** Contractor / company performing the works (cover header). */
  contractorName?: string;
  subcontractorName?: string;
  statusLabel?: string;
  items: IpcPrintItem[];
  /** Cover split: basic vs VO-additional from the same qty list. */
  coverWorks?: IpcCoverWorksSplit;
  /** Cover-JLL schedule block (LOA / commencement / duration / extension / completion). */
  coverSchedule?: IpcCoverSchedule;
  /** Cover-JLL contract sums (original / VO / adjusted). */
  coverContractSums?: IpcCoverContractSums;
  materialsOnSite?: number;
  priceAdjustment?: number;
  /** Cumulative net of prior approved/paid IPCs (cover Previous Payments). */
  previousPayments?: number;
  worksValueExVat: number;
  /** Explicit VAT % for cover (BOQ rates are VAT-inclusive; do not derive from vat/works). */
  vatPct?: number;
  /** Cover-JLL % rates — must match on-screen IpcCoverPanel. */
  coverRates?: Partial<import('./ipcCoverSheet').IpcCoverSheetRates>;
  vatAmount: number;
  execGuaranteeAmount: number;
  whtAmount: number;
  labourInsuranceAmount: number;
  manpowerLevyAmount: number;
  performanceSecurityAmount?: number;
  syndicateStampAmount?: number;
  backChargeAmount?: number;
  /** Total advance payment (cover); recovery is separate. */
  advancePaymentTotal?: number;
  advancePaymentRecovery: number;
  netPayable: number;
  /** To-date waterfall (subcontractor certificate — same as service IPC). */
  previousWorksExVat?: number;
  totalWorksExVat?: number;
  vatToDate?: number;
  execGuaranteeToDate?: number;
  labourInsuranceToDate?: number;
  whtToDate?: number;
  manpowerLevyToDate?: number;
  netAfterDeductions?: number;
}

export function ipcPrintTitle(data: IpcPrintData, language: 'ar' | 'en'): string {
  if (data.variant === 'subcontractor') {
    return serviceIpcPrintTitle({
      contractorName: data.subcontractorName || data.contractorName,
      documentNumber: data.documentNumber,
      statusLabel: data.statusLabel,
      language,
    });
  }
  if (data.ipcKind === IPC_KIND.FINAL) {
    return language === 'ar' ? 'مستخلص نهائي' : 'Final Payment Certificate';
  }
  return language === 'ar' ? 'مستخلص جاري' : 'Interim Payment Certificate (IPC)';
}

export function groupIpcItemsByChapter(
  items: IpcPrintItem[],
  language: 'ar' | 'en',
): { chapterName: string; items: IpcPrintItem[] }[] {
  const map = new Map<string, IpcPrintItem[]>();
  for (const item of items) {
    const ch = item.chapterName || (language === 'ar' ? 'غير مصنف' : 'Uncategorized');
    if (!map.has(ch)) map.set(ch, []);
    map.get(ch)!.push(item);
  }
  return Array.from(map.entries()).map(([chapterName, chapterItems]) => ({
    chapterName,
    items: chapterItems,
  }));
}

export function totalIpcDeductions(data: IpcPrintData): number {
  return roundMoney(
    data.execGuaranteeAmount +
      (data.performanceSecurityAmount || 0) +
      (data.whtAmount || 0) +
      data.labourInsuranceAmount +
      data.manpowerLevyAmount +
      (data.syndicateStampAmount || 0) +
      (data.backChargeAmount || 0) +
      (data.advancePaymentRecovery || 0),
  );
}

export function deductionPctLabel(amount: number, works: number, decimals = 1): string {
  if (works <= 0) return '—';
  return `${((amount / works) * 100).toFixed(decimals)}%`;
}

/** Excel-style: "5% × base 1,000.00" for deduction lines. */
export function deductionPctAndBaseLabel(
  amount: number,
  works: number,
  formatMoney: (n: number) => string,
  decimals = 1,
): string {
  if (works <= 0) return '—';
  return `${deductionPctLabel(amount, works, decimals)} × ${formatMoney(works)}`;
}

export function mapToIpcPrintItems<
  T extends {
    boqItemId?: string;
    chapterName?: string;
    sectionName?: string;
    itemCode: string;
    description: string;
    unit: string;
    tenderQty?: number;
    rate: number;
    previousQty: number;
    currentQty: number;
    totalQty: number;
    amount: number;
  },
>(items: T[]): IpcPrintItem[] {
  return items.map((item) => ({
    boqItemId: item.boqItemId,
    chapterName: item.chapterName,
    sectionName: item.sectionName,
    itemCode: item.itemCode,
    description: item.description,
    unit: item.unit,
    tenderQty: item.tenderQty,
    rate: item.rate,
    previousQty: item.previousQty,
    currentQty: item.currentQty,
    totalQty: item.totalQty,
    // Qty list value = to-date executed (totalQty × rate), not period only.
    amount: ipcLineToDateAmount(item),
  }));
}

export function buildBillingIpcPrintData(input: {
  ipcKind?: IpcKind;
  billingNumber: string;
  dateLabel: string;
  projectName?: string;
  contractName?: string;
  contractorName?: string;
  statusLabel?: string;
  items: IpcPrintItem[];
  coverWorks?: IpcCoverWorksSplit;
  coverSchedule?: IpcCoverSchedule;
  coverContractSums?: IpcCoverContractSums;
  materialsOnSite?: number;
  priceAdjustment?: number;
  previousPayments?: number;
  worksValueExVat: number;
  vatPct?: number;
  coverRates?: Partial<import('./ipcCoverSheet').IpcCoverSheetRates>;
  vatAmount: number;
  execGuaranteeAmount: number;
  whtAmount: number;
  labourInsuranceAmount: number;
  manpowerLevyAmount: number;
  performanceSecurityAmount?: number;
  syndicateStampAmount?: number;
  backChargeAmount?: number;
  advancePaymentTotal?: number;
  advancePaymentRecovery: number;
  netPayable: number;
}): IpcPrintData {
  return {
    variant: 'billing',
    ipcKind: input.ipcKind,
    documentNumber: input.billingNumber,
    dateLabel: input.dateLabel,
    projectName: input.projectName,
    contractName: input.contractName,
    contractorName: input.contractorName,
    statusLabel: input.statusLabel,
    items: input.items,
    coverWorks: input.coverWorks,
    coverSchedule: input.coverSchedule,
    coverContractSums: input.coverContractSums,
    materialsOnSite: input.materialsOnSite,
    priceAdjustment: input.priceAdjustment,
    previousPayments: input.previousPayments,
    worksValueExVat: input.worksValueExVat,
    vatPct: input.vatPct,
    coverRates: input.coverRates,
    vatAmount: input.vatAmount,
    execGuaranteeAmount: input.execGuaranteeAmount,
    whtAmount: input.whtAmount,
    labourInsuranceAmount: input.labourInsuranceAmount,
    manpowerLevyAmount: input.manpowerLevyAmount,
    performanceSecurityAmount: input.performanceSecurityAmount,
    syndicateStampAmount: input.syndicateStampAmount,
    backChargeAmount: input.backChargeAmount,
    advancePaymentTotal: input.advancePaymentTotal,
    advancePaymentRecovery: input.advancePaymentRecovery,
    netPayable: input.netPayable,
  };
}

export function buildSubcontractorIpcPrintData(input: {
  referenceNumber: string;
  dateLabel: string;
  projectName?: string;
  contractName?: string;
  subcontractorName?: string;
  statusLabel?: string;
  items: IpcPrintItem[];
  worksValueExVat: number;
  vatAmount: number;
  execGuaranteeAmount: number;
  whtAmount: number;
  labourInsuranceAmount: number;
  manpowerLevyAmount: number;
  advancePaymentRecovery: number;
  netPayable: number;
  previousWorksExVat?: number;
  totalWorksExVat?: number;
  vatToDate?: number;
  execGuaranteeToDate?: number;
  labourInsuranceToDate?: number;
  whtToDate?: number;
  manpowerLevyToDate?: number;
  netAfterDeductions?: number;
  previousPayments?: number;
}): IpcPrintData {
  return {
    variant: 'subcontractor',
    documentNumber: input.referenceNumber,
    dateLabel: input.dateLabel,
    projectName: input.projectName,
    contractName: input.contractName,
    subcontractorName: input.subcontractorName,
    statusLabel: input.statusLabel,
    items: input.items,
    worksValueExVat: input.worksValueExVat,
    vatAmount: input.vatAmount,
    execGuaranteeAmount: input.execGuaranteeAmount,
    whtAmount: input.whtAmount,
    labourInsuranceAmount: input.labourInsuranceAmount,
    manpowerLevyAmount: input.manpowerLevyAmount,
    advancePaymentRecovery: input.advancePaymentRecovery,
    netPayable: input.netPayable,
    previousWorksExVat: input.previousWorksExVat,
    totalWorksExVat: input.totalWorksExVat,
    vatToDate: input.vatToDate,
    execGuaranteeToDate: input.execGuaranteeToDate,
    labourInsuranceToDate: input.labourInsuranceToDate,
    whtToDate: input.whtToDate,
    manpowerLevyToDate: input.manpowerLevyToDate,
    netAfterDeductions: input.netAfterDeductions,
    previousPayments: input.previousPayments,
  };
}
