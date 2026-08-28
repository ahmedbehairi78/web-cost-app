import { describe, expect, it } from 'vitest';
import { buildIpcCoverContractSums, sumApprovedVoAdditionsOmissions } from './ipcCoverContractSums';

describe('sumApprovedVoAdditionsOmissions', () => {
  it('splits positive and negative line amounts from approved VOs', () => {
    const { additions, omissions } = sumApprovedVoAdditionsOmissions([
      {
        status: 'approved',
        totalValue: 100,
        lines: [
          { lineAmount: 80 } as never,
          { lineAmount: -20 } as never,
        ],
      },
      {
        status: 'draft',
        totalValue: 999,
        lines: [{ lineAmount: 999 } as never],
      },
    ]);
    expect(additions).toBe(80);
    expect(omissions).toBe(20);
  });
});

describe('buildIpcCoverContractSums', () => {
  it('computes adjusted = original + optional + provisional + additions − omissions', () => {
    const sums = buildIpcCoverContractSums({
      originalContractSum: 1000,
      optionalScopeSum: 150,
      provisionalSums: 100,
      approvedVos: [
        {
          status: 'approved',
          totalValue: 50,
          lines: [{ lineAmount: 50 } as never],
        },
      ],
    });
    expect(sums.optionalScopeSum).toBe(150);
    expect(sums.adjustedContractSum).toBe(1300);
    expect(sums.totalCaiValues).toBe(100);
  });
});
