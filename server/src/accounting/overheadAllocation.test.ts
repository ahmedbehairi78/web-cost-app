import { describe, expect, it } from 'vitest';
import {
  buildJournalPreviews,
  centerOhaReference,
  distributePoolAmounts,
  resolveOverheadCloseJournalDate,
  snapshotClosedLinesAsProposed,
  validateProposedLinesAgainstPools,
  type OverheadPoolRow,
  type OverheadPreviewLine,
} from '../accounting/overheadAllocation.js';

describe('overheadAllocation distributePoolAmounts', () => {
  it('allocates pool by weights with remainder on last contract', () => {
    const weights = [
      { contractId: 'c1', contractName: 'A', contractNumber: '1', weight: 600, ratio: 60 },
      { contractId: 'c2', contractName: 'B', contractNumber: '2', weight: 400, ratio: 40 },
    ];
    const amounts = distributePoolAmounts(1000, weights);
    expect(amounts.get('c1')).toBe(600);
    expect(amounts.get('c2')).toBe(400);
    expect([...amounts.values()].reduce((s, v) => s + v, 0)).toBe(1000);
  });

  it('allocates equally when all weights are 1', () => {
    const weights = [
      { contractId: 'c1', contractName: 'A', contractNumber: '1', weight: 1, ratio: 33.3 },
      { contractId: 'c2', contractName: 'B', contractNumber: '2', weight: 1, ratio: 33.3 },
      { contractId: 'c3', contractName: 'C', contractNumber: '3', weight: 1, ratio: 33.3 },
    ];
    const amounts = distributePoolAmounts(9000, weights);
    expect(amounts.get('c1')).toBe(3000);
    expect(amounts.get('c2')).toBe(3000);
    expect(amounts.get('c3')).toBe(3000);
  });

  it('allocates indivisible pool across three equal contracts without drift', () => {
    const weights = [
      { contractId: 'c1', contractName: 'A', contractNumber: '1', weight: 1, ratio: 33 },
      { contractId: 'c2', contractName: 'B', contractNumber: '2', weight: 1, ratio: 33 },
      { contractId: 'c3', contractName: 'C', contractNumber: '3', weight: 1, ratio: 34 },
    ];
    const amounts = distributePoolAmounts(10_001, weights);
    expect([...amounts.values()].reduce((s, v) => s + v, 0)).toBe(10_001);
  });
});

