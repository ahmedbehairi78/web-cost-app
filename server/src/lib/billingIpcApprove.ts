import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { buildIpcEntries } from '../accounting/journal.js';
import { syncBillingJournal, type BillingWriteBody } from '../modules/billingHelpers.js';
import { syncBillingRegistry } from './documentRegistrySync.js';
import {
  assertIpcBoqQuantitiesForApprove,
  assertIpcMosBillingConsistency,
  validateIpcBoqQuantities,
  validateIpcMosBillingConsistency,
} from './ipcBoqValidation.js';
import { roundMoney } from './money.js';

/** Cover stores recovery / back-charge to date; GL posts this certificate’s increment only. */
async function priorCoverToDateAmounts(
  client: Prisma.TransactionClient,
  contractId: string,
  excludeBillingId: string,
): Promise<{ priorAdvance: number; priorBackCharge: number }> {
  const priors = await client.billing.findMany({
    where: {
      contractId,
      isDeleted: false,
      id: { not: excludeBillingId },
      status: { in: ['approved', 'paid'] },
    },
    select: { advancePaymentRecovery: true, backChargeAmount: true },
  });
  let priorAdvance = 0;
  let priorBackCharge = 0;
  for (const row of priors) {
    priorAdvance = Math.max(priorAdvance, Number(row.advancePaymentRecovery || 0));
    priorBackCharge = Math.max(priorBackCharge, Number(row.backChargeAmount || 0));
  }
  return { priorAdvance, priorBackCharge };
}

function periodIncrement(toDate: number, priorToDate: number): number {
  return roundMoney(Math.max(0, Number(toDate || 0) - Number(priorToDate || 0)));
}

function billingToWriteBody(
  row: {
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
    performanceSecurityAmount?: unknown;
    syndicateStampAmount?: unknown;
    backChargeAmount?: unknown;
    netPayable: unknown;
    description?: string | null;
  },
  periodAdvance: number,
  periodBackCharge: number,
): BillingWriteBody {
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
    advancePaymentRecovery: periodAdvance,
    performanceSecurityAmount: Number(row.performanceSecurityAmount ?? 0),
    syndicateStampAmount: Number(row.syndicateStampAmount ?? 0),
    backChargeAmount: periodBackCharge,
    netPayable: Number(row.netPayable),
    status: 'approved',
    description: row.description ?? `IPC No ${row.billingNumber}`,
  };
}

export async function buildBillingIpcPreviewEntries(
  row: {
    id: string;
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
    performanceSecurityAmount?: unknown;
    syndicateStampAmount?: unknown;
    backChargeAmount?: unknown;
    netPayable: unknown;
    description?: string | null;
  },
  contractName: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const { priorAdvance, priorBackCharge } = await priorCoverToDateAmounts(
    client as Prisma.TransactionClient,
    row.contractId,
    row.id,
  );
  const periodAdvance = periodIncrement(Number(row.advancePaymentRecovery), priorAdvance);
  const periodBackCharge = periodIncrement(Number(row.backChargeAmount), priorBackCharge);
  return buildIpcEntries({
    worksValue: Number(row.worksValueExVat),
    vatAmount: Number(row.vatAmount),
    netPayable: Number(row.netPayable),
    execGuarantee: Number(row.execGuaranteeAmount),
    whtAmount: Number(row.whtAmount),
    labourInsurance: Number(row.labourInsuranceAmount),
    manpowerLevy: Number(row.manpowerLevyAmount),
    advancePaymentRecovery: periodAdvance,
    performanceSecurity: Number(row.performanceSecurityAmount ?? 0),
    syndicateStamp: Number(row.syndicateStampAmount ?? 0),
    backCharge: periodBackCharge,
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

    const { priorAdvance, priorBackCharge } = await priorCoverToDateAmounts(
      client,
      row.contractId,
      billingId,
    );
    const body = billingToWriteBody(
      row,
      periodIncrement(Number(row.advancePaymentRecovery), priorAdvance),
      periodIncrement(Number(row.backChargeAmount), priorBackCharge),
    );
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
