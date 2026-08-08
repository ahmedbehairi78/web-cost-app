import { describe, expect, it } from 'vitest';
import { assertBalanced, buildIpcEntries } from './journalShared.js';
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
});
