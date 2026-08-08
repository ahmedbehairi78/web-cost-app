import type { Prisma } from '@prisma/client';
import { buildIpcEntries, createTransaction, updateTransaction } from '../accounting/journal.js';
import { assertTransactionPeriodUnlocked } from '../accounting/periodLock.js';

type TxClient = Prisma.TransactionClient;

export type BillingWriteBody = Record<string, unknown>;

export function mapBillingItems(items: Record<string, unknown>[]) {
  return items.map((item) => ({
    boqItemId: (item.boqItemId as string | undefined) ?? null,
    itemCode: String(item.itemCode ?? ''),
    description: String(item.description ?? ''),
    unit: String(item.unit ?? ''),
    rate: Number(item.rate || 0),
    previousQty: Number(item.previousQty || 0),
    currentQty: Number(item.currentQty || 0),
    totalQty: Number(item.totalQty || 0),
    amount: Number(item.amount || 0),
    metadata: item as Prisma.InputJsonValue,
  }));
}

export async function syncBillingJournal(
  tx: TxClient,
  body: BillingWriteBody,
  contractName: string,
  userId: string | undefined,
  existingTransactionId: string | null | undefined,
): Promise<string | null> {
  const status = String(body.status || 'submitted');

  if (status === 'draft') {
    if (existingTransactionId) {
      await assertTransactionPeriodUnlocked(tx, existingTransactionId, userId);
      await tx.transaction.update({
        where: { id: existingTransactionId },
        data: { isDeleted: true },
      });
    }
    return null;
  }

  if (status === 'paid') {
    return existingTransactionId ?? null;
  }

  // GL posts only when IPC is approved (submitted/review hold data only).
  if (status !== 'approved') {
    if (existingTransactionId) {
      await assertTransactionPeriodUnlocked(tx, existingTransactionId, userId);
      await tx.transaction.update({
        where: { id: existingTransactionId },
        data: { isDeleted: true },
      });
    }
    return null;
  }

  const entries = buildIpcEntries({
    worksValue: Number(body.worksValueExVat || 0),
    vatAmount: Number(body.vatAmount || 0),
    netPayable: Number(body.netPayable || 0),
    execGuarantee: Number(body.execGuaranteeAmount || 0),
    whtAmount: Number(body.whtAmount || 0),
    labourInsurance: Number(body.labourInsuranceAmount || 0),
    manpowerLevy: Number(body.manpowerLevyAmount || 0),
    advancePaymentRecovery: Number(body.advancePaymentRecovery || 0),
    contractName,
  });

  const journalInput = {
    date: String(body.date),
    description: String(body.description || `IPC No ${body.billingNumber}`),
    reference: `IPC-${String(body.billingNumber ?? '')}`,
    projectId: body.projectId as string | undefined,
    costCenterId: body.contractId as string | undefined,
    entries,
  };

  const presetId =
    existingTransactionId ??
    (body.transactionId != null && String(body.transactionId).trim() !== ''
      ? String(body.transactionId).trim()
      : null);

  if (presetId) {
    await updateTransaction({ ...journalInput, id: presetId }, userId, tx);
    return presetId;
  }

  const journal = await createTransaction(journalInput, userId, tx);
  return journal.id;
}
