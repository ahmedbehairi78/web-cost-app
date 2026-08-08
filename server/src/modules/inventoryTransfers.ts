import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth, requireAnyPermission, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import {
  EPSILON,
  computeContractInventoryBalance,
  getAssignedContractIds,
  getAvailableQuantity,
  getInventoryByContractMaterial,
  num,
  releaseInventoryReserve,
  reserveInventory,
  toMoney,
  weightedAvgCost,
} from './inventoryHelpers.js';

export const inventoryTransfersRouter = Router();
inventoryTransfersRouter.use(requireAuth);

const inventoryPerm = requireAnyPermission('inventory', 'transfers', 'costs');

type TransferStatus =
  | 'pending_b'
  | 'rejected_b'
  | 'pending_projects'
  | 'rejected_projects'
  | 'approved'
  | 'cancelled';

async function generateTransferNumber(tx: Prisma.TransactionClient): Promise<string> {
  const cnt = await tx.inventoryTransfer.count({
    where: { transferNumber: { startsWith: 'TRF-' } },
  });
  const seq = String(cnt + 1).padStart(4, '0');
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `TRF-${date}-${seq}`;
}

async function releaseTransferReserves(tx: Prisma.TransactionClient, transferId: number): Promise<void> {
  const lines = await tx.inventoryTransferLine.findMany({
    where: { transferId },
    select: { inventoryItemId: true, quantity: true },
  });
  for (const line of lines) {
    await releaseInventoryReserve(tx, line.inventoryItemId, num(line.quantity));
  }
}

async function isSameProject(contractIdA: string, contractIdB: string): Promise<boolean> {
  const rows = await prisma.contract.findMany({
    where: { id: { in: [contractIdA, contractIdB] }, isDeleted: false },
    select: { id: true, projectId: true },
  });
  const a = rows.find((r) => r.id === contractIdA);
  const b = rows.find((r) => r.id === contractIdB);
  if (!a || !b) throw new Error('One or both contracts not found');
  return a.projectId === b.projectId;
}

async function applyAccountingEffect(tx: Prisma.TransactionClient, transferId: number): Promise<void> {
  const lines = await tx.inventoryTransferLine.findMany({ where: { transferId } });
  const transfer = await tx.inventoryTransfer.findUnique({ where: { id: transferId } });
  if (!transfer) throw new Error('Transfer not found');

  for (const line of lines) {
    const srcItem = await tx.contractInventory.findUnique({ where: { id: line.inventoryItemId } });
    if (!srcItem) throw new Error('Source inventory item not found');

    const qtyOut = num(line.quantity);
    const transferredOut = num(srcItem.quantityTransferredOut) + qtyOut;
    const balanceOut = computeContractInventoryBalance({
      quantityIn: srcItem.quantityIn,
      quantityTransferredIn: srcItem.quantityTransferredIn,
      quantityConsumed: srcItem.quantityConsumed,
      quantityTransferredOut: transferredOut,
      quantityReserved: srcItem.quantityReserved,
    });
    await tx.contractInventory.update({
      where: { id: line.inventoryItemId },
      data: {
        quantityTransferredOut: transferredOut,
        quantityBalance: balanceOut,
      },
    });

    const originalCost = num(line.unitCost);

    if (srcItem.materialCategoryId) {
      const dest = await getInventoryByContractMaterial(
        tx,
        transfer.toContractId,
        srcItem.materialCategoryId,
      );
      if (!dest) {
        const quantityTransferredIn = qtyOut;
        const quantityBalance = computeContractInventoryBalance({
          quantityIn: 0,
          quantityTransferredIn,
          quantityConsumed: 0,
          quantityTransferredOut: 0,
          quantityReserved: 0,
        });
        await tx.contractInventory.create({
          data: {
            contractId: transfer.toContractId,
            materialCategoryId: srcItem.materialCategoryId,
            itemDescription: srcItem.itemDescription,
            unit: srcItem.unit,
            quantityTransferredIn,
            avgUnitCost: originalCost,
            quantityBalance,
          },
        });
      } else {
        const full = await tx.contractInventory.findUnique({ where: { id: dest.id } });
        if (!full) throw new Error('Destination inventory not found');
        const physicalQty =
          num(full.quantityIn) +
          num(full.quantityTransferredIn) -
          num(full.quantityConsumed) -
          num(full.quantityTransferredOut);
        const weightedCost = weightedAvgCost(physicalQty, num(full.avgUnitCost), qtyOut, originalCost);
        const quantityTransferredIn = num(full.quantityTransferredIn) + qtyOut;
        const quantityBalance = computeContractInventoryBalance({
          quantityIn: full.quantityIn,
          quantityTransferredIn,
          quantityConsumed: full.quantityConsumed,
          quantityTransferredOut: full.quantityTransferredOut,
          quantityReserved: full.quantityReserved,
        });
        await tx.contractInventory.update({
          where: { id: dest.id },
          data: {
            quantityTransferredIn,
            avgUnitCost: weightedCost,
            quantityBalance,
          },
        });
      }
    } else {
      const existing = await tx.contractInventory.findFirst({
        where: {
          contractId: transfer.toContractId,
          itemDescription: srcItem.itemDescription ?? undefined,
          unit: srcItem.unit,
          materialCategoryId: null,
        },
        orderBy: { id: 'asc' },
      });

      if (!existing) {
        const quantityBalance = computeContractInventoryBalance({
          quantityIn: 0,
          quantityTransferredIn: qtyOut,
          quantityConsumed: 0,
          quantityTransferredOut: 0,
          quantityReserved: 0,
        });
        await tx.contractInventory.create({
          data: {
            contractId: transfer.toContractId,
            itemDescription: srcItem.itemDescription,
            unit: srcItem.unit,
            quantityTransferredIn: qtyOut,
            avgUnitCost: originalCost,
            quantityBalance,
          },
        });
      } else {
        const physicalQty =
          num(existing.quantityIn) +
          num(existing.quantityTransferredIn) -
          num(existing.quantityConsumed) -
          num(existing.quantityTransferredOut);
        const weightedCost = weightedAvgCost(physicalQty, num(existing.avgUnitCost), qtyOut, originalCost);
        const quantityTransferredIn = num(existing.quantityTransferredIn) + qtyOut;
        const quantityBalance = computeContractInventoryBalance({
          quantityIn: existing.quantityIn,
          quantityTransferredIn,
          quantityConsumed: existing.quantityConsumed,
          quantityTransferredOut: existing.quantityTransferredOut,
          quantityReserved: existing.quantityReserved,
        });
        await tx.contractInventory.update({
          where: { id: existing.id },
          data: {
            quantityTransferredIn,
            avgUnitCost: weightedCost,
            quantityBalance,
          },
        });
      }
    }
  }
}

