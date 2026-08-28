import { describe, expect, it } from 'vitest';
import { AccountCodes } from './accountCodes.js';
import {
  buildOpeningCreditorsEntries,
  buildOpeningCreditorsReference,
  nextPayableLeafCode,
} from './openingCreditorsJournal.js';

describe('nextPayableLeafCode', () => {
  it('increments past the generic 21101001 leaf', () => {
    expect(nextPayableLeafCode(['21101001'], '21101')).toBe('21101002');
  });

  it('starts at 002 when the branch has no leaves yet', () => {
    expect(nextPayableLeafCode([], '21102')).toBe('21102002');
  });
});

describe('buildOpeningCreditorsEntries', () => {
  it('debits partners current and credits each payable leaf', () => {
    const entries = buildOpeningCreditorsEntries([
      { accountCode: '21101002', accountName: 'Steel Co', amount: 100 },
      { accountCode: '21102002', accountName: 'Finishing', amount: 50.255 },
    ]);
    expect(entries[0]).toMatchObject({
      accountCode: AccountCodes.PARTNERS_CURRENT,
      debit: 150.26,
      credit: 0,
    });
    expect(entries[1]).toMatchObject({ accountCode: '21101002', credit: 100, debit: 0 });
    expect(entries[2]).toMatchObject({ accountCode: '21102002', credit: 50.26, debit: 0 });
  });

  it('treats a negative amount as a debit (advance)', () => {
    const entries = buildOpeningCreditorsEntries([
      { accountCode: '21101002', accountName: 'Steel Co', amount: -40 },
    ]);
    expect(entries[0]).toMatchObject({
      accountCode: AccountCodes.PARTNERS_CURRENT,
      debit: 0,
      credit: 40,
    });
    expect(entries[1]).toMatchObject({ accountCode: '21101002', debit: 40, credit: 0 });
  });
});

describe('buildOpeningCreditorsReference', () => {
  it('uses AP-OPEN prefix', () => {
    const ref = buildOpeningCreditorsReference(new Date('2026-08-24T12:34:56'));
    expect(ref).toMatch(/^AP-OPEN-20260824-123456$/);
  });
});
