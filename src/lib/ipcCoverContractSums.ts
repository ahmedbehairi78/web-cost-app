/**
 * Cover-JLL contract-sum helpers (Original / Provisional / VO / Adjusted).
 */
import { roundMoney } from './money';
import type { VariationOrder } from '../types';

export type IpcCoverContractSums = {
  originalContractSum: number;
  provisionalSums: number;
  approvedVoAdditions: number;
  approvedVoOmissions: number;
  adjustedContractSum: number;
  /** Certificate of Approval / Instruction values — often equals provisional in sample. */
  totalCaiValues: number;
};

export function sumApprovedVoAdditionsOmissions(
  orders: Array<Pick<VariationOrder, 'status' | 'totalValue' | 'lines'>>,
): { additions: number; omissions: number } {
  let additions = 0;
  let omissions = 0;
  for (const order of orders) {
    if (order.status && order.status !== 'approved') continue;
    const lines = order.lines ?? [];
    if (lines.length > 0) {
      for (const line of lines) {
        const amt = Number(line.lineAmount || 0);
        if (amt > 0) additions = roundMoney(additions + amt);
        else if (amt < 0) omissions = roundMoney(omissions + Math.abs(amt));
      }
    } else {
      const tv = Number(order.totalValue || 0);
      if (tv > 0) additions = roundMoney(additions + tv);
      else if (tv < 0) omissions = roundMoney(omissions + Math.abs(tv));
    }
  }
  return { additions, omissions };
}

export function buildIpcCoverContractSums(input: {
  originalContractSum?: number | null;
  provisionalSums?: number | null;
  approvedVos?: Array<Pick<VariationOrder, 'status' | 'totalValue' | 'lines'>>;
}): IpcCoverContractSums {
  const original = roundMoney(Number(input.originalContractSum || 0));
  const provisional = roundMoney(Number(input.provisionalSums || 0));
  const { additions, omissions } = sumApprovedVoAdditionsOmissions(input.approvedVos ?? []);
  const adjusted = roundMoney(original + provisional + additions - omissions);
  return {
    originalContractSum: original,
    provisionalSums: provisional,
    approvedVoAdditions: additions,
    approvedVoOmissions: omissions,
    adjustedContractSum: adjusted,
    totalCaiValues: provisional,
  };
}
