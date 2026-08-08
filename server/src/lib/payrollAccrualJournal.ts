import { AccountCodes } from '../accounting/accountCodes.js';
import { MONEY_TOLERANCE, roundMoney } from './money.js';

export const PAYROLL_ACCRUAL_ACCOUNTS = {
  netSalaries: AccountCodes.SALARIES_PAYABLE,
  socialInsurance: AccountCodes.SOCIAL_INSURANCE_PAYABLE,
  incomeTax: AccountCodes.PAYROLL_TAX_PAYABLE,
  advances: AccountCodes.EMPLOYEE_ADVANCES,
  /** Used only for otherDeductions (not sheet penalties). */
  otherWithheld: AccountCodes.PAYROLL_PENALTIES_WITHHELD,
  defaultExpense: AccountCodes.EXPENSE_ADMIN,
} as const;

export const PAYROLL_ACCRUAL_ACCOUNT_NAMES: Record<string, string> = {
  [AccountCodes.SALARIES_PAYABLE]: 'رواتب وأجور مستحقة الدفع',
  [AccountCodes.SOCIAL_INSURANCE_PAYABLE]: 'التأمينات الاجتماعية - دائن',
  [AccountCodes.PAYROLL_TAX_PAYABLE]: 'ضريبة كسب العمل - دائن',
  [AccountCodes.EMPLOYEE_ADVANCES]: 'سلف العاملين',
  [AccountCodes.PAYROLL_PENALTIES_WITHHELD]: 'جزاءات وخصومات محتجزة',
  [AccountCodes.EXPENSE_LABOUR]: 'عمالة مباشرة',
  [AccountCodes.EXPENSE_ADMIN]: 'رواتب وأجور إدارية',
};

/** Resolve a display name for a payroll expense (debit) account. */
export function resolvePayrollExpenseAccountName(
  accountCode: string,
  explicitName?: string | null,
  coaNameByCode?: Map<string, string> | Record<string, string> | null,
): string {
  const code = String(accountCode ?? '').trim();
  const explicit = String(explicitName ?? '').trim();
  if (explicit) return explicit;
  if (coaNameByCode) {
    const fromCoa = coaNameByCode instanceof Map
      ? coaNameByCode.get(code)
      : coaNameByCode[code];
    if (fromCoa?.trim()) return fromCoa.trim();
  }
  return PAYROLL_ACCRUAL_ACCOUNT_NAMES[code] || code;
}

export interface AccrualJournalLine {
  accountCode: string;
  accountName?: string;
  debit: number;
  credit: number;
  costCenterId?: string;
}

export interface AccrualAllocationInput {
  costCenterId?: string | null;
  costCenterType?: string | null;
  expenseAccountCode?: string | null;
  expenseAccountName?: string | null;
  percentage?: unknown;
}

export interface AccrualLineInput {
  expenseAccountCode: string;
  expenseAccountName?: string | null;
  costCenterId?: string | null;
  employeeCode?: string | null;
  employeeName?: string | null;
  grossSalary: unknown;
  socialInsurance: unknown;
  incomeTax: unknown;
  advances: unknown;
  penalties: unknown;
  otherDeductions: unknown;
  netSalary: unknown;
  allocations?: AccrualAllocationInput[] | null;
}

/** True when the line has a header cost center or at least one allocation with a cost center. */
export function payrollLineHasCostCenter(line: {
  costCenterId?: string | null;
  allocations?: AccrualAllocationInput[] | null;
}): boolean {
  if (String(line.costCenterId ?? '').trim()) return true;
  return (line.allocations ?? []).some((a) => String(a.costCenterId ?? '').trim() !== '');
}

/** Employee codes/names missing a cost center (for accrual guard). */
export function findPayrollLinesMissingCostCenter(
  lines: Array<{
    employeeCode?: string | null;
    employeeName?: string | null;
    costCenterId?: string | null;
    allocations?: AccrualAllocationInput[] | null;
  }>,
): string[] {
  return lines
    .filter((l) => !payrollLineHasCostCenter(l))
    .map((l) => {
      const code = String(l.employeeCode ?? '').trim();
      const name = String(l.employeeName ?? '').trim();
      return code || name || '?';
    });
}

export function payrollMissingCostCenterError(missing: string[]): string {
  const list = missing.slice(0, 12).join('، ');
  const more = missing.length > 12 ? ` (+${missing.length - 12})` : '';
  return `لا يمكن إثبات الاستحقاق بدون اختيار مركز تكلفة لكل موظف. ناقص: ${list}${more}`;
}

function num(v: unknown): number {
  return Number(v) || 0;
}

function str(v: unknown): string {
  return String(v ?? '').trim();
}

