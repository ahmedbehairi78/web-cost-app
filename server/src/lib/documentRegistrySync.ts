import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';

type DbClient = Prisma.TransactionClient | typeof prisma;

const SOURCE_MODULE_BILLING = 'billing';
const SOURCE_MODULE_BOQ = 'boq';

function computeIpcAction(status: string, transactionId: string | null | undefined): {
  needsAction: boolean;
  actionKind: string | null;
} {
  if (transactionId) return { needsAction: false, actionKind: null };
  if (status === 'submitted' || status === 'review') {
    return { needsAction: true, actionKind: 'approve' };
  }
  return { needsAction: false, actionKind: null };
}

function computeMosAction(status: string): { needsAction: boolean; actionKind: string | null } {
  if (status === 'draft') return { needsAction: true, actionKind: 'approve' };
  return { needsAction: false, actionKind: null };
}

export async function syncMosCertificateRegistry(
  certificateId: string,
  client: DbClient = prisma,
): Promise<void> {
  const row = await client.mosCertificate.findUnique({
    where: { id: certificateId },
    include: { contract: { select: { projectId: true } } },
  });
  if (!row) return;

  const { needsAction, actionKind } = computeMosAction(row.status);
  const projectId = row.contract?.projectId ?? null;

  await client.documentRegistry.upsert({
    where: {
      sourceModule_sourceEntityId: {
        sourceModule: SOURCE_MODULE_BILLING,
        sourceEntityId: row.id,
      },
    },
    create: {
      id: randomUUID(),
      docType: 'mos',
      sourceModule: SOURCE_MODULE_BILLING,
      sourceEntityId: row.id,
      documentNo: row.certificateNo,
      projectId,
      contractId: row.contractId,
      documentDate: row.extractDate,
      status: row.status,
      amount: row.totalClaimed,
      phase: row.phase,
      needsAction,
      actionKind,
      isDeleted: false,
      createdBy: row.createdBy,
    },
    update: {
      documentNo: row.certificateNo,
      projectId,
      contractId: row.contractId,
      documentDate: row.extractDate,
      status: row.status,
      amount: row.totalClaimed,
      phase: row.phase,
      needsAction,
      actionKind,
      isDeleted: false,
    },
  });
}

function computeVoAction(status: string): { needsAction: boolean; actionKind: string | null } {
  if (status === 'submitted') return { needsAction: true, actionKind: 'approve' };
  return { needsAction: false, actionKind: null };
}

export async function syncVariationOrderRegistry(
  orderId: string,
  client: DbClient = prisma,
): Promise<void> {
  const row = await client.variationOrder.findUnique({ where: { id: orderId } });
  if (!row) return;

  const { needsAction, actionKind } = computeVoAction(row.status);

  await client.documentRegistry.upsert({
    where: {
      sourceModule_sourceEntityId: {
        sourceModule: SOURCE_MODULE_BOQ,
        sourceEntityId: row.id,
      },
    },
    create: {
      id: randomUUID(),
      docType: 'vo',
      sourceModule: SOURCE_MODULE_BOQ,
      sourceEntityId: row.id,
      documentNo: row.voNumber,
      projectId: row.projectId,
      contractId: row.contractId,
      documentDate: row.voDate,
      status: row.status,
      amount: row.totalValue,
      phase: null,
      needsAction,
      actionKind,
      isDeleted: false,
      createdBy: row.createdBy,
    },
    update: {
      documentNo: row.voNumber,
      projectId: row.projectId,
      contractId: row.contractId,
      documentDate: row.voDate,
      status: row.status,
      amount: row.totalValue,
      needsAction,
      actionKind,
      isDeleted: false,
    },
  });
}

export async function syncBillingRegistry(
  billingId: string,
  client: DbClient = prisma,
): Promise<void> {
  const row = await client.billing.findUnique({ where: { id: billingId } });
  if (!row) return;

  if (row.isDeleted) {
    await markDocumentRegistryDeleted(SOURCE_MODULE_BILLING, billingId, client);
    return;
  }

  const { needsAction, actionKind } = computeIpcAction(row.status, row.transactionId);

  await client.documentRegistry.upsert({
    where: {
      sourceModule_sourceEntityId: {
        sourceModule: SOURCE_MODULE_BILLING,
        sourceEntityId: row.id,
      },
    },
    create: {
      id: randomUUID(),
      docType: 'ipc',
      sourceModule: SOURCE_MODULE_BILLING,
      sourceEntityId: row.id,
      documentNo: row.billingNumber,
      projectId: row.projectId,
      contractId: row.contractId,
      documentDate: row.date,
      status: row.status,
      amount: row.netPayable,
      phase: null,
      needsAction,
      actionKind,
      isDeleted: false,
      createdBy: null,
    },
    update: {
      documentNo: row.billingNumber,
      projectId: row.projectId,
      contractId: row.contractId,
      documentDate: row.date,
      status: row.status,
      amount: row.netPayable,
      needsAction,
      actionKind,
      isDeleted: false,
    },
  });
}

export async function markDocumentRegistryDeleted(
  sourceModule: string,
  sourceEntityId: string,
  client: DbClient = prisma,
): Promise<void> {
  await client.documentRegistry.updateMany({
    where: { sourceModule, sourceEntityId },
    data: { isDeleted: true, needsAction: false, actionKind: null },
  });
}

export async function backfillDocumentRegistry(client: DbClient = prisma): Promise<{ mos: number; ipc: number; vo: number }> {
  const certs = await client.mosCertificate.findMany({ select: { id: true } });
  for (const cert of certs) {
    await syncMosCertificateRegistry(cert.id, client);
  }

  const billings = await client.billing.findMany({ where: { isDeleted: false }, select: { id: true } });
  for (const bill of billings) {
    await syncBillingRegistry(bill.id, client);
  }

  const vos = await client.variationOrder.findMany({ select: { id: true } });
  for (const vo of vos) {
    await syncVariationOrderRegistry(vo.id, client);
  }

  return { mos: certs.length, ipc: billings.length, vo: vos.length };
}
