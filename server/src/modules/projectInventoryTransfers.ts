import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth, requireAnyPermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import {
  EPSILON,
  assertProjectAccess,
  getAccessibleProjectIds,
  getProjectAvailableQuantity,
  issueProjectInventory,
  num,
  receiptProjectInventoryTransfer,
  releaseProjectInventoryReserve,
  reserveProjectInventory,
  toMoney,
} from './inventoryHelpers.js';
import { ensureProjectExists } from './ensureLocalProject.js';
import { postProjectTransferJournal } from '../accounting/projectWarehouseGl.js';
import {
  notifyTransferCreated,
  notifyTransferPendingProjects,
  notifyTransferResolved,
} from '../lib/notificationHooks.js';

export const projectInventoryTransfersRouter = Router();
projectInventoryTransfersRouter.use(requireAuth);

const inventoryPerm = requireAnyPermission('inventory', 'transfers', 'costs');
const projectsPerm = requireAnyPermission('projects', 'inventory', 'transfers');

type TransferStatus =
  | 'pending_b'
  | 'rejected_b'
  | 'pending_projects'
  | 'rejected_projects'
  | 'approved'
  | 'cancelled';

async function generateTransferNumber(tx: Prisma.TransactionClient): Promise<string> {
  const cnt = await tx.projectInventoryTransfer.count({
    where: { transferNumber: { startsWith: 'PTRF-' } },
  });
  const seq = String(cnt + 1).padStart(4, '0');
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `PTRF-${date}-${seq}`;
}

async function releaseTransferReserves(tx: Prisma.TransactionClient, transferId: number): Promise<void> {
  const lines = await tx.projectInventoryTransferLine.findMany({
    where: { transferId },
    select: { projectInventoryId: true, quantity: true },
  });
  for (const line of lines) {
    await releaseProjectInventoryReserve(tx, line.projectInventoryId, num(line.quantity));
  }
}

async function applyProjectTransferEffect(tx: Prisma.TransactionClient, transferId: number): Promise<void> {
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

async function sumTransferLineCost(tx: Prisma.TransactionClient, transferId: number): Promise<number> {
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
  if (user.role === 'admin' || user.role === 'projects_manager') return true;
  try {
    await assertProjectAccess(prisma, user, toProjectId);
    return true;
  } catch {
    return false;
  }
}

const transferInclude = {
  fromProject: { select: { projectName: true, projectCode: true } },
  toProject: { select: { projectName: true, projectCode: true } },
  lines: {
    include: {
      materialCategory: { select: { code: true, name: true, unit: true } },
      projectInventory: { select: { itemDescription: true } },
    },
  },
} satisfies Prisma.ProjectInventoryTransferInclude;

function mapTransfer(row: Prisma.ProjectInventoryTransferGetPayload<{ include: typeof transferInclude }>) {
  const base = serialize(row) as Record<string, unknown>;
  return {
    ...base,
    fromProjectName: row.fromProject?.projectName,
    fromProjectCode: row.fromProject?.projectCode,
    toProjectName: row.toProject?.projectName,
    toProjectCode: row.toProject?.projectCode,
    lines: row.lines.map((line) => {
      const flat = serialize(line) as Record<string, unknown>;
      return {
        ...flat,
        materialCode: line.materialCategory?.code,
        materialName: line.materialCategory?.name,
        materialUnit: line.materialCategory?.unit,
        itemDescription: line.projectInventory?.itemDescription,
      };
    }),
  };
}

projectInventoryTransfersRouter.get(
  '/',
  inventoryPerm,
  asyncHandler(async (req, res) => {
    const accessible = await getAccessibleProjectIds(prisma, req.user);
    const status = req.query.status ? String(req.query.status) : null;
    const fromProjectId = req.query.fromProjectId ? String(req.query.fromProjectId) : null;
    const toProjectId = req.query.toProjectId ? String(req.query.toProjectId) : null;

    const where: Prisma.ProjectInventoryTransferWhereInput = {};
    if (accessible !== null) {
      if (accessible.length === 0) {
        res.json([]);
        return;
      }
      where.OR = [
        { fromProjectId: { in: accessible } },
        { toProjectId: { in: accessible } },
      ];
    }
    if (status) where.status = status;
    if (fromProjectId) where.fromProjectId = fromProjectId;
    if (toProjectId) where.toProjectId = toProjectId;

    const rows = await prisma.projectInventoryTransfer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: transferInclude,
    });

    res.json(rows.map(mapTransfer));
  }),
);

projectInventoryTransfersRouter.get(
  '/pending-projects',
  projectsPerm,
  asyncHandler(async (_req, res) => {
    const rows = await prisma.projectInventoryTransfer.findMany({
      where: { status: 'pending_projects' },
      orderBy: { createdAt: 'asc' },
      include: {
        fromProject: { select: { projectName: true } },
        toProject: { select: { projectName: true } },
      },
    });
    res.json(
      serialize(
        rows.map((r) => ({
          ...r,
          fromProjectName: r.fromProject?.projectName,
          toProjectName: r.toProject?.projectName,
        })),
      ),
    );
  }),
);

