import { describe, expect, it } from 'vitest';
import {
  filterEntriesForCostCenter,
  resolveEntryCostCenterId,
  transactionMatchesCostCenterFilter,
} from './costCenterAttribution';

describe('costCenterAttribution', () => {
  it('inherits header cost center when line is unset', () => {
    expect(resolveEntryCostCenterId({}, 'contract-1')).toBe('contract-1');
    expect(resolveEntryCostCenterId({ costCenterId: 'contract-2' }, 'contract-1')).toBe('contract-2');
  });

  it('matches transaction when any line targets contract', () => {
    const tx = {
      costCenterId: null,
      entries: [
        { costCenterId: 'c1', debit: 100, credit: 0 },
        { costCenterId: 'c2', debit: 50, credit: 0 },
      ],
    };
    expect(transactionMatchesCostCenterFilter(tx, 'c2')).toBe(true);
    expect(transactionMatchesCostCenterFilter(tx, 'c9')).toBe(false);
  });

  it('filters entries for contract scope', () => {
    const entries = [
      { costCenterId: 'c1', debit: 10 },
      { costCenterId: 'c2', debit: 20 },
    ];
    expect(filterEntriesForCostCenter(entries, null, 'c2')).toHaveLength(1);
    expect(filterEntriesForCostCenter(entries, null, 'all')).toHaveLength(2);
  });
});
