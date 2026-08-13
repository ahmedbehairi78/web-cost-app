import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { createTransaction } from '../accounting/journal.js';
import { AccountCodes } from '../accounting/accountCodes.js';
import { postProjectTransferJournal } from '../accounting/projectWarehouseGl.js';
import {
  issueProjectInventory,
  num,
  receiptProjectInventoryTransfer,
  releaseProjectInventoryReserve,
  toMoney,
} from '../modules/inventoryHelpers.js';
import { buildNotificationFeed, type NotificationAuthUser } from './notificationFeed.js';
import { fireCancelOutbox } from './enqueueNotification.js';
import { hashApprovalToken } from './approvalLinkToken.js';
import type { UserRole } from '../permissions.js';
import { moduleAccess } from '../permissions.js';
import { businessTodayYmd } from './businessCalendar.js';

export type NotificationAction = 'approve' | 'reject';

export type NotificationItemDetail = {
  key: string;
  type: string;
  priority: string;
  titleAr: string;
  titleEn: string;
  moduleId: string;
  entityId?: string;
  allowedActions: NotificationAction[];
  summary: Record<string, string>;
};

type Tx = Prisma.TransactionClient;

function authUserFromReq(user: Express.Request['user']): NotificationAuthUser {
  return {
    id: user!.id,
    role: user!.role as UserRole,
    permissions: user!.permissions,
    assignedContractIds: user!.assignedContractIds ?? [],
  };
}

async function assertUserCanSeeKey(user: Express.Request['user'], key: string): Promise<void> {
  const items = await buildNotificationFeed(authUserFromReq(user));
  if (!items.some((i) => i.key === key)) {
    throw new Error('notification_not_visible');
  }
}

async function releaseTransferReserves(tx: Tx, transferId: number): Promise<void> {
  const lines = await tx.projectInventoryTransferLine.findMany({
    where: { transferId },
    select: { projectInventoryId: true, quantity: true },
  });
  for (const line of lines) {
    await releaseProjectInventoryReserve(tx, line.projectInventoryId, num(line.quantity));
  }
}

async function applyProjectTransferEffect(tx: Tx, transferId: number): Promise<void> {
  const transfer = await tx.projectInventoryTransfer.findUnique({ where: { id: transferId } });
  if (!transfer) throw new Error('Transfer not found');

  const lines = await tx.projectInventoryTransferLine.findMany({
    where: { transferId },
    include: {
      projectInventory: { select: { projectId: true } },
      materialCategory: { select: { name: true, unit: true } },
    },
  });

  const ref = transfer.transferNumber;
  for (const line of lines) {
    if (line.projectInventory.projectId !== transfer.fromProjectId) {
      throw new Error('Transfer line does not belong to source project');
    }
    const qty = num(line.quantity);
    const unitCost = num(line.unitCost);
    const categoryName = line.materialCategory?.name || 'Material';
    const unit = line.materialCategory?.unit || '—';

    await releaseProjectInventoryReserve(tx, line.projectInventoryId, qty);
    await issueProjectInventory(tx, transfer.fromProjectId, line.materialCategoryId, qty, {
      referenceType: 'project_transfer',
      referenceId: ref,
    });
    await receiptProjectInventoryTransfer(
      tx,
      transfer.toProjectId,
      line.materialCategoryId,
      categoryName,
      unit,
      qty,
      unitCost,
      { referenceType: 'project_transfer', referenceId: ref },
    );
  }
}

async function sumTransferLineCost(tx: Tx, transferId: number): Promise<number> {
  const agg = await tx.projectInventoryTransferLine.aggregate({
    where: { transferId },
    _sum: { totalCost: true },
  });
  return toMoney(num(agg._sum.totalCost));
}

async function userCanAccessDestinationProject(
  user: Express.Request['user'],
  toProjectId: string,
): Promise<boolean> {
  if (!user) return false;
  const { assertProjectAccess } = await import('../modules/inventoryHelpers.js');
  try {
    await assertProjectAccess(prisma, user, toProjectId);
    return true;
  } catch {
    return false;
  }
}

