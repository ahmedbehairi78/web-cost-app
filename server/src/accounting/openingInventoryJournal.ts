import { AccountCodes } from './accountCodes.js';
import { createTransaction } from './journal.js';
import type { JournalEntryInput } from './journalShared.js';
import type { Prisma } from '@prisma/client';
import { roundMoney } from '../lib/money.js';
import type { WarehouseAccountRef } from './projectWarehouseGl.js';

export const PARTNERS_CURRENT_NAME = 'جاري الشركاء';
export const PARTNERS_CURRENT_NAME_EN = 'Partner Current Account';

export function buildOpeningInventoryEntries(
  totalAmount: number,
  warehouse: WarehouseAccountRef,
  partnersAccountName: string = PARTNERS_CURRENT_NAME,
): JournalEntryInput[] {
  const amount = roundMoney(totalAmount);
  if (amount <= 0) {
    throw new Error('Opening inventory total must be greater than zero');
  }
  return [
    {
      accountCode: warehouse.accountCode,
      accountName: warehouse.accountName,
      debit: amount,
      credit: 0,
    },
    {
      accountCode: AccountCodes.PARTNERS_CURRENT,
      accountName: partnersAccountName,
      debit: 0,
      credit: amount,
    },
  ];
}

export function buildOpeningInventoryReference(projectCode: string, when = new Date()): string {
  const code = String(projectCode || 'PRJ').trim().replace(/\s+/g, '-') || 'PRJ';
  const y = when.getFullYear();
  const m = String(when.getMonth() + 1).padStart(2, '0');
  const d = String(when.getDate()).padStart(2, '0');
  const hh = String(when.getHours()).padStart(2, '0');
  const mm = String(when.getMinutes()).padStart(2, '0');
  const ss = String(when.getSeconds()).padStart(2, '0');
  return `INV-OPEN-${code}-${y}${m}${d}-${hh}${mm}${ss}`;
}

export async function postOpeningInventoryJournal(
  tx: Prisma.TransactionClient,
  params: {
    date: string;
    reference: string;
    projectId: string;
    projectName: string;
    totalAmount: number;
    warehouse: WarehouseAccountRef;
    userId?: string;
  },
): Promise<string> {
  const entries = buildOpeningInventoryEntries(params.totalAmount, params.warehouse);
  const journal = await createTransaction(
    {
      date: params.date,
      description: `رصيد مخزون افتتاحي — ${params.projectName}`,
      reference: params.reference,
      projectId: params.projectId,
      entries,
    },
    params.userId,
    tx,
  );
  return String(journal.id);
}