describe('validateProposedLinesAgainstPools', () => {
  const pools = [
    {
      indirectCenterId: 'ho1',
      indirectCenterCode: 'HO-001',
      indirectCenterName: 'Office',
      accountCode: '52101001',
      accountName: 'Admin',
      poolAmount: 1000,
    },
  ];

  it('accepts lines that sum exactly to pool amount', () => {
    const result = validateProposedLinesAgainstPools(pools, [
      { indirectCenterId: 'ho1', contractId: 'c1', accountCode: '52101001', amount: 600 },
      { indirectCenterId: 'ho1', contractId: 'c2', accountCode: '52101001', amount: 400 },
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects when allocated total differs from pool', () => {
    const result = validateProposedLinesAgainstPools(pools, [
      { indirectCenterId: 'ho1', contractId: 'c1', accountCode: '52101001', amount: 500 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('52101001');
  });

  it('rejects unknown pool key', () => {
    const result = validateProposedLinesAgainstPools(pools, [
      { indirectCenterId: 'ho2', contractId: 'c1', accountCode: '52101001', amount: 1000 },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe('resolveOverheadCloseJournalDate', () => {
  it('clamps early close into the period (not periodEnd in the future)', () => {
    expect(resolveOverheadCloseJournalDate('2026-07-01', '2026-09-30', '2026-07-31')).toBe(
      '2026-07-31',
    );
    expect(resolveOverheadCloseJournalDate('2026-04-01', '2026-06-30', '2026-07-15')).toBe(
      '2026-06-30',
    );
    expect(resolveOverheadCloseJournalDate('2026-07-01', '2026-09-30', '2026-06-15')).toBe(
      '2026-07-01',
    );
  });
});

describe('consolidated OHA journal per center', () => {
  it('uses one reference per indirect center (not per expense account)', () => {
    expect(centerOhaReference('Q2-2026', 'HO-001')).toBe('OHA-Q2-2026-HO-001');
  });

  it('buildJournalPreviews merges pools on one center into a single entry', () => {
    const pools: OverheadPoolRow[] = [
      {
        indirectCenterId: 'ho1',
        indirectCenterCode: 'HO-001',
        indirectCenterName: 'HQ',
        accountCode: '52102001',
        accountName: 'Rent',
        poolAmount: 25000,
      },
      {
        indirectCenterId: 'ho1',
        indirectCenterCode: 'HO-001',
        indirectCenterName: 'HQ',
        accountCode: '52103001',
        accountName: 'Electricity',
        poolAmount: 6000,
      },
    ];
    const lines: OverheadPreviewLine[] = [
      {
        indirectCenterId: 'ho1',
        indirectCenterCode: 'HO-001',
        accountCode: '52102001',
        contractId: 'c1',
        contractName: 'A',
        contractNumber: '1',
        weight: 1,
        ratio: 50,
        amount: 12500,
        revenue: 1,
      },
      {
        indirectCenterId: 'ho1',
        indirectCenterCode: 'HO-001',
        accountCode: '52102001',
        contractId: 'c2',
        contractName: 'B',
        contractNumber: '2',
        weight: 1,
        ratio: 50,
        amount: 12500,
        revenue: 1,
      },
      {
        indirectCenterId: 'ho1',
        indirectCenterCode: 'HO-001',
        accountCode: '52103001',
        contractId: 'c1',
        contractName: 'A',
        contractNumber: '1',
        weight: 1,
        ratio: 50,
        amount: 3000,
        revenue: 1,
      },
      {
        indirectCenterId: 'ho1',
        indirectCenterCode: 'HO-001',
        accountCode: '52103001',
        contractId: 'c2',
        contractName: 'B',
        contractNumber: '2',
        weight: 1,
        ratio: 50,
        amount: 3000,
        revenue: 1,
      },
    ];
    const previews = buildJournalPreviews('Q2-2026', pools, lines, new Map([
      ['c1', { name: 'A', number: '1' }],
      ['c2', { name: 'B', number: '2' }],
    ]));
    expect(previews).toHaveLength(1);
    expect(previews[0]!.reference).toBe('OHA-Q2-2026-HO-001');
    expect(previews[0]!.poolAmount).toBe(31000);
    expect(previews[0]!.poolAccounts).toHaveLength(2);
    const debits = previews[0]!.entries.filter((e) => e.side === 'debit');
    const credits = previews[0]!.entries.filter((e) => e.side === 'credit');
    expect(debits).toHaveLength(2);
    expect(credits).toHaveLength(2);
    expect(debits.every((e) => e.accountCode === '51201001')).toBe(true);
    expect(debits.every((e) => e.accountName === 'توزيع مصروفات (HQ)')).toBe(true);
    expect(debits.reduce((s, e) => s + e.amount, 0)).toBe(31000);
  });
});

describe('snapshotClosedLinesAsProposed (reopen preserves distribution)', () => {
  it('keeps posted closed amounts and drops draft-only rows', () => {
    const proposed = snapshotClosedLinesAsProposed([
      {
        transactionId: 'tx-oha-1',
        indirectCenterId: 'ho1',
        contractId: 'c1',
        accountCode: '52101001',
        amount: 600,
      },
      {
        transactionId: 'tx-oha-1',
        indirectCenterId: 'ho1',
        contractId: 'c2',
        accountCode: '52101001',
        amount: 400,
      },
      {
        transactionId: null,
        indirectCenterId: 'ho1',
        contractId: 'c1',
        accountCode: '52101001',
        amount: 999,
      },
    ]);
    expect(proposed).toHaveLength(2);
    expect(proposed.find((l) => l.contractId === 'c1')?.amount).toBe(600);
    expect(proposed.find((l) => l.contractId === 'c2')?.amount).toBe(400);
  });

  it('merges duplicate posted keys and still validates against the same pool', () => {
    const proposed = snapshotClosedLinesAsProposed([
      {
        transactionId: 'tx-a',
        indirectCenterId: 'ho1',
        contractId: 'c1',
        accountCode: '52101001',
        amount: 250,
      },
      {
        transactionId: 'tx-a',
        indirectCenterId: 'ho1',
        contractId: 'c1',
        accountCode: '52101001',
        amount: 350,
      },
      {
        transactionId: 'tx-a',
        indirectCenterId: 'ho1',
        contractId: 'c2',
        accountCode: '52101001',
        amount: 400,
      },
    ]);
    expect(proposed.find((l) => l.contractId === 'c1')?.amount).toBe(600);
    const pools: OverheadPoolRow[] = [
      {
        indirectCenterId: 'ho1',
        indirectCenterCode: 'HO-001',
        indirectCenterName: 'Office',
        accountCode: '52101001',
        accountName: 'Admin',
        poolAmount: 1000,
      },
    ];
    expect(validateProposedLinesAgainstPools(pools, proposed).ok).toBe(true);
  });
});
