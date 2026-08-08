import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { buildIpcEntries } from '../accounting/journal.js';
import { syncBillingJournal, type BillingWriteBody } from '../modules/billingHelpers.js';
import { syncBillingRegistry } from './documentRegistrySync.js';
import { assertIpcBoqQuantitiesForApprove, assertIpcMosBillingConsistency, validateIpcBoqQuantities, validateIpcMosBillingConsistency } from './ipcBoqValidation.js';

function billingToWriteBody(row: {
  projectId: string;
  contractId: string;
  billingNumber: string;
  date: string;
  worksValueExVat: unknown;
  vatAmount: unknown;
  execGuaranteeAmount: unknown;
  whtAmount: unknown;
  labourInsuranceAmount: unknown;
  manpowerLevyAmount: unknown;
  advancePaymentRecovery: unknown;
  netPayable: unknown;
  description?: string | null;
}): BillingWriteBody {
  return {
    projectId: row.projectId,
    contractId: row.contractId,
    billingNumber: row.billingNumber,
    date: row.date,
    worksValueExVat: Number(row.worksValueExVat),
    vatAmount: Number(row.vatAmount),
    execGuaranteeAmount: Number(row.execGuaranteeAmount),
    whtAmount: Number(row.whtAmount),
    labourInsuranceAmount: Number(row.labourInsuranceAmount),
    manpowerLevyAmount: Number(row.manpowerLevyAmount),
    advancePaymentRecovery: Number(row.advancePaymentRecovery),
    netPayable: Number(row.netPayable),
    status: 'approved',
    description: row.description ?? `IPC No ${row.billingNumber}`,
  };
}

export function buildBillingIpcPreviewEntries(
  row: Parameters<typeof billingToWriteBody>[0],
  contractName: string,
) {
  return buildIpcEntries({
    worksValue: Number(row.worksValueExVat),
    vatAmount: Number(row.vatAmount),
    netPayable: Number(row.netPayable),
    execGuarantee: Number(row.execGuaranteeAmount),
    whtAmount: Number(row.whtAmount),
    labourInsurance: Number(row.labourInsuranceAmount),
    manpowerLevy: Number(row.manpowerLevyAmount),
    advancePaymentRecovery: Number(row.advancePaymentRecovery),
    contractName,
  });
}

export async function approveBillingIpc(
  billingId: string,
  userId: string | undefined,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const run = async (client: Prisma.TransactionClient) => {
    const row = await client.billing.findUnique({
      where: { id: billingId },
      include: { items: true },
    });
    if (!row || row.isDeleted) throw new Error('Not found');
    if (row.status !== 'review' && row.status !== 'submitted') {
      throw new Error(`Cannot approve IPC in status: ${row.status}`);
    }
    if (row.transactionId) throw new Error('Journal already posted');

    const contract = await client.contract.findUnique({
      where: { id: row.contractId },
      select: { contractName: true },
    });
    if (!contract) throw new Error('Contract not found');

    const exceedRows = await validateIpcBoqQuantities(client, row.contractId, row.items);
    assertIpcBoqQuantitiesForApprove(exceedRows);

    const mosIssues = await validateIpcMosBillingConsistency(client, row.contractId, billingId, row.items);
    assertIpcMosBillingConsistency(mosIssues);

    const body = billingToWriteBody(row);
    const transactionId = await syncBillingJournal(client, body, contract.contractName, userId, null);

    await client.billing.update({
      where: { id: billingId },
      data: { status: 'approved', transactionId },
    });
  };

  if (tx) {
    await run(tx);
    return;
  }
  await prisma.$transaction(run);
  await syncBillingRegistry(billingId);
}
