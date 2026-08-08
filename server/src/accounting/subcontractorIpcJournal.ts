import { AccountCodes } from './accountCodes.js';
import type { JournalEntryInput } from './journalShared.js';

export type SubcontractorIpcEntryParams = {
  worksValue: number;
  vatAmount: number;
  netPayable: number;
  execGuarantee: number;
  whtAmount: number;
  labourInsurance: number;
  manpowerLevy: number;
  advancePaymentRecovery: number;
  supplierName: string;
  supplierAccountCode?: string;
};

export function buildSubcontractorIpcEntries(params: SubcontractorIpcEntryParams): JournalEntryInput[] {
  const subcontractorCode = params.supplierAccountCode || AccountCodes.SUBCONTRACTORS;
  const subcontractorExpenseInclVat = params.worksValue + params.vatAmount;
  const entries: JournalEntryInput[] = [
    {
      accountCode: AccountCodes.EXPENSE_SUBCONTRACTOR,
      accountName: `تكاليف مقاولو الباطن - ${params.supplierName}`,
      debit: subcontractorExpenseInclVat,
      credit: 0,
    },
    {
      accountCode: subcontractorCode,
      accountName: `مقاولو الباطن - ${params.supplierName}`,
      debit: 0,
      credit: params.netPayable,
    },
    {
      accountCode: AccountCodes.RETENTION_PAYABLE,
      accountName: 'محتجز ضمان الأعمال - مقاولون',
      debit: 0,
      credit: params.execGuarantee,
    },
    {
      accountCode: AccountCodes.WHT_PAYABLE,
      accountName: 'مصلحة الضرائب - خصم وإضافة (دائن)',
      debit: 0,
      credit: params.whtAmount,
    },
    {
      accountCode: AccountCodes.SOCIAL_INSURANCE_PAYABLE,
      accountName: 'التأمينات الاجتماعية (دائن)',
      debit: 0,
      credit: params.labourInsurance,
    },
    {
      accountCode: AccountCodes.MANPOWER_LEVY_PAYABLE,
      accountName: 'القوى العاملة (دائن)',
      debit: 0,
      credit: params.manpowerLevy,
    },
  ];
  if (params.advancePaymentRecovery > 0) {
    entries.push({
      accountCode: AccountCodes.ADVANCE_PAYMENT,
      accountName: 'استرداد دفعة مقدمة',
      debit: 0,
      credit: params.advancePaymentRecovery,
    });
  }
  return entries.filter((e) => e.debit > 0 || e.credit > 0);
}
