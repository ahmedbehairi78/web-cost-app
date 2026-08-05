import { AccountCodes } from './accountCodes.js';
import type { JournalEntryInput } from './journalShared.js';
import { toMoney } from '../modules/inventoryHelpers.js';

export function buildConsumptionIssueEntries(params: {
  /** Fallback when a line omits expenseAccountCode (legacy header). */
  expenseAccountCode?: string | null;
  expenseAccountName?: string | null;
  inventoryAccountCode: string;
  inventoryAccountName: string;
  lines: Array<{
    totalCost: number;
    boqItemCode?: string | null;
    boqDescription?: string | null;
    expenseAccountCode?: string | null;
    expenseAccountName?: string | null;
  }>;
}): JournalEntryInput[] {
  const headerExpenseCode =
    String(params.expenseAccountCode || '').trim() || AccountCodes.EXPENSE_MATERIALS;
  const headerExpenseName = String(params.expenseAccountName || '').trim() || 'مواد البناء';

  const debitLines = params.lines
    .filter((line) => toMoney(Number(line.totalCost)) > 0)
    .map((line) => {
      const expenseCode =
        String(line.expenseAccountCode || '').trim() || headerExpenseCode;
      const expenseBaseName =
        String(line.expenseAccountName || '').trim() ||
        (expenseCode === headerExpenseCode ? headerExpenseName : expenseCode);
      const label = String(line.boqItemCode || line.boqDescription || '').trim();
      const suffix = label ? ` — ${label}` : '';
      return {
        accountCode: expenseCode,
        accountName: `${expenseBaseName}${suffix}`,
        debit: toMoney(Number(line.totalCost)),
        credit: 0,
      };
    });

  const totalCost = toMoney(debitLines.reduce((sum, line) => sum + line.debit, 0));
  if (totalCost <= 0) {
    throw new Error('Consumption order has no cost to post to the general ledger');
  }

  return [
    ...debitLines,
    {
      accountCode: params.inventoryAccountCode,
      accountName: params.inventoryAccountName,
      debit: 0,
      credit: totalCost,
    },
  ];
}
