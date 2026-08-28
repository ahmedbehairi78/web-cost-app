import { describe, expect, it } from 'vitest';
import { assertBalanced } from './journalShared.js';
import { AccountCodes } from './accountCodes.js';
import { roundMoney } from '../lib/money.js';
import { buildServiceIpcEntries } from './serviceIpcJournal.js';

describe('buildServiceIpcEntries', () => {
  it('splits labour expense by cost center and keeps Dr = Cr', () => {
    const entries = buildServiceIpcEntries({
      serviceKind: 'labour',
      supplierName: 'عمال النيل',
      supplierAccountCode: '21102005',
      lines: [
        { contractId: 'c1', description: 'عامل', unit: 'يوم', rate: 100, previousQty: 10, currentQty: 5 },
        { contractId: 'c2', description: 'عامل', unit: 'يوم', rate: 100, previousQty: 0, currentQty: 3 },
      ],
      vatAmount: 112,
      execGuarantee: 40,
      whtAmount: 8,
      labourInsurance: 40,
      manpowerLevy: 8,
      advancePaymentRecovery: 0,
    });
    expect(() => assertBalanced(entries)).not.toThrow();
    const labour = entries.filter((e) => e.accountCode === AccountCodes.EXPENSE_LABOUR);
    expect(labour).toHaveLength(2);
    expect(labour.map((e) => e.costCenterId).sort()).toEqual(['c1', 'c2']);
    expect(roundMoney(labour.reduce((s, e) => s + e.debit, 0))).toBe(912);
    const supplier = entries.find((e) => e.accountCode === '21102005');
    expect(supplier?.credit).toBe(816);
  });

  it('uses equipment expense for vehicles and equipment kinds', () => {
    const eq = buildServiceIpcEntries({
      serviceKind: 'equipment',
      supplierName: 'كرين',
      lines: [{ contractId: 'c1', description: 'ونش', unit: 'يوم', rate: 1000, previousQty: 0, currentQty: 1 }],
      vatAmount: 0,
      execGuarantee: 0,
      whtAmount: 0,
      labourInsurance: 0,
      manpowerLevy: 0,
      advancePaymentRecovery: 0,
    });
    expect(eq.some((e) => e.accountCode === AccountCodes.EXPENSE_EQUIPMENT && e.debit === 1000)).toBe(true);

    const veh = buildServiceIpcEntries({
      serviceKind: 'vehicles',
      supplierName: 'نقل',
      lines: [{ contractId: 'c1', description: 'سيارة', unit: 'يوم', rate: 200, previousQty: 0, currentQty: 2 }],
      vatAmount: 0,
      execGuarantee: 0,
      whtAmount: 0,
      labourInsurance: 0,
      manpowerLevy: 0,
      advancePaymentRecovery: 0,
    });
    expect(veh.some((e) => e.accountCode === AccountCodes.EXPENSE_EQUIPMENT && e.debit === 400)).toBe(true);
  });

  it('posts housing to subcontractor expense 51103', () => {
    const entries = buildServiceIpcEntries({
      serviceKind: 'housing',
      supplierName: 'سكن',
      lines: [{ contractId: 'c1', description: 'غرفة', unit: 'شهر', rate: 500, previousQty: 0, currentQty: 1 }],
      vatAmount: 0,
      execGuarantee: 0,
      whtAmount: 0,
      labourInsurance: 0,
      manpowerLevy: 0,
      advancePaymentRecovery: 0,
    });
    expect(entries.some((e) => e.accountCode === AccountCodes.EXPENSE_SUBCONTRACTOR && e.debit === 500)).toBe(true);
  });
});
