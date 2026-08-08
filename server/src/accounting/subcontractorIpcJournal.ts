import { AccountCodes } from './accountCodes.js';
import { roundMoney } from '../lib/money.js';
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

/**
 * Subcontractor IPC journal — round legs to 2dp; supplier credit is residual so Dr === Cr.
 * `params.netPayable` is advisory for GL balancing.
 */
export function buildSubcontractorIpcEntries(params: SubcontractorIpcEntryParams): JournalEntryInput[] {
  const subcontractorCode = params.supplierAccountCode || AccountCodes.SUBCONTRACTORS;
  const worksValue = roundMoney(params.worksValue);
  const vatAmount = roundMoney(params.vatAmount);
  const execGuarantee = roundMoney(params.execGuarantee);
  const whtAmount = roundMoney(params.whtAmount);
  const labourInsurance = roundMoney(params.labourInsurance);
  const manpowerLevy = roundMoney(params.manpowerLevy);
  const advancePaymentRecovery = roundMoney(params.advancePaymentRecovery);

  const expenseInclVat = roundMoney(worksValue + vatAmount);
  const otherCredits = roundMoney(
    execGuarantee + whtAmount + labourInsurance + manpowerLevy + advancePaymentRecovery,
  );
  const netPayable = roundMoney(expenseInclVat - otherCredits);

  const entries: JournalEntryInput[] = [
    {
      accountCode: AccountCodes.EXPENSE_SUBCONTRACTOR,
      accountName: `تكاليف مقاولو الباطن - ${params.supplierName}`,
      debit: expenseInclVat,
      credit: 0,
    },
    {
      accountCode: subcontractorCode,
      accountName: `مقاولو الباطن - ${params.supplierName}`,
      debit: 0,
      credit: netPayable,
    },
    {
      accountCode: AccountCodes.RETENTION_PAYABLE,
      accountName: 'محتجز ضمان الأعمال - مقاولون',
      debit: 0,
      credit: execGuarantee,
    },
    {
      accountCode: AccountCodes.WHT_PAYABLE,
      accountName: 'مصلحة الضرائب - خصم وإضافة (دائن)',
      debit: 0,
      credit: whtAmount,
    },
    {
      accountCode: AccountCodes.SOCIAL_INSURANCE_PAYABLE,
      accountName: 'التأمينات الاجتماعية (دائن)',
      debit: 0,
      credit: labourInsurance,
    },
    {
      accountCode: AccountCodes.MANPOWER_LEVY_PAYABLE,
      accountName: 'القوى العاملة (دائن)',
      debit: 0,
      credit: manpowerLevy,
    },
  ];
  if (advancePaymentRecovery > 0) {
    entries.push({
      accountCode: AccountCodes.ADVANCE_PAYMENT,
      accountName: 'استرداد دفعة مقدمة',
      debit: 0,
      credit: advancePaymentRecovery,
    });
  }
  return entries.filter((e) => e.debit > 0 || e.credit > 0);
}
