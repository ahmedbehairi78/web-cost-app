import { Prisma } from '@prisma/client';
import { createTransaction } from './journal.js';
import type { JournalEntryInput } from './journalShared.js';
import { prisma } from '../db.js';

export type DbClient = Prisma.TransactionClient | typeof prisma;

export type WarehouseAccountRef = {
  accountCode: string;
  accountName: string;
};

function warehouseNameCandidates(projectName: string, projectNameEn?: string | null): string[] {
  const name = String(projectName || '').trim();
  const nameEn = String(projectNameEn || name).trim();
  const out = new Set<string>();
  if (name) {
    out.add(`مخزون مشروع - ${name}`);
    out.add(`مخزن خامات ${name}`);
  }
  if (nameEn) out.add(`Project Inventory - ${nameEn}`);
  return [...out];
}

async function activateWarehouseAccount(
  client: DbClient,
  accountCode: string,
  projectId?: string,
): Promise<void> {
  await client.chartOfAccount.update({
    where: { accountCode },
    data: {
      status: 'active',
      ...(projectId ? { projectId } : {}),
    },
  });
}

function pickWarehouseRow(
  row: { accountCode: string; accountName: string; status: string } | null | undefined,
): WarehouseAccountRef | null {
  if (!row) return null;
  return { accountCode: row.accountCode, accountName: row.accountName };
}

async function pickAndMaybeActivate(
  client: DbClient,
  row: { accountCode: string; accountName: string; status: string } | null | undefined,
  projectId: string,
): Promise<WarehouseAccountRef | null> {
  if (!row) return null;
  if (row.status === 'disabled') {
    await activateWarehouseAccount(client, row.accountCode, projectId);
  }
  return pickWarehouseRow(row);
}

/** Resolve 127… leaf warehouse account for a project (Postgres COA). Reactivates linked accounts if disabled. */
export async function resolveProjectWarehouseAccount(
  client: DbClient,
  projectId: string,
): Promise<WarehouseAccountRef | null> {
  const project = await client.project.findFirst({
    where: { id: projectId, isDeleted: false },
    select: {
      projectName: true,
      projectNameEn: true,
      projectCode: true,
      inventoryAccountCode: true,
    },
  });

  if (!project) return null;

  const invCode = String(project.inventoryAccountCode || '').trim();

  if (invCode) {
    const byInvActive = await client.chartOfAccount.findFirst({
      where: { isGroup: false, status: 'active', accountCode: invCode },
      select: { accountCode: true, accountName: true, status: true },
    });
    const picked = await pickAndMaybeActivate(client, byInvActive, projectId);
    if (picked) return picked;

    const byInvAny =
      invCode.length === 8 && invCode.startsWith('127')
        ? await client.chartOfAccount.findFirst({
            where: { isGroup: false, accountCode: invCode },
            select: { accountCode: true, accountName: true, status: true },
          })
        : null;
    const reactivated = await pickAndMaybeActivate(client, byInvAny, projectId);
    if (reactivated) return reactivated;
  }

  const byProjectIdActive = await client.chartOfAccount.findFirst({
    where: {
      isGroup: false,
      status: 'active',
      projectId,
      accountCode: { startsWith: '127' },
    },
    orderBy: { accountCode: 'asc' },
    select: { accountCode: true, accountName: true, status: true },
  });
  const byProject = await pickAndMaybeActivate(client, byProjectIdActive, projectId);
  if (byProject) return byProject;

  const byProjectIdAny = await client.chartOfAccount.findFirst({
    where: {
      isGroup: false,
      projectId,
      accountCode: { startsWith: '127' },
    },
    orderBy: { accountCode: 'asc' },
    select: { accountCode: true, accountName: true, status: true },
  });
  const byProjectAny = await pickAndMaybeActivate(client, byProjectIdAny, projectId);
  if (byProjectAny) return byProjectAny;

  const name = String(project.projectName || '').trim();
  const nameEn = String(project.projectNameEn || name).trim();

  for (const label of warehouseNameCandidates(name, nameEn)) {
    const byLabel = await client.chartOfAccount.findFirst({
      where: {
        isGroup: false,
        status: 'active',
        accountCode: { startsWith: '127' },
        OR: [{ accountName: label }, { accountNameEn: label }],
      },
      orderBy: { accountCode: 'asc' },
      select: { accountCode: true, accountName: true, status: true },
    });
    const picked = await pickAndMaybeActivate(client, byLabel, projectId);
    if (picked) return picked;
  }

  if (name) {
    const byName = await client.chartOfAccount.findFirst({
      where: {
        isGroup: false,
        status: 'active',
        accountCode: { startsWith: '127' },
        OR: [
          { accountName: { contains: name } },
          { accountNameEn: { contains: name } },
        ],
      },
      orderBy: { accountCode: 'asc' },
      select: { accountCode: true, accountName: true, status: true },
    });
    const picked = await pickAndMaybeActivate(client, byName, projectId);
    if (picked) return picked;
  }

  return null;
}

export function buildInterWarehouseTransferEntries(
  totalCost: number,
  fromWh: WarehouseAccountRef,
  toWh: WarehouseAccountRef,
  fromProjectName: string,
  toProjectName: string,
): JournalEntryInput[] {
  const amount = Number(totalCost);
  if (amount <= 0) return [];

  return [
    {
      accountCode: toWh.accountCode,
      accountName: toWh.accountName || `مخزون مشروع - ${toProjectName}`,
      debit: amount,
      credit: 0,
    },
    {
      accountCode: fromWh.accountCode,
      accountName: fromWh.accountName || `مخزون مشروع - ${fromProjectName}`,
      debit: 0,
      credit: amount,
    },
  ];
}

export async function postProjectTransferJournal(
  tx: Prisma.TransactionClient,
  params: {
    transferId: number;
    transferNumber: string;
    transferDate: string;
    fromProjectId: string;
    toProjectId: string;
    fromProjectName: string;
    toProjectName: string;
    totalCost: number;
    fromWarehouse?: WarehouseAccountRef | null;
    toWarehouse?: WarehouseAccountRef | null;
    userId?: string;
  },
): Promise<string | null> {
  const existing = await tx.projectInventoryTransfer.findUnique({
    where: { id: params.transferId },
    select: { transactionId: true },
  });
  if (existing?.transactionId) return existing.transactionId;

  const total = Number(params.totalCost);
  if (total <= 0) return null;

  const fromWh =
    params.fromWarehouse ?? (await resolveProjectWarehouseAccount(tx, params.fromProjectId));
  const toWh =
    params.toWarehouse ?? (await resolveProjectWarehouseAccount(tx, params.toProjectId));

  if (!fromWh || !toWh) {
    throw new Error(
      'حسابات مخازن المشاريع (127…) غير مربوطة. اربط كل مشروع بحساب مخزن من تبويب رصيد المخزن، أو أرسل أكواد الحسابات عند الاعتماد.',
    );
  }

  const entries = buildInterWarehouseTransferEntries(
    total,
    fromWh,
    toWh,
    params.fromProjectName,
    params.toProjectName,
  );

  const journal = await createTransaction(
    {
      date: params.transferDate,
      description: `تحويل مخزن مشروع — ${params.fromProjectName} → ${params.toProjectName}`,
      reference: params.transferNumber,
      projectId: params.fromProjectId,
      entries,
    },
    params.userId,
    tx,
  );

  const journalId = String(journal.id);
  await tx.projectInventoryTransfer.update({
    where: { id: params.transferId },
    data: { transactionId: journalId },
  });

  return journalId;
}
