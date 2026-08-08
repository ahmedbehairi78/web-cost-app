import { describe, expect, it } from 'vitest';
import { AccountCodes } from '../accounting/accountCodes.js';
import { MONEY_TOLERANCE, roundMoney } from './money.js';
import {
  buildPayrollAccrualEntries,
  findPayrollLinesMissingCostCenter,
} from './payrollAccrualJournal.js';

describe('buildPayrollAccrualEntries', () => {
  it('reduces expense by penalties and omits penalties liability; net matches sheet', () => {
    const gross = 10_000;
    const si = 1_100;
    const tax = 200;
    const advances = 500;
    const penalties = 300;
    const net = roundMoney(gross - si - tax - advances - penalties);

    const entries = buildPayrollAccrualEntries([
      {
        expenseAccountCode: AccountCodes.EXPENSE_ADMIN,
        grossSalary: gross,
        socialInsurance: si,
        incomeTax: tax,
        advances,
        penalties,
        otherDeductions: 0,
        netSalary: net,
      },
    ]);

    const debit = entries.filter((e) => e.debit > 0).reduce((s, e) => s + e.debit, 0);
    const credit = entries.filter((e) => e.credit > 0).reduce((s, e) => s + e.credit, 0);
    expect(Math.abs(debit - credit)).toBeLessThanOrEqual(MONEY_TOLERANCE);

    expect(debit).toBe(roundMoney(gross - penalties));
    expect(entries.some((e) => e.accountCode === AccountCodes.PAYROLL_PENALTIES_WITHHELD)).toBe(false);

    const netCr = entries.find((e) => e.accountCode === AccountCodes.SALARIES_PAYABLE);
    expect(netCr?.credit).toBe(net);
  });

  it('still credits otherDeductions on the withheld clearing account', () => {
    const entries = buildPayrollAccrualEntries([
      {
        expenseAccountCode: AccountCodes.EXPENSE_ADMIN,
        grossSalary: 5_000,
        socialInsurance: 0,
        incomeTax: 0,
        advances: 0,
        penalties: 100,
        otherDeductions: 50,
        netSalary: 4_850,
      },
    ]);
    const other = entries.find((e) => e.accountCode === AccountCodes.PAYROLL_PENALTIES_WITHHELD);
    expect(other?.credit).toBe(50);
    const dr = entries.find((e) => e.debit > 0);
    expect(dr?.debit).toBe(4_900); // 5000 - 100 penalties
  });

  it('fills debit expense accountName from COA or defaults', () => {
    const withExplicit = buildPayrollAccrualEntries([
      {
        expenseAccountCode: AccountCodes.EXPENSE_LABOUR,
        expenseAccountName: 'عمالة موقع أ',
        grossSalary: 1_000,
        socialInsurance: 0,
        incomeTax: 0,
        advances: 0,
        penalties: 0,
        otherDeductions: 0,
        netSalary: 1_000,
      },
    ]);
    expect(withExplicit.find((e) => e.debit > 0)?.accountName).toBe('عمالة موقع أ');

    const fromCoa = buildPayrollAccrualEntries(
      [
        {
          expenseAccountCode: '52102999',
          expenseAccountName: null,
          grossSalary: 1_000,
          socialInsurance: 0,
          incomeTax: 0,
          advances: 0,
          penalties: 0,
          otherDeductions: 0,
          netSalary: 1_000,
        },
      ],
      new Map([['52102999', 'رواتب قسم خاص']]),
    );
    expect(fromCoa.find((e) => e.debit > 0)?.accountName).toBe('رواتب قسم خاص');

    const fallback = buildPayrollAccrualEntries([
      {
        expenseAccountCode: AccountCodes.EXPENSE_ADMIN,
        expenseAccountName: '',
        grossSalary: 1_000,
        socialInsurance: 0,
        incomeTax: 0,
        advances: 0,
        penalties: 0,
        otherDeductions: 0,
        netSalary: 1_000,
      },
    ]);
    expect(fallback.find((e) => e.debit > 0)?.accountName).toBe('رواتب وأجور إدارية');
  });
});

describe('findPayrollLinesMissingCostCenter', () => {
  it('flags lines without header or allocation cost center', () => {
    const missing = findPayrollLinesMissingCostCenter([
      { employeeCode: 'A1', costCenterId: 'cc1' },
      { employeeCode: 'A2', costCenterId: null, allocations: [] },
      { employeeCode: 'A3', costCenterId: '', allocations: [{ costCenterId: 'cc2', percentage: 100 }] },
    ]);
    expect(missing).toEqual(['A2']);
  });
});