export async function verifyApprovalLink(plainToken: string): Promise<{
  valid: boolean;
  notificationKey?: string;
  expiresAt?: string;
}> {
  const tokenHash = hashApprovalToken(plainToken);
  const row = await prisma.approvalLinkToken.findUnique({ where: { tokenHash } });
  if (!row) return { valid: false };
  if (row.usedAt) return { valid: false };
  if (row.expiresAt.getTime() < Date.now()) return { valid: false };
  return {
    valid: true,
    notificationKey: row.notificationKey,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function loadNotificationItemDetail(
  user: Express.Request['user'],
  key: string,
): Promise<NotificationItemDetail | null> {
  await assertUserCanSeeKey(user, key);

  const feedItems = await buildNotificationFeed(authUserFromReq(user));
  const feedItem = feedItems.find((i) => i.key === key);
  if (!feedItem) return null;

  const summary: Record<string, string> = {};
  const allowedActions: NotificationAction[] = [];

  if (key.startsWith('transfer:')) {
    const id = Number(key.slice('transfer:'.length));
    const tr = await prisma.projectInventoryTransfer.findUnique({
      where: { id },
      include: {
        fromProject: { select: { projectName: true } },
        toProject: { select: { projectName: true } },
      },
    });
    if (!tr) return null;

    summary.transferNumber = tr.transferNumber;
    summary.fromProject = tr.fromProject?.projectName ?? tr.fromProjectId;
    summary.toProject = tr.toProject?.projectName ?? tr.toProjectId;
    summary.date = tr.transferDate;
    summary.status = tr.status;

    if (tr.status === 'pending_b' && feedItem.type === 'transfer_pending_b') {
      if (await userCanAccessDestinationProject(user, tr.toProjectId)) {
        allowedActions.push('approve', 'reject');
      }
    }
    if (tr.status === 'pending_projects' && feedItem.type === 'transfer_pending_projects') {
      if (moduleAccess(user!.permissions, 'inventory').edit) {
        allowedActions.push('approve', 'reject');
      }
    }
  } else if (key.startsWith('mos:')) {
    const id = key.slice('mos:'.length);
    const cert = await prisma.mosCertificate.findUnique({ where: { id } });
    if (cert) {
      if (cert.status !== 'draft') return null;
      summary.extractNumber = cert.certificateNo ?? id.slice(0, 8);
      summary.date = cert.extractDate ?? '';
      summary.status = cert.status;
      if (moduleAccess(user!.permissions, 'billing').edit) {
        allowedActions.push('approve');
      }
    } else {
      const mos = await prisma.materialOnSiteExtract.findUnique({ where: { id } });
      if (!mos || mos.status !== 'draft') return null;

      summary.extractNumber = mos.extractNumber ?? id.slice(0, 8);
      summary.date = mos.extractDate ?? '';
      summary.status = mos.status;

      if (moduleAccess(user!.permissions, 'billing').edit) {
        allowedActions.push('approve');
      }
    }
  } else if (key.startsWith('billing:')) {
    const id = key.slice('billing:'.length);
    const bill = await prisma.billing.findUnique({ where: { id } });
    if (!bill || bill.isDeleted) return null;
    if (bill.status !== 'review' && bill.status !== 'submitted') return null;
    if (bill.transactionId) return null;

    summary.billingNumber = bill.billingNumber;
    summary.date = bill.date;
    summary.status = bill.status;
    summary.netPayable = String(bill.netPayable);

    if (moduleAccess(user!.permissions, 'billing').edit) {
      allowedActions.push('approve');
    }
  } else if (key.startsWith('vo:')) {
    const id = key.slice('vo:'.length);
    const vo = await prisma.variationOrder.findUnique({ where: { id } });
    if (!vo || vo.status !== 'submitted') return null;

    summary.voNumber = vo.voNumber;
    summary.date = vo.voDate ?? '';
    summary.status = vo.status;
    summary.totalValue = String(vo.totalValue);

    if (moduleAccess(user!.permissions, 'boq').edit) {
      allowedActions.push('approve', 'reject');
    }
  }

  return {
    key: feedItem.key,
    type: feedItem.type,
    priority: feedItem.priority,
    titleAr: feedItem.titleAr,
    titleEn: feedItem.titleEn,
    moduleId: feedItem.moduleId,
    entityId: feedItem.entityId,
    allowedActions,
    summary,
  };
}

async function markNotificationRead(userId: string, key: string): Promise<void> {
  await prisma.userNotificationRead.upsert({
    where: { userId_notificationKey: { userId, notificationKey: key } },
    create: { id: randomUUID(), userId, notificationKey: key },
    update: { readAt: new Date(), dismissedAt: null },
  });
}

export async function executeNotificationAction(
  user: Express.Request['user'],
  key: string,
  action: NotificationAction,
): Promise<{ ok: true }> {
  await assertUserCanSeeKey(user, key);
  const detail = await loadNotificationItemDetail(user, key);
  if (!detail || !detail.allowedActions.includes(action)) {
    throw new Error('action_not_allowed');
  }

  if (key.startsWith('transfer:')) {
    const transferId = Number(key.slice('transfer:'.length));
    if (detail.type === 'transfer_pending_b') {
      if (action === 'approve') {
        await prisma.$transaction(async (tx) => {
          const transfer = await tx.projectInventoryTransfer.findUnique({ where: { id: transferId } });
          if (!transfer || transfer.status !== 'pending_b') throw new Error('invalid_status');
          if (!(await userCanAccessDestinationProject(user, transfer.toProjectId))) {
            throw new Error('access_denied');
          }
          await tx.projectInventoryTransfer.update({
            where: { id: transferId },
            data: { status: 'pending_projects', approvedByB: user!.id },
          });
        });
        const { notifyTransferPendingProjects } = await import('./notificationHooks.js');
        notifyTransferPendingProjects(transferId);
      } else {
        await prisma.$transaction(async (tx) => {
          const transfer = await tx.projectInventoryTransfer.findUnique({ where: { id: transferId } });
          if (!transfer || transfer.status !== 'pending_b') throw new Error('invalid_status');
          if (!(await userCanAccessDestinationProject(user, transfer.toProjectId))) {
            throw new Error('access_denied');
          }
          await releaseTransferReserves(tx, transferId);
          await tx.projectInventoryTransfer.update({
            where: { id: transferId },
            data: { status: 'rejected_b', approvedByB: user!.id },
          });
        });
        const { notifyTransferResolved } = await import('./notificationHooks.js');
        notifyTransferResolved(transferId);
      }
    } else if (detail.type === 'transfer_pending_projects') {
      if (!moduleAccess(user!.permissions, 'inventory').edit) {
        throw new Error('access_denied');
      }
      if (action === 'approve') {
        await prisma.$transaction(async (tx) => {
          const transfer = await tx.projectInventoryTransfer.findUnique({
            where: { id: transferId },
            include: {
              fromProject: { select: { projectName: true } },
              toProject: { select: { projectName: true } },
            },
          });
          if (!transfer || transfer.status !== 'pending_projects') throw new Error('invalid_status');

          await tx.projectInventoryTransfer.update({
            where: { id: transferId },
            data: { status: 'approved', approvedByProjects: user!.id },
          });
          await applyProjectTransferEffect(tx, transferId);
          const totalCost = await sumTransferLineCost(tx, transferId);
          await postProjectTransferJournal(tx, {
            transferId,
            transferNumber: transfer.transferNumber,
            transferDate: transfer.transferDate,
            fromProjectId: transfer.fromProjectId,
            toProjectId: transfer.toProjectId,
            fromProjectName: transfer.fromProject?.projectName || transfer.fromProjectId,
            toProjectName: transfer.toProject?.projectName || transfer.toProjectId,
            totalCost,
            fromWarehouse: null,
            toWarehouse: null,
            userId: user!.id,
          });
        });
      } else {
        await prisma.$transaction(async (tx) => {
          const transfer = await tx.projectInventoryTransfer.findUnique({ where: { id: transferId } });
          if (!transfer || transfer.status !== 'pending_projects') throw new Error('invalid_status');
          await releaseTransferReserves(tx, transferId);
          await tx.projectInventoryTransfer.update({
            where: { id: transferId },
            data: { status: 'rejected_projects', approvedByProjects: user!.id },
          });
        });
      }
      const { notifyTransferResolved } = await import('./notificationHooks.js');
      notifyTransferResolved(transferId);
    }
  } else if (key.startsWith('mos:')) {
    const id = key.slice('mos:'.length);
    if (action !== 'approve') throw new Error('action_not_allowed');

    if (!moduleAccess(user!.permissions, 'billing').edit) {
      throw new Error('access_denied');
    }

    const cert = await prisma.mosCertificate.findUnique({ where: { id } });
    if (cert) {
      if (cert.status !== 'draft') throw new Error('invalid_status');
      const { approveMosCertificate } = await import('./mosCertificateApprove.js');
      await approveMosCertificate(id, user!.id);
      const { notifyMosResolved } = await import('./notificationHooks.js');
      notifyMosResolved(id);
    } else {
      const row = await prisma.materialOnSiteExtract.findUnique({ where: { id } });
      if (!row || row.status !== 'draft') throw new Error('invalid_status');

      const contract = await prisma.contract.findUnique({
        where: { id: row.contractId },
        select: { projectId: true },
      });
      const boq = await prisma.boqItem.findUnique({
        where: { id: row.boqItemId },
        select: { description: true },
      });
      const claimedAmount = Math.round(Number(row.claimedAmount) * 100) / 100;
      const extractNumber = String(row.extractNumber ?? '').trim();
      const boqDescription = boq?.description ?? row.boqItemId;

      await prisma.$transaction(async (tx) => {
        const journal = await createTransaction(
          {
            date: String(row.extractDate ?? businessTodayYmd()),
            description: `تشوين - ${boqDescription}`,
            reference: extractNumber || undefined,
            costCenterId: row.contractId,
            projectId: contract?.projectId || undefined,
            entries: [
              { accountCode: AccountCodes.RECEIVABLES, accountName: 'ح/ عملاء - مستخلصات تحت التحصيل', debit: claimedAmount, credit: 0 },
              { accountCode: AccountCodes.REVENUE, accountName: 'ح/ إيرادات عقود المقاولات', debit: 0, credit: claimedAmount },
            ],
          },
          user!.id,
          tx,
        );
        await tx.materialOnSiteExtract.update({
          where: { id },
          data: { status: 'approved', transactionId: journal.id },
        });
      });
      const { notifyMosResolved } = await import('./notificationHooks.js');
      notifyMosResolved(id);
    }
  } else if (key.startsWith('billing:')) {
    const id = key.slice('billing:'.length);
    if (action !== 'approve') throw new Error('action_not_allowed');

    if (!moduleAccess(user!.permissions, 'billing').edit) {
      throw new Error('access_denied');
    }

    const { approveBillingIpc } = await import('./billingIpcApprove.js');
    await approveBillingIpc(id, user!.id);
  } else if (key.startsWith('vo:')) {
    const id = key.slice('vo:'.length);
    if (!moduleAccess(user!.permissions, 'boq').edit) {
      throw new Error('access_denied');
    }

    if (action === 'approve') {
      const { approveVariationOrder } = await import('./variationOrderApprove.js');
      await approveVariationOrder(id, user!.id);
      const { notifyVoResolved } = await import('./notificationHooks.js');
      notifyVoResolved(id);
    } else if (action === 'reject') {
      const row = await prisma.variationOrder.findUnique({ where: { id } });
      if (!row || row.status !== 'submitted') throw new Error('invalid_status');
      await prisma.variationOrder.update({
        where: { id },
        data: { status: 'rejected' },
      });
      const { syncVariationOrderRegistry } = await import('./documentRegistrySync.js');
      await syncVariationOrderRegistry(id);
      const { notifyVoResolved } = await import('./notificationHooks.js');
      notifyVoResolved(id);
    } else {
      throw new Error('action_not_allowed');
    }
  }

  fireCancelOutbox(key);
  await markNotificationRead(user!.id, key);
  return { ok: true };
}