projectInventoryTransfersRouter.post(
  '/',
  inventoryPerm,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const body = req.body as {
      fromProjectId: string;
      toProjectId: string;
      transferDate: string;
      notes?: string;
      lines: { projectInventoryId: number; quantity: number }[];
      fromProjectCode?: string;
      fromProjectName?: string;
      toProjectCode?: string;
      toProjectName?: string;
    };

    if (!body.fromProjectId || !body.toProjectId || !body.transferDate) {
      res.status(400).json({ error: 'fromProjectId, toProjectId, transferDate are required' });
      return;
    }
    if (body.fromProjectId === body.toProjectId) {
      res.status(400).json({ error: 'Cannot transfer to the same project' });
      return;
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      res.status(400).json({ error: 'At least one line is required' });
      return;
    }

    await assertProjectAccess(prisma, user, body.fromProjectId);
    await ensureProjectExists(body.fromProjectId, {
      projectCode: body.fromProjectCode,
      projectName: body.fromProjectName,
    });
    await ensureProjectExists(body.toProjectId, {
      projectCode: body.toProjectCode,
      projectName: body.toProjectName,
    });

    const result = await prisma.$transaction(async (tx) => {
      const transferNumber = await generateTransferNumber(tx);
      const transfer = await tx.projectInventoryTransfer.create({
        data: {
          transferNumber,
          transferDate: body.transferDate,
          fromProjectId: body.fromProjectId,
          toProjectId: body.toProjectId,
          status: 'pending_b',
          createdBy: user.id,
          notes: body.notes ?? null,
        },
      });

      for (const [idx, line] of body.lines.entries()) {
        if (!line.projectInventoryId || typeof line.quantity !== 'number' || line.quantity <= 0) {
          throw new Error(`Line ${idx + 1}: projectInventoryId and positive quantity required`);
        }

        const item = await tx.projectInventory.findUnique({ where: { id: line.projectInventoryId } });
        if (!item) throw new Error(`Line ${idx + 1}: inventory row ${line.projectInventoryId} not found`);
        if (item.projectId !== body.fromProjectId) {
          throw new Error(`Line ${idx + 1}: item does not belong to source project`);
        }

        const available = getProjectAvailableQuantity({ quantityBalance: num(item.quantityBalance) });
        if (line.quantity > available + EPSILON) {
          throw new Error(
            `Line ${idx + 1}: insufficient available balance. Available: ${available.toFixed(2)}, Requested: ${line.quantity}`,
          );
        }

        await reserveProjectInventory(tx, line.projectInventoryId, line.quantity);

        const unitCost = num(item.avgUnitCost);
        const totalCost = toMoney(line.quantity * unitCost);

        await tx.projectInventoryTransferLine.create({
          data: {
            transferId: transfer.id,
            projectInventoryId: line.projectInventoryId,
            materialCategoryId: item.materialCategoryId,
            quantity: line.quantity,
            unitCost,
            totalCost,
          },
        });
      }

      return transfer;
    });

    res.status(201).json({ ok: true, transfer: serialize(result) });
    notifyTransferCreated(
      {
        id: result.id,
        transferNumber: result.transferNumber,
        fromProjectId: result.fromProjectId,
        toProjectId: result.toProjectId,
      },
      user.id,
    );
  }),
);

projectInventoryTransfersRouter.post(
  '/:id/approve-b',
  inventoryPerm,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const transferId = Number(req.params.id);

    const result = await prisma.$transaction(async (tx) => {
      const transfer = await tx.projectInventoryTransfer.findUnique({ where: { id: transferId } });
      if (!transfer) throw new Error('Transfer not found');
      if (transfer.status !== 'pending_b') {
        throw new Error(`Cannot approve-b from status: ${transfer.status}`);
      }

      if (!(await userCanAccessDestinationProject(user, transfer.toProjectId))) {
        throw new Error('Access denied: you are not assigned to the destination project');
      }

      return tx.projectInventoryTransfer.update({
        where: { id: transferId },
        data: { status: 'pending_projects', approvedByB: user.id },
      });
    });

    res.json({ ok: true, transfer: serialize(result) });
    notifyTransferPendingProjects(transferId);
  }),
);