const transferInclude = {
  lines: {
    include: {
      inventoryItem: { select: { itemDescription: true, unit: true } },
    },
  },
} satisfies Prisma.InventoryTransferInclude;

async function loadTransfers(where: Prisma.InventoryTransferWhereInput) {
  const rows = await prisma.inventoryTransfer.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      ...transferInclude,
      lines: {
        include: {
          inventoryItem: { select: { itemDescription: true, unit: true } },
        },
      },
    },
  });

  const contractIds = [
    ...new Set(rows.flatMap((r) => [r.fromContractId, r.toContractId])),
  ];
  const contracts = await prisma.contract.findMany({
    where: { id: { in: contractIds } },
    include: { project: { select: { projectName: true, projectCode: true } } },
  });
  const contractMap = new Map(contracts.map((c) => [c.id, c]));

  return rows.map((row) => {
    const from = contractMap.get(row.fromContractId);
    const to = contractMap.get(row.toContractId);
    const base = serialize(row) as Record<string, unknown>;
    return {
      ...base,
      fromContractName: from?.contractName,
      fromContractNumber: from?.contractNumber,
      toContractName: to?.contractName,
      toContractNumber: to?.contractNumber,
      fromProjectName: from?.project?.projectName,
      toProjectName: to?.project?.projectName,
      fromProjectCode: from?.project?.projectCode,
      toProjectCode: to?.project?.projectCode,
      lines: row.lines.map((line) => ({
        ...(serialize(line) as Record<string, unknown>),
        itemDescription: line.inventoryItem?.itemDescription,
        unit: line.inventoryItem?.unit,
      })),
    };
  });
}

inventoryTransfersRouter.get(
  '/',
  inventoryPerm,
  asyncHandler(async (req, res) => {
    const assignedIds = getAssignedContractIds(req.user);
    const where: Prisma.InventoryTransferWhereInput = {};

    if (assignedIds !== null) {
      if (assignedIds.length === 0) {
        res.json([]);
        return;
      }
      where.OR = [
        { fromContractId: { in: assignedIds } },
        { toContractId: { in: assignedIds } },
      ];
    }
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.fromContractId) where.fromContractId = String(req.query.fromContractId);
    if (req.query.toContractId) where.toContractId = String(req.query.toContractId);

    res.json(await loadTransfers(where));
  }),
);

