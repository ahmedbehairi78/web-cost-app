import { describe, expect, it } from 'vitest';
import {
  buildGlAccountBalanceMap,
  buildGlAccountTotalsMap,
  coaIdToAccountCode,
  resolveBankGlAccountCode,
  resolveGlBalanceSide,
} from './glAccountBalance';

describe('glAccountBalance', () => {
  const sampleTxs = [
    {
      entries: [
        { accountCode: '12101001', debit: 1000, credit: 0 },
        { accountCode: '21101001', debit: 0, credit: 1000 },
      ],
    },
    {
      entries: [
        { accountCode: '12101001', debit: 0, credit: 200 },
        { accountCode: '51101001', debit: 200, credit: 0 },
      ],
    },
  ];

  it('buildGlAccountTotalsMap sums debit, credit, and net balance per account', () => {
    const map = buildGlAccountTotalsMap(sampleTxs);
    expect(map.get('12101001')).toEqual({ debit: 1000, credit: 200, balance: 800 });
    expect(map.get('21101001')).toEqual({ debit: 0, credit: 1000, balance: -1000 });
  });

  it('buildGlAccountBalanceMap matches net from totals map', () => {
    const map = buildGlAccountBalanceMap(sampleTxs);
    expect(map.get('12101001')).toBe(800);
    expect(map.get('21101001')).toBe(-1000);
  });

  it('resolveBankGlAccountCode prefers linked COA id', () => {
    const code = resolveBankGlAccountCode(
      { code: '12101001', coaAccountId: 'coa-2' },
      [
        { id: 'coa-1', accountCode: '12101001' },
        { id: 'coa-2', accountCode: '12101002' },
      ],
    );
    expect(code).toBe('12101002');
  });

  it('coaIdToAccountCode resolves chart id', () => {
    expect(
      coaIdToAccountCode('x', [{ id: 'x', accountCode: '31401001' }]),
    ).toBe('31401001');
  });

  it('resolveGlBalanceSide classifies net balance', () => {
    expect(resolveGlBalanceSide(10)).toBe('debit');
    expect(resolveGlBalanceSide(-5)).toBe('credit');
    expect(resolveGlBalanceSide(0)).toBe('zero');
  });
});
