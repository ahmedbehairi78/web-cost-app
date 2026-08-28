import { roundMoney } from './money';
import {
  type ServiceIpcKind,
  type ServiceIpcLine,
  periodLineAmount,
  serviceKindExpenseAccount,
  serviceKindExpenseName,
} from './serviceContractor';

export type ServiceIpcJournalEntry = {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  costCenterId?: string;
};

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
 * Service IPC journal — one expense code from serviceKind; Dr split by contract cost center.
 * Supplier credit is residual so Dr === Cr.
 */
export function buildServiceIpcEntries(params: ServiceIpcJournalParams): ServiceIpcJournalEntry[] {
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

  const expenseCode = serviceKindExpenseAccount(params.serviceKind);
  const expenseName = serviceKindExpenseName(params.serviceKind, params.supplierName);
  const subcontractorCode = params.supplierAccountCode || '21102001';

  const entries: ServiceIpcJournalEntry[] = splitInclusiveVatByCenter(expenseInclVat, byCenter).map((row) => ({
    accountCode: expenseCode,
    accountName: expenseName,
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
    accountCode: '21201001',
    accountName: 'محتجز ضمان الأعمال - مقاولون',
    debit: 0,
    credit: execGuarantee,
  });
  entries.push({
    accountCode: '21402001',
    accountName: 'مصلحة الضرائب - خصم وإضافة (دائن)',
    debit: 0,
    credit: whtAmount,
  });
  entries.push({
    accountCode: '21403001',
    accountName: 'التأمينات الاجتماعية (دائن)',
    debit: 0,
    credit: labourInsurance,
  });
  entries.push({
    accountCode: '21404001',
    accountName: 'القوى العاملة (دائن)',
    debit: 0,
    credit: manpowerLevy,
  });
  if (advancePaymentRecovery > 0) {
    entries.push({
      accountCode: '21301001',
      accountName: 'استرداد دفعة مقدمة',
      debit: 0,
      credit: advancePaymentRecovery,
    });
  }
  return entries.filter((e) => e.debit > 0 || e.credit > 0);
}
