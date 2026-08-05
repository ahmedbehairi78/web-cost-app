import { createTransaction } from './journal.js';
import type { JournalEntryInput } from './journalShared.js';
import type { Prisma } from '@prisma/client';
import { roundMoney } from '../lib/money.js';
import type { WarehouseAccountRef } from './projectWarehouseGl.js';

export function buildWarehouseReceiptEntries(params: {
  totalAmount: number;
  warehouse: WarehouseAccountRef;
  supplierAccountCode: string;
  supplierAccountName: string;
}): JournalEntryInput[] {
  const amount = roundMoney(params.totalAmount);
  if (amount <= 0) {
    throw new Error('Warehouse receipt total must be greater than zero');
  }
  const supplierCode = String(params.supplierAccountCode || '').trim();
  if (!/^\d{8}$/.test(supplierCode)) {
    throw new Error('Supplier account must be an 8-digit leaf account');
  }
  return [
    {
      accountCode: params.warehouse.accountCode,
      accountName: params.warehouse.accountName,
      debit: amount,
      credit: 0,
    },
    {
      accountCode: supplierCode,
      accountName: params.supplierAccountName || supplierCode,
      debit: 0,
      credit: amount,
    },
  ];
}

export async function postWarehouseReceiptJournal(
  tx: Prisma.TransactionClient,
  params: {
    date: string;
    reference: string;
    projectId: string;
    projectName: string;
    supplierInvoiceRef: string;
    totalAmount: number;
    warehouse: WarehouseAccountRef;
    supplierAccountCode: string;
    supplierAccountName: string;
    userId?: string;
  },
): Promise<string> {
  const entries = buildWarehouseReceiptEntries({
    totalAmount: params.totalAmount,
    warehouse: params.warehouse,
    supplierAccountCode: params.supplierAccountCode,
    supplierAccountName: params.supplierAccountName,
  });
  const journal = await createTransaction(
    {
      date: params.date,
      description: `استلام مخزني ${params.reference} — فاتورة ${params.supplierInvoiceRef} — ${params.projectName}`,
      reference: params.reference,
      projectId: params.projectId,
      entries,
    },
    params.userId,
    tx,
  );
  return String(journal.id);
}
