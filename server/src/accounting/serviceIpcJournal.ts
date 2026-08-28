import { AccountCodes } from './accountCodes.js';
import { roundMoney } from '../lib/money.js';
import type { JournalEntryInput } from './journalShared.js';
import {
  type ServiceIpcKind,
  type ServiceIpcLine,
  periodLineAmount,
} from '../lib/serviceContractor.js';

export type ServiceIpcJournalParams = {
  serviceKind: ServiceIpcKind;
  supplierName: string;
  supplierAccountCode?: string;
  lines: ServiceIpcLine[];
  vatAmount: number;
  execGuarantee: number;
  whtAmount: number;
  labourInsurance: number;
  manpowerLevy: number;
  advancePaymentRecovery: number;
};

function expenseAccount(kind: ServiceIpcKind): string {
  if (kind === 'labour') return AccountCodes.EXPENSE_LABOUR;
  if (kind === 'housing') return AccountCodes.EXPENSE_SUBCONTRACTOR;
  return AccountCodes.EXPENSE_EQUIPMENT;
}

function expenseName(kind: ServiceIpcKind, supplierName: string): string {
  if (kind === 'labour') return `عمالة مباشرة - ${supplierName}`;
  if (kind === 'housing') return `تكاليف مقاولو الباطن - ${supplierName}`;
  if (kind === 'vehicles') return `معدات وآلات (سيارات) - ${supplierName}`;
  return `معدات وآلات - ${supplierName}`;
}

function splitInclusiveVatByCenter(
  expenseInclVat: number,
  byCenter: Map<string, number>,
): { costCenterId: string; amount: number }[] {
  const rows = [...byCenter.entries()].filter(([, w]) => w > 0);
  const totalWeight = rows.reduce((s, [, w]) => s + w, 0);
  if (rows.length === 0 || totalWeight <= 0 || expenseInclVat <= 0) return [];
  let allocated = 0;
  return rows.map(([costCenterId, weight], i) => {
    const amount =
      i === rows.length - 1
        ? roundMoney(expenseInclVat - allocated)
        : roundMoney((expenseInclVat * weight) / totalWeight);
    allocated = roundMoney(allocated + amount);
    return { costCenterId, amount };
  });
}

/**
 * Service IPC journal — expense from serviceKind; Dr split by contract costCenterId.
 * Supplier credit is residual so Dr === Cr.
 */
export function buildServiceIpcEntries(params: ServiceIpcJournalParams): JournalEntryInput[] {
  const byCenter = new Map<string, number>();
  for (const line of params.lines) {
    const cc = String(line.contractId || '').trim();
    const amt = roundMoney(periodLineAmount(line));
    if (!cc || amt <= 0) continue;
    byCenter.set(cc, roundMoney((byCenter.get(cc) || 0) + amt));
  }

  const worksValue = roundMoney([...byCenter.values()].reduce((s, n) => s + n, 0));
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

  const expenseCode = expenseAccount(params.serviceKind);
  const name = expenseName(params.serviceKind, params.supplierName);
  const subcontractorCode = params.supplierAccountCode || AccountCodes.SUBCONTRACTORS;

  const entries: JournalEntryInput[] = splitInclusiveVatByCenter(expenseInclVat, byCenter).map((row) => ({
    accountCode: expenseCode,
    accountName: name,
    debit: row.amount,
    credit: 0,
    costCenterId: row.costCenterId,
  }));

  entries.push({
    accountCode: subcontractorCode,
    accountName: `مقاولو الباطن - ${params.supplierName}`,
    debit: 0,
    credit: netPayable,
  });
  entries.push({
    accountCode: AccountCodes.RETENTION_PAYABLE,
    accountName: 'محتجز ضمان الأعمال - مقاولون',
    debit: 0,
    credit: execGuarantee,
  });
  entries.push({
    accountCode: AccountCodes.WHT_PAYABLE,
    accountName: 'مصلحة الضرائب - خصم وإضافة (دائن)',
    debit: 0,
    credit: whtAmount,
  });
  entries.push({
    accountCode: AccountCodes.SOCIAL_INSURANCE_PAYABLE,
    accountName: 'التأمينات الاجتماعية (دائن)',
    debit: 0,
    credit: labourInsurance,
  });
  entries.push({
    accountCode: AccountCodes.MANPOWER_LEVY_PAYABLE,
    accountName: 'القوى العاملة (دائن)',
    debit: 0,
    credit: manpowerLevy,
  });
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