projectInventoryTransfersRouter.post(
  '/:id/reject-b',
  inventoryPerm,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const transferId = Number(req.params.id);
    const { reason } = (req.body ?? {}) as { reason?: string };

    const result = await prisma.$transaction(async (tx) => {
      const transfer = await tx.projectInventoryTransfer.findUnique({ where: { id: transferId } });
      if (!transfer) throw new Error('Transfer not found');
      if (transfer.status !== 'pending_b') {
        throw new Error(`Cannot reject-b from status: ${transfer.status}`);
      }

      if (!(await userCanAccessDestinationProject(user, transfer.toProjectId))) {
        throw new Error('Access denied');
      }

      await releaseTransferReserves(tx, transferId);

      return tx.projectInventoryTransfer.update({
        where: { id: transferId },
        data: {
          status: 'rejected_b',
          approvedByB: user.id,
          rejectionReason: reason ?? null,
        },
      });
    });

    res.json({ ok: true, transfer: serialize(result) });
    notifyTransferResolved(transferId);
  }),
);

projectInventoryTransfersRouter.post(
  '/:id/approve-projects',
  projectsPerm,
  asyncHandler(async (req, res) => {
    const user = req.user!;

    if (user.role !== 'admin' && user.role !== 'projects_manager') {
      res.status(403).json({ error: 'Only projects_manager or admin can approve cross-project transfers' });
      return;
    }

    const transferId = Number(req.params.id);
    const glBody = (req.body ?? {}) as {
      fromWarehouseAccountCode?: string;
      fromWarehouseAccountName?: string;
      toWarehouseAccountCode?: string;
      toWarehouseAccountName?: string;
    };
    const fromWarehouse = glBody.fromWarehouseAccountCode?.trim()
      ? {
          accountCode: glBody.fromWarehouseAccountCode.trim(),
          accountName: glBody.fromWarehouseAccountName?.trim() || glBody.fromWarehouseAccountCode.trim(),
        }
      : null;
    const toWarehouse = glBody.toWarehouseAccountCode?.trim()
      ? {
          accountCode: glBody.toWarehouseAccountCode.trim(),
          accountName: glBody.toWarehouseAccountName?.trim() || glBody.toWarehouseAccountCode.trim(),
        }
      : null;

    const result = await prisma.$transaction(async (tx) => {
      const transfer = await tx.projectInventoryTransfer.findUnique({
        where: { id: transferId },
        include: {
          fromProject: { select: { projectName: true } },
          toProject: { select: { projectName: true } },
        },
      });
      if (!transfer) throw new Error('Transfer not found');
      if (transfer.status !== 'pending_projects') {
        throw new Error(`Cannot approve-projects from status: ${transfer.status}`);
      }

      const updated = await tx.projectInventoryTransfer.update({
        where: { id: transferId },
        data: { status: 'approved', approvedByProjects: user.id },
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
        fromWarehouse,
        toWarehouse,
        userId: user.id,
      });

      return updated;
    });

    res.json({ ok: true, transfer: serialize(result) });
    notifyTransferResolved(transferId);
  }),
);

projectInventoryTransfersRouter.post(
  '/:id/reject-projects',
  projectsPerm,
  asyncHandler(async (req, res) => {
    const user = req.user!;

    if (user.role !== 'admin' && user.role !== 'projects_manager') {
      res.status(403).json({ error: 'Only projects_manager or admin can reject cross-project transfers' });
      return;
    }

    const transferId = Number(req.params.id);
    const { reason } = (req.body ?? {}) as { reason?: string };

    const result = await prisma.$transaction(async (tx) => {
      const transfer = await tx.projectInventoryTransfer.findUnique({ where: { id: transferId } });
      if (!transfer) throw new Error('Transfer not found');
      if (transfer.status !== 'pending_projects') {
        throw new Error(`Cannot reject-projects from status: ${transfer.status}`);
      }

      await releaseTransferReserves(tx, transferId);

      return tx.projectInventoryTransfer.update({
        where: { id: transferId },
        data: {
          status: 'rejected_projects',
          approvedByProjects: user.id,
          rejectionReason: reason ?? null,
        },
      });
    });

    res.json({ ok: true, transfer: serialize(result) });
    notifyTransferResolved(transferId);
  }),
);

projectInventoryTransfersRouter.post(
  '/:id/cancel',
  inventoryPerm,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const transferId = Number(req.params.id);

    const result = await prisma.$transaction(async (tx) => {
      const transfer = await tx.projectInventoryTransfer.findUnique({ where: { id: transferId } });
      if (!transfer) throw new Error('Transfer not found');
      if (!['pending_b', 'pending_projects'].includes(transfer.status)) {
        throw new Error(`Cannot cancel from status: ${transfer.status}`);
      }

      if (user.role !== 'admin' && transfer.createdBy !== user.id) {
        throw new Error('Only the creator or admin can cancel this transfer');
      }

      await releaseTransferReserves(tx, transferId);

      return tx.projectInventoryTransfer.update({
        where: { id: transferId },
        data: { status: 'cancelled' },
      });
    });

    res.json({ ok: true, transfer: serialize(result) });
    notifyTransferResolved(transferId);
  }),
);
