import { prisma } from '../db.js';
import { roundMoney } from './money.js';
import {
  CASH_BUDGET_BILLING_STATUSES,
  computeCashBudgetSummary,
  custodyReplenishAmount,
  isCustodyCashLeafCode,
  isDateInRange,
  payrollMonthOverlapsPeriod,
  ymdKey,
  type CashBudgetPeriodType,
} from './cashBudget.js';

export type SuggestedLine = {
  side: 'obligation' | 'source';
  category: string;
  description: string;
  amount: number;
  dueDate: string | null;
  origin: 'auto';
  originType: string;
  originId: string;
  projectId: string | null;
  contractId: string | null;
  excluded: boolean;
  sortOrder: number;
};

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'toNumber' in v && typeof (v as { toNumber: () => number }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function glPrefixBalancesBefore(
  prefix: string,
  periodStart: string,
): Promise<{ total: number; byCode: Map<string, number> }> {
  const rows = await prisma.journalEntry.findMany({
    where: {
      accountCode: { startsWith: prefix },
      transaction: { isDeleted: false, date: { lt: periodStart } },
    },
    select: { accountCode: true, debit: true, credit: true },
  });
  const byCode = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    const code = String(row.accountCode ?? '').trim();
    const net = roundMoney(num(row.debit) - num(row.credit));
    byCode.set(code, roundMoney((byCode.get(code) ?? 0) + net));
    total = roundMoney(total + net);
  }
  return { total, byCode };
}

export async function buildCashBudgetSuggestion(input: {
  periodType: CashBudgetPeriodType;
  periodStart: string;
  periodEnd: string;
}): Promise<{ openingBank: number; openingCash: number; lines: SuggestedLine[] }> {
  const { periodStart, periodEnd } = input;

  const [
    bankGl,
    cashGl,
    invoices,
    ipcs,
    settlements,
    payrollRuns,
    billings,
    custodyAccounts,
  ] = await Promise.all([
    glPrefixBalancesBefore('12101', periodStart),
    glPrefixBalancesBefore('12102', periodStart),
    prisma.purchaseTransaction.findMany({
      where: { isDeleted: false, type: 'invoice' },
    }),
    prisma.purchaseTransaction.findMany({
      where: { isDeleted: false, type: 'ipc', status: 'approved' },
    }),
    prisma.custodySettlement.findMany({
      where: { isDeleted: false, status: 'submitted' },
    }),
    prisma.payrollRun.findMany({
      where: { isDeleted: false, paymentTransactionId: null },
    }),
    prisma.billing.findMany({
      where: { isDeleted: false, status: { in: [...CASH_BUDGET_BILLING_STATUSES] } },
    }),
    prisma.chartOfAccount.findMany({
      where: { isGroup: false, status: { not: 'disabled' } },
    }),
  ]);

  const pendingByCustody = new Map<string, number>();
  for (const row of settlements) {
    const code = String(row.custodyAccountCode ?? '').trim();
    pendingByCustody.set(code, roundMoney((pendingByCustody.get(code) ?? 0) + num(row.totalAmount)));
  }

  const lines: SuggestedLine[] = [];
  let sort = 0;
  const push = (line: Omit<SuggestedLine, 'origin' | 'excluded' | 'sortOrder'>) => {
    if (roundMoney(line.amount) <= 0) return;
    lines.push({ ...line, origin: 'auto', excluded: false, sortOrder: sort++ });
  };

  push({
    side: 'source',
    category: 'opening_bank',
    description: 'رصيد البنوك في بداية الفترة',
    amount: bankGl.total,
    dueDate: periodStart,
    originType: 'gl_opening',
    originId: 'bank',
    projectId: null,
    contractId: null,
  });
  push({
    side: 'source',
    category: 'opening_cash',
    description: 'رصيد النقدية والعهد في بداية الفترة',
    amount: cashGl.total,
    dueDate: periodStart,
    originType: 'gl_opening',
    originId: 'cash',
    projectId: null,
    contractId: null,
  });

  for (const inv of invoices) {
    const paymentType = String(inv.paymentType ?? 'credit').toLowerCase();
    if (paymentType === 'cash') continue;
    if (!isDateInRange(inv.date, periodStart, periodEnd)) continue;
    const ref = inv.referenceNumber?.trim() || inv.id.slice(0, 8);
    push({
      side: 'obligation',
      category: 'supplier',
      description: `مورد — ${inv.supplierName} (${ref})`,
      amount: roundMoney(num(inv.totalAmount) || num(inv.amount)),
      dueDate: ymdKey(inv.date) || null,
      originType: 'purchase_invoice',
      originId: inv.id,
      projectId: inv.projectId,
      contractId: inv.contractId,
    });
  }

  for (const ipc of ipcs) {
    if (!isDateInRange(ipc.date, periodStart, periodEnd)) continue;
    const ref = ipc.referenceNumber?.trim() || ipc.id.slice(0, 8);
    push({
      side: 'obligation',
      category: 'subcontractor',
      description: `مقاول باطن — ${ipc.supplierName} (${ref})`,
      amount: roundMoney(num(ipc.totalAmount) || num(ipc.amount)),
      dueDate: ymdKey(ipc.date) || null,
      originType: 'subcontractor_ipc',
      originId: ipc.id,
      projectId: ipc.projectId,
      contractId: ipc.contractId,
    });
  }

  for (const set of settlements) {
    push({
      side: 'obligation',
      category: 'custody_settlement',
      description: `تسوية عهدة ${set.settlementNumber}`,
      amount: roundMoney(num(set.totalAmount)),
      dueDate: ymdKey(set.date) || null,
      originType: 'custody_settlement',
      originId: set.id,
      projectId: set.projectId,
      contractId: null,
    });
  }

  for (const acc of custodyAccounts) {
    const code = String(acc.accountCode ?? '').trim();
    if (!isCustodyCashLeafCode(code)) continue;
    const gl = cashGl.byCode.get(code) ?? 0;
    const pending = pendingByCustody.get(code) ?? 0;
    const replenish = custodyReplenishAmount(num(acc.minBalance), gl, pending);
    if (replenish <= 0) continue;
    const name = acc.accountName || code;
    push({
      side: 'obligation',
      category: 'custody_replenish',
      description: `تعويض حد أدنى عهدة — ${name} (${code})`,
      amount: replenish,
      dueDate: periodStart,
      originType: 'custody_min',
      originId: acc.id || code,
      projectId: acc.projectId,
      contractId: null,
    });
  }

  for (const run of payrollRuns) {
    if (run.status === 'paid') continue;
    if (!payrollMonthOverlapsPeriod(run.periodYear, run.periodMonth, periodStart, periodEnd)) continue;
    push({
      side: 'obligation',
      category: 'payroll',
      description: `رواتب — ${run.periodLabel || run.runNumber}`,
      amount: roundMoney(num(run.totalNet)),
      dueDate: ymdKey(run.paymentDate) || periodEnd,
      originType: 'payroll_run',
      originId: run.id,
      projectId: null,
      contractId: null,
    });
  }

  for (const bill of billings) {
    if (!isDateInRange(bill.date, periodStart, periodEnd)) continue;
    push({
      side: 'source',
      category: 'collection',
      description: `مستخلص عميل ${bill.billingNumber}`,
      amount: roundMoney(num(bill.netPayable)),
      dueDate: ymdKey(bill.date) || null,
      originType: 'billing_ipc',
      originId: bill.id,
      projectId: bill.projectId,
      contractId: bill.contractId,
    });
  }

  return {
    openingBank: bankGl.total,
    openingCash: cashGl.total,
    lines,
  };
}

export { computeCashBudgetSummary };
