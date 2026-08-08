import type { Transaction, JournalEntry } from '../types';
import { MONEY_TOLERANCE, roundMoney } from '../lib/money';
import { resolveEntryCostCenterId } from './costCenterAttribution';

export type CostCenterTypeMap = Map<string, 'direct' | 'indirect'>;

export type DirectIndirectCostSplit = {
  directCosts: number;
  indirectNative: number;
  indirectAllocated: number;
  totalIndirect: number;
};

const OHA_PREFIX = 'OHA-';

function isExpenseCode(code: string): boolean {
  return String(code).trim().startsWith('5');
}

function entryNetDebit(entry: JournalEntry): number {
  return (Number(entry.debit) || 0) - (Number(entry.credit) || 0);
}

/**
 * Split class-5 GL activity by cost-center type.
 * - directCosts: debits on direct (contract) centers, excluding OHA allocation journals
 * - indirectNative: net expense still on indirect service centers
 * - indirectAllocated: OHA journal debits loaded onto contracts
 */
export function computeDirectIndirectCostSplit(
  transactions: Transaction[],
  centerTypes: CostCenterTypeMap,
  options?: {
    projectId?: string;
    contractId?: string;
  },
): DirectIndirectCostSplit {
  let directCosts = 0;
  let indirectNative = 0;
  let indirectAllocated = 0;

  const projectFilter = options?.projectId && options.projectId !== 'all' ? options.projectId : null;
  const contractFilter = options?.contractId && options.contractId !== 'all' ? options.contractId : null;

  for (const tx of transactions) {
    if (tx.isDeleted) continue;
    if (projectFilter && tx.projectId && String(tx.projectId) !== projectFilter) continue;

    const ref = String(tx.reference ?? '');
    const isOha = ref.startsWith(OHA_PREFIX);

    for (const entry of tx.entries ?? []) {
      const code = String(entry.accountCode ?? '').trim();
      if (!isExpenseCode(code)) continue;

      const ccId = resolveEntryCostCenterId(entry, tx.costCenterId);
      if (contractFilter && String(ccId ?? '') !== contractFilter) continue;

      const net = entryNetDebit(entry);
      if (Math.abs(net) < MONEY_TOLERANCE) continue;

      const ccType = ccId ? centerTypes.get(String(ccId)) : undefined;

      if (isOha && ccType === 'direct' && net > 0) {
        indirectAllocated += net;
      } else if (ccType === 'indirect') {
        indirectNative += net;
      } else if (ccType === 'direct' || (!ccType && ccId)) {
        if (!isOha) directCosts += net;
      } else if (!ccId && !isOha) {
        directCosts += net;
      }
    }
  }

  return {
    directCosts: roundMoney(directCosts),
    indirectNative: roundMoney(indirectNative),
    indirectAllocated: roundMoney(indirectAllocated),
    totalIndirect: roundMoney(indirectNative + indirectAllocated),
  };
}

export function buildCostCenterTypeMap(
  rows: Array<{ id: string; type: 'direct' | 'indirect' }>,
): CostCenterTypeMap {
  return new Map(rows.map((r) => [r.id, r.type]));
}
