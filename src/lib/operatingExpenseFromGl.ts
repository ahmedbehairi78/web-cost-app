import { AccountCodes } from '../services/accountingService';
import type { JournalEntry } from '../types';
import { resolveEntryCostCenterId } from './costCenterAttribution';

/** Direct materials expense branch (51101…) — counted via `boq_actual_costs` when local. */
export const MATERIAL_EXPENSE_PREFIX = '51101';

/** Project warehouse asset (127…) — purchase receipts, not operating expense. */
export const PROJECT_INVENTORY_PREFIX = '127';

export type OperatingExpenseMode = 'cloud' | 'local';

function normCode(code: string | undefined): string {
  return String(code ?? '').trim();
}

export function isProjectInventoryAccountCode(accountCode: string | undefined): boolean {
  const code = normCode(accountCode);
  return code.startsWith(PROJECT_INVENTORY_PREFIX) && code.length === 8;
}

export function isMaterialExpenseAccountCode(accountCode: string | undefined): boolean {
  const code = normCode(accountCode);
  return code.startsWith(MATERIAL_EXPENSE_PREFIX);
}

/** Purchase → warehouse: debit only on 127… 8-digit leaves (no class-5 expense). */
export function isWarehouseReceiptTransaction(entries: JournalEntry[] | undefined): boolean {
  if (!entries?.length) return false;
  const debits = entries.filter((e) => Number(e.debit || 0) > 0.000001);
  if (!debits.length) return false;
  return debits.every((e) => isProjectInventoryAccountCode(e.accountCode));
}

/**
 * Legacy purchase invoice GL (Dr 51101… before central warehouse).
 * Excluded in local mode — material actual comes from `boq_actual_costs`.
 */
export function isLegacyMaterialPurchaseExpenseTransaction(entries: JournalEntry[] | undefined): boolean {
  if (!entries?.length || isWarehouseReceiptTransaction(entries)) return false;
  const hasMaterialDebit = entries.some(
    (e) => isMaterialExpenseAccountCode(e.accountCode) && Number(e.debit || 0) > 0.000001
  );
  const hasInventoryDebit = entries.some(
    (e) => isProjectInventoryAccountCode(e.accountCode) && Number(e.debit || 0) > 0.000001
  );
  return hasMaterialDebit && !hasInventoryDebit;
}

export function sumEntryOperatingExpense(
  entry: JournalEntry,
  mode: OperatingExpenseMode,
  transactionCostCenterId?: string | null,
  filterCostCenterId?: string | 'all',
): number {
  if (filterCostCenterId && filterCostCenterId !== 'all') {
    const effective = resolveEntryCostCenterId(entry, transactionCostCenterId);
    if (effective !== filterCostCenterId) return 0;
  }
  const code = normCode(entry.accountCode);
  if (mode === 'local' && isMaterialExpenseAccountCode(code)) return 0;
  const isExpense =
    code.startsWith('5') || code === AccountCodes.VAT_INPUT;
  if (!isExpense) return 0;
  return Number(entry.debit || 0) - Number(entry.credit || 0);
}

export function sumTransactionOperatingExpense(
  entries: JournalEntry[] | undefined,
  mode: OperatingExpenseMode,
  options?: { transactionCostCenterId?: string | null; filterCostCenterId?: string | 'all' },
): number {
  if (!entries?.length) return 0;
  if (isWarehouseReceiptTransaction(entries)) return 0;
  if (mode === 'local' && isLegacyMaterialPurchaseExpenseTransaction(entries)) return 0;
  const filter = options?.filterCostCenterId ?? 'all';
  const txCc = options?.transactionCostCenterId;
  return entries.reduce(
    (sum, e) => sum + sumEntryOperatingExpense(e, mode, txCc, filter),
    0,
  );
}
