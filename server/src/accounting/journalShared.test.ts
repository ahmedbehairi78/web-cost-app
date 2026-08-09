import { describe, expect, it } from 'vitest';
import { assertBalanced, buildIpcEntries } from './journalShared.js';
import { AccountCodes } from './accountCodes.js';
import { roundMoney } from '../lib/money.js';

describe('buildIpcEntries', () => {
  it('balances after 2dp rounding (production IPC-1 regression)', () => {
    const entries = buildIpcEntries({
      worksValue: 65204.1,
      vatAmount: 9128.574,
      netPayable: 63880.457,
      execGuarantee: 6520.41,
      whtAmount: 652.041,
      labourInsurance: 3260.205,
      manpowerLevy: 19.561,
      advancePaymentRecovery: 0,
      contractName: 'test',
    });
    expect(() => assertBalanced(entries)).not.toThrow();
    const debit = entries.reduce((s, e) => s + e.debit, 0);
    const credit = entries.reduce((s, e) => s + e.credit, 0);
    expect(roundMoney(debit - credit)).toBe(0);
  });

  it('omits zero-amount deduction lines', () => {
    const entries = buildIpcEntries({
      worksValue: 100,
      vatAmount: 14,
      netPayable: 114,
      execGuarantee: 0,
      whtAmount: 0,
      labourInsurance: 0,
      manpowerLevy: 0,
      advancePaymentRecovery: 0,
      contractName: 'x',
    });
    expect(entries.every((e) => e.debit > 0 || e.credit > 0)).toBe(true);
    expect(entries).toHaveLength(3); // receivables + revenue + vat
  });

  it('includes Cover-JLL deductions and stays balanced', () => {
    const entries = buildIpcEntries({
      worksValue: 100_000,
      vatAmount: 14_000,
      netPayable: 0,
      execGuarantee: 5_000,
      performanceSecurity: 5_000,
      whtAmount: 1_000,
      labourInsurance: 5_000,
      manpowerLevy: 1_000,
      syndicateStamp: 300,
      backCharge: 500,
      advancePaymentRecovery: 2_000,
      contractName: 'Cover',
    });
    expect(() => assertBalanced(entries)).not.toThrow();
    const codes = entries.map((e) => e.accountCode);
    expect(codes).toContain(AccountCodes.PERFORMANCE_SECURITY_RECEIVABLE);
    expect(codes).toContain(AccountCodes.SYNDICATE_STAMP_RECEIVABLE);
    expect(codes).toContain(AccountCodes.BACK_CHARGE_RECEIVABLE);
    expect(codes).toContain(AccountCodes.ADVANCE_PAYMENT);
    const netLine = entries.find((e) => e.accountCode === AccountCodes.RECEIVABLES);
    // 114000 - (5000+5000+1000+5000+1000+300+500+2000) = 94200
    expect(netLine?.debit).toBe(94_200);
  });
});
