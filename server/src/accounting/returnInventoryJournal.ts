import { AccountCodes } from './accountCodes.js';
import type { JournalEntryInput } from './journalShared.js';
import { roundMoney } from '../lib/money.js';

export type ReturnExpenseGroup = {
  expenseAccountCode: string;
  expenseAccountName: string;
  totalCost: number;
};

/**
 * Return to warehouse: Dr 127… for full amount · Cr expense account(s) grouped by code.
 */
export function buildReturnToWarehouseEntries(params: {
  inventoryAccountCode: string;
  inventoryAccountName: string;
  expenseGroups: ReturnExpenseGroup[];
}): JournalEntryInput[] {
  const groups = params.expenseGroups
    .map((g) => ({
      expenseAccountCode: String(g.expenseAccountCode || '').trim() || AccountCodes.EXPENSE_MATERIALS,
      expenseAccountName: String(g.expenseAccountName || '').trim() || 'مواد البناء',
      totalCost: roundMoney(Number(g.totalCost) || 0),
    }))
    .filter((g) => g.totalCost > 0);

  if (groups.length === 0) {
    throw new Error('Return order has no cost to post to the general ledger');
  }

  // Merge duplicate expense codes
  const merged = new Map<string, ReturnExpenseGroup>();
  for (const g of groups) {
    const prev = merged.get(g.expenseAccountCode);
    if (prev) {
      prev.totalCost = roundMoney(prev.totalCost + g.totalCost);
    } else {
      merged.set(g.expenseAccountCode, { ...g });
    }
  }
  const creditLines = [...merged.values()];
  const total = roundMoney(creditLines.reduce((s, g) => s + g.totalCost, 0));

  return [
    {
      accountCode: params.inventoryAccountCode,
      accountName: params.inventoryAccountName,
      debit: total,
      credit: 0,
    },
    ...creditLines.map((g) => ({
      accountCode: g.expenseAccountCode,
      accountName: g.expenseAccountName,
      debit: 0,
      credit: g.totalCost,
    })),
  ];
}