/** Split an amount across percentage weights; last weight absorbs the rounding remainder. */
export function distributeByPercentage(amount: number, percentages: number[]): number[] {
  const total = percentages.reduce((s, p) => s + p, 0);
  if (total <= 0) return percentages.map(() => 0);
  const out: number[] = [];
  let allocated = 0;
  for (let i = 0; i < percentages.length; i++) {
    if (i === percentages.length - 1) {
      out.push(roundMoney(amount - allocated));
    } else {
      const amt = roundMoney((amount * percentages[i]!) / total);
      out.push(amt);
      allocated = roundMoney(allocated + amt);
    }
  }
  return out;
}

/**
 * Build balanced payroll accrual journal lines from run lines.
 *
 * Sheet penalties remain on the payroll register for employee notification, but
 * are excluded from GL: Dr expense = gross − penalties (no Cr to penalties for
 * that amount). Credits: net payable + SI + tax + advances (+ otherDeductions
 * only on the other-withheld clearing account). Net credit = sheet netSalary.
 */
export function buildPayrollAccrualEntries(
  lines: AccrualLineInput[],
  coaNameByCode?: Map<string, string> | Record<string, string> | null,
): AccrualJournalLine[] {
  const drMap = new Map<string, { code: string; name: string; costCenterId: string | null; amount: number }>();
  const addDr = (code: string, name: string, costCenterId: string | null, amount: number) => {
    if (amount <= 0) return;
    const key = `${code}::${costCenterId ?? ''}`;
    const cur = drMap.get(key);
    if (cur) {
      cur.amount = roundMoney(cur.amount + amount);
      if (!cur.name && name) cur.name = name;
    } else {
      drMap.set(key, { code, name, costCenterId, amount });
    }
  };

  let sumInsurance = 0;
  let sumTax = 0;
  let sumAdvances = 0;
  let sumOtherDeductions = 0;
  let sumNet = 0;

  for (const line of lines) {
    const gross = roundMoney(num(line.grossSalary));
    const penalties = roundMoney(num(line.penalties));
    /** Accrue expense net of penalties — penalties never appear as a GL liability. */
    const expenseAmount = roundMoney(Math.max(0, gross - penalties));
    const lineCode = (line.expenseAccountCode || '').trim() || PAYROLL_ACCRUAL_ACCOUNTS.defaultExpense;
    const lineName = resolvePayrollExpenseAccountName(lineCode, line.expenseAccountName, coaNameByCode);
    const allocs = (line.allocations ?? [])
      .map((a) => {
        const code = str(a.expenseAccountCode) || lineCode;
        return {
          code,
          name: resolvePayrollExpenseAccountName(code, a.expenseAccountName || line.expenseAccountName, coaNameByCode),
          costCenterId: str(a.costCenterId) || null,
          percentage: num(a.percentage),
        };
      })
      .filter((a) => a.percentage > 0);

    if (allocs.length) {
      const amounts = distributeByPercentage(expenseAmount, allocs.map((a) => a.percentage));
      allocs.forEach((a, idx) => addDr(a.code, a.name, a.costCenterId, amounts[idx] ?? 0));
    } else {
      addDr(lineCode, lineName, line.costCenterId?.trim() || null, expenseAmount);
    }

    sumInsurance = roundMoney(sumInsurance + num(line.socialInsurance));
    sumTax = roundMoney(sumTax + num(line.incomeTax));
    sumAdvances = roundMoney(sumAdvances + num(line.advances));
    sumOtherDeductions = roundMoney(sumOtherDeductions + num(line.otherDeductions));
    sumNet = roundMoney(sumNet + num(line.netSalary));
  }

  const entries: AccrualJournalLine[] = [];
  for (const dr of drMap.values()) {
    if (dr.amount <= MONEY_TOLERANCE) continue;
    entries.push({
      accountCode: dr.code,
      accountName: dr.name || resolvePayrollExpenseAccountName(dr.code, null, coaNameByCode),
      debit: dr.amount,
      credit: 0,
      costCenterId: dr.costCenterId ?? undefined,
    });
  }
  const addCredit = (code: string, amount: number) => {
    if (amount <= MONEY_TOLERANCE) return;
    entries.push({
      accountCode: code,
      accountName: PAYROLL_ACCRUAL_ACCOUNT_NAMES[code],
      debit: 0,
      credit: amount,
    });
  };
  addCredit(PAYROLL_ACCRUAL_ACCOUNTS.netSalaries, sumNet);
  addCredit(PAYROLL_ACCRUAL_ACCOUNTS.socialInsurance, sumInsurance);
  addCredit(PAYROLL_ACCRUAL_ACCOUNTS.incomeTax, sumTax);
  addCredit(PAYROLL_ACCRUAL_ACCOUNTS.advances, sumAdvances);
  addCredit(PAYROLL_ACCRUAL_ACCOUNTS.otherWithheld, sumOtherDeductions);
  return entries;
}