inventoryTransfersRouter.post(
  '/',
  requirePermission('costs'),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const body = req.body as {
      fromContractId: string;
      toContractId: string;
      transferDate: string;
      notes?: string;
      lines: { inventoryItemId: number; quantity: number }[];
    };

    if (!body.fromContractId || !body.toContractId || !body.transferDate) {
      res.status(400).json({ error: 'fromContractId, toContractId, transferDate are required' });
      return;
    }
    if (body.fromContractId === body.toContractId) {
      res.status(400).json({ error: 'Cannot transfer to the same contract' });
      return;
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      res.status(400).json({ error: 'At least one line is required' });
      return;
    }

    const assignedIds = getAssignedContractIds(user);
    if (assignedIds !== null && !assignedIds.includes(body.fromContractId)) {
      res.status(403).json({ error: 'Access denied to source contract' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const transferNumber = await generateTransferNumber(tx);
      const transfer = await tx.inventoryTransfer.create({
        data: {
          transferNumber,
          transferDate: body.transferDate,
          fromContractId: body.fromContractId,
          toContractId: body.toContractId,
          status: 'pending_b',
          createdBy: user.id,
          notes: body.notes ?? null,
        },
      });

      for (const [idx, line] of body.lines.entries()) {
        if (!line.inventoryItemId || typeof line.quantity !== 'number' || line.quantity <= 0) {
          throw new Error(`Line ${idx + 1}: inventoryItemId and positive quantity required`);
        }

        const item = await tx.contractInventory.findUnique({ where: { id: line.inventoryItemId } });
        if (!item) throw new Error(`Line ${idx + 1}: inventory item ${line.inventoryItemId} not found`);
        if (item.contractId !== body.fromContractId) {
          throw new Error(`Line ${idx + 1}: item does not belong to source contract`);
        }

        const available = getAvailableQuantity({ quantityBalance: num(item.quantityBalance) });
        if (line.quantity > available + EPSILON) {
          throw new Error(
            `Line ${idx + 1}: insufficient available balance. Available: ${available.toFixed(2)}, Requested: ${line.quantity}`,
          );
        }

        await reserveInventory(tx, line.inventoryItemId, line.quantity);

        const unitCost = num(item.avgUnitCost);
        const totalCost = toMoney(line.quantity * unitCost);

        await tx.inventoryTransferLine.create({
          data: {
            transferId: transfer.id,
            inventoryItemId: line.inventoryItemId,
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
  }),
);

inventoryTransfersRouter.post(
  '/:id/approve-b',
  requirePermission('costs'),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const transferId = Number(req.params.id);

    const result = await prisma.$transaction(async (tx) => {
      const transfer = await tx.inventoryTransfer.findUnique({ where: { id: transferId } });
      if (!transfer) throw new Error('Transfer not found');
      if (transfer.status !== 'pending_b') {
        throw new Error(`Cannot approve-b from status: ${transfer.status}`);
      }

      const assignedIds = getAssignedContractIds(user);
      if (
        user.role !== 'admin' &&
        assignedIds !== null &&
        !assignedIds.includes(transfer.toContractId)
      ) {
        throw new Error('Access denied: you are not accountant of the destination contract');
      }

      const sameProject = await isSameProject(transfer.fromContractId, transfer.toContractId);
      const nextStatus: TransferStatus = sameProject ? 'approved' : 'pending_projects';

      const updated = await tx.inventoryTransfer.update({
        where: { id: transferId },
        data: { status: nextStatus, approvedByB: user.id },
      });

      if (sameProject) {
        await releaseTransferReserves(tx, transferId);
        await applyAccountingEffect(tx, transferId);
      }

      return updated;
    });

    res.json({ ok: true, transfer: serialize(result) });
  }),
);

inventoryTransfersRouter.post(
  '/:id/reject-b',
  requirePermission('costs'),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const transferId = Number(req.params.id);
    const { reason } = (req.body ?? {}) as { reason?: string };

    const result = await prisma.$transaction(async (tx) => {
      const transfer = await tx.inventoryTransfer.findUnique({ where: { id: transferId } });
      if (!transfer) throw new Error('Transfer not found');
      if (transfer.status !== 'pending_b') {
        throw new Error(`Cannot reject-b from status: ${transfer.status}`);
      }

      const assignedIds = getAssignedContractIds(user);
      if (
        user.role !== 'admin' &&
        assignedIds !== null &&
        !assignedIds.includes(transfer.toContractId)
      ) {
        throw new Error('Access denied');
      }

      await releaseTransferReserves(tx, transferId);

      const notesAppend = reason ? `رفض B: ${reason}` : null;
      return tx.inventoryTransfer.update({
        where: { id: transferId },
        data: {
          status: 'rejected_b',
          approvedByB: user.id,
          rejectionReason: reason ?? null,
          notes: notesAppend
            ? transfer.notes
              ? `${transfer.notes} | ${notesAppend}`
              : notesAppend
            : transfer.notes,
        },
      });
    });

    res.json({ ok: true, transfer: serialize(result) });
  }),
);

inventoryTransfersRouter.post(
  '/:id/approve-projects',
  requirePermission('projects'),
  asyncHandler(async (req, res) => {
    const user = req.user!;

    if (user.role !== 'admin' && user.role !== 'projects_manager') {
      res.status(403).json({ error: 'Only projects_manager or admin can approve cross-project transfers' });
      return;
    }

    const transferId = Number(req.params.id);

    const result = await prisma.$transaction(async (tx) => {
      const transfer = await tx.inventoryTransfer.findUnique({ where: { id: transferId } });
      if (!transfer) throw new Error('Transfer not found');
      if (transfer.status !== 'pending_projects') {
        throw new Error(`Cannot approve-projects from status: ${transfer.status}`);
      }

      const updated = await tx.inventoryTransfer.update({
        where: { id: transferId },
        data: { status: 'approved', approvedByProjects: user.id },
      });

      await releaseTransferReserves(tx, transferId);
      await applyAccountingEffect(tx, transferId);

      return updated;
    });

    res.json({ ok: true, transfer: serialize(result) });
  }),
);

inventoryTransfersRouter.post(
  '/:id/reject-projects',
  requirePermission('projects'),
  asyncHandler(async (req, res) => {
    const user = req.user!;

    if (user.role !== 'admin' && user.role !== 'projects_manager') {
      res.status(403).json({ error: 'Only projects_manager or admin can reject cross-project transfers' });
      return;
    }

    const transferId = Number(req.params.id);
    const { reason } = (req.body ?? {}) as { reason?: string };

    const result = await prisma.$transaction(async (tx) => {
      const transfer = await tx.inventoryTransfer.findUnique({ where: { id: transferId } });
      if (!transfer) throw new Error('Transfer not found');
      if (transfer.status !== 'pending_projects') {
        throw new Error(`Cannot reject-projects from status: ${transfer.status}`);
      }

      await releaseTransferReserves(tx, transferId);

      const notesAppend = reason ? `رفض المشاريع: ${reason}` : null;
      return tx.inventoryTransfer.update({
        where: { id: transferId },
        data: {
          status: 'rejected_projects',
          approvedByProjects: user.id,
          rejectionReason: reason ?? null,
          notes: notesAppend
            ? transfer.notes
              ? `${transfer.notes} | ${notesAppend}`
              : notesAppend
            : transfer.notes,
        },
      });
    });

    res.json({ ok: true, transfer: serialize(result) });
  }),
);

inventoryTransfersRouter.post(
  '/:id/cancel',
  requirePermission('costs'),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const transferId = Number(req.params.id);

    const result = await prisma.$transaction(async (tx) => {
      const transfer = await tx.inventoryTransfer.findUnique({ where: { id: transferId } });
      if (!transfer) throw new Error('Transfer not found');
      if (!['pending_b', 'pending_projects'].includes(transfer.status)) {
        throw new Error(`Cannot cancel from status: ${transfer.status}`);
      }

      if (user.role !== 'admin' && transfer.createdBy !== user.id) {
        throw new Error('Only the creator or admin can cancel a transfer');
      }

      await releaseTransferReserves(tx, transferId);

      return tx.inventoryTransfer.update({
        where: { id: transferId },
        data: { status: 'cancelled' },
      });
    });

    res.json({ ok: true, transfer: serialize(result) });
  }),
);

inventoryTransfersRouter.get(
  '/pending-projects',
  requirePermission('projects'),
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'admin' && req.user!.role !== 'projects_manager') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json(await loadTransfers({ status: 'pending_projects' }));
  }),
);
