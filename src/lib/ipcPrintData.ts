import { IPC_KIND, type IpcKind } from '../constants/billingDefaults';
import { roundMoney } from './money';

export interface CompanyPrintInfo {
  companyName: string;
  companyNameEn?: string;
  headerLogo?: string;
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
}

export interface IpcPrintData {
  variant: 'billing' | 'subcontractor';
  ipcKind?: IpcKind;
  documentNumber: string;
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
}

export function ipcPrintTitle(data: IpcPrintData, language: 'ar' | 'en'): string {
  if (data.variant === 'subcontractor') {
    return language === 'ar' ? 'مستخلص مقاول باطن' : 'Subcontractor IPC';
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
      (data.whtAmount || 0) +
      data.labourInsuranceAmount +
      data.manpowerLevyAmount +
      (data.advancePaymentRecovery || 0),
  );
}

export function deductionPctLabel(amount: number, works: number, decimals = 1): string {
  if (works <= 0) return '—';
  return `${((amount / works) * 100).toFixed(decimals)}%`;
}

export function mapToIpcPrintItems<
  T extends {
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
    amount: item.amount,
  }));
}

export function buildBillingIpcPrintData(input: {
  ipcKind?: IpcKind;
  billingNumber: string;
  dateLabel: string;
  projectName?: string;
  contractName?: string;
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
}): IpcPrintData {
  return {
    variant: 'billing',
    ipcKind: input.ipcKind,
    documentNumber: input.billingNumber,
    dateLabel: input.dateLabel,
    projectName: input.projectName,
    contractName: input.contractName,
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
  };
}

export function buildSubcontractorIpcPrintData(input: {
  referenceNumber: string;
  dateLabel: string;
  projectName?: string;
  contractName?: string;
  subcontractorName?: string;
  items: IpcPrintItem[];
  worksValueExVat: number;
  vatAmount: number;
  execGuaranteeAmount: number;
  whtAmount: number;
  labourInsuranceAmount: number;
  manpowerLevyAmount: number;
  advancePaymentRecovery: number;
  netPayable: number;
}): IpcPrintData {
  return {
    variant: 'subcontractor',
    documentNumber: input.referenceNumber,
    dateLabel: input.dateLabel,
    projectName: input.projectName,
    contractName: input.contractName,
    subcontractorName: input.subcontractorName,
    items: input.items,
    worksValueExVat: input.worksValueExVat,
    vatAmount: input.vatAmount,
    execGuaranteeAmount: input.execGuaranteeAmount,
    whtAmount: input.whtAmount,
    labourInsuranceAmount: input.labourInsuranceAmount,
    manpowerLevyAmount: input.manpowerLevyAmount,
    advancePaymentRecovery: input.advancePaymentRecovery,
    netPayable: input.netPayable,
  };
}
