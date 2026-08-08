import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';

export const inventoryMaintenanceRouter = Router();

inventoryMaintenanceRouter.use(requireAuth);
inventoryMaintenanceRouter.use(requireRole('admin'));

type PurgeBody = {
  deleteMovements?: boolean;
  resetBalances?: boolean;
  projectId?: string;
};

async function contractIdsForProject(projectId: string): Promise<string[]> {
  const rows = await prisma.contract.findMany({
    where: { projectId, isDeleted: false },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

inventoryMaintenanceRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const [
      projectInventoryRows,
      contractInventoryRows,
      movementLogRows,
      consumptionOrders,
      consumptionOrderLines,
      returnOrders,
      transferOrders,
      purchaseInvoices,
      purchaseInvoiceLines,
      boqActualCosts,
    ] = await Promise.all([
      prisma.projectInventory.count(),
      prisma.contractInventory.count(),
      prisma.projectInventoryMovement.count(),
      prisma.consumptionOrder.count(),
      prisma.consumptionOrderLine.count(),
      prisma.returnOrder.count(),
      prisma.inventoryTransfer.count(),
      prisma.purchaseInvoice.count(),
      prisma.purchaseInvoiceLine.count(),
      prisma.boqActualCost.count(),
    ]);

    res.json(
      serialize({
        projectInventoryRows,
        contractInventoryRows,
        movementLogRows,
        consumptionOrders,
        consumptionOrderLines,
        returnOrders,
        transferOrders,
        purchaseInvoices,
        purchaseInvoiceLines,
        boqActualCosts,
      }),
    );
  }),
);

async function purgeMovementsForProject(projectId: string): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  const contractIds = await contractIdsForProject(projectId);

  deleted.returnOrderLines = (
    await prisma.returnOrderLine.deleteMany({
      where: { returnOrder: { projectId } },
    })
  ).count;
  deleted.returnOrders = (await prisma.returnOrder.deleteMany({ where: { projectId } })).count;

  if (contractIds.length > 0) {
    deleted.boqActualCosts = (
      await prisma.boqActualCost.deleteMany({ where: { contractId: { in: contractIds } } })
    ).count;
  } else {
    deleted.boqActualCosts = 0;
  }

  deleted.consumptionOrderLines = (
    await prisma.consumptionOrderLine.deleteMany({
      where: { order: { projectId } },
    })
  ).count;
  deleted.consumptionOrders = (
    await prisma.consumptionOrder.deleteMany({ where: { projectId } })
  ).count;

  if (contractIds.length > 0) {
    deleted.inventoryTransferLines = (
      await prisma.inventoryTransferLine.deleteMany({
        where: {
          transfer: {
            OR: [
              { fromContractId: { in: contractIds } },
              { toContractId: { in: contractIds } },
            ],
          },
        },
      })
    ).count;
    deleted.inventoryTransfers = (
      await prisma.inventoryTransfer.deleteMany({
        where: {
          OR: [
            { fromContractId: { in: contractIds } },
            { toContractId: { in: contractIds } },
          ],
        },
      })
    ).count;
  } else {
    deleted.inventoryTransferLines = 0;
    deleted.inventoryTransfers = 0;
  }

  deleted.projectInventoryMovements = (
    await prisma.projectInventoryMovement.deleteMany({ where: { projectId } })
  ).count;

  const invoiceIds = (
    await prisma.purchaseInvoice.findMany({
      where: { projectId },
      select: { invoiceId: true },
    })
  ).map((r) => r.invoiceId);

  if (invoiceIds.length > 0) {
    const lineIds = (
      await prisma.purchaseInvoiceLine.findMany({
        where: { invoiceId: { in: invoiceIds } },
        select: { id: true },
      })
    ).map((r) => r.id);

    if (lineIds.length > 0) {
      deleted.purchaseInvoiceAllocations = (
        await prisma.purchaseInvoiceAllocation.deleteMany({
          where: { lineId: { in: lineIds } },
        })
      ).count;
    } else {
      deleted.purchaseInvoiceAllocations = 0;
    }

    deleted.purchaseInvoiceLines = (
      await prisma.purchaseInvoiceLine.deleteMany({
        where: { invoiceId: { in: invoiceIds } },
      })
    ).count;
  } else {
    deleted.purchaseInvoiceAllocations = 0;
    deleted.purchaseInvoiceLines = 0;
  }

  deleted.purchaseInvoices = (
    await prisma.purchaseInvoice.deleteMany({ where: { projectId } })
  ).count;

  return deleted;
}

async function purgeMovementsAll(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  deleted.returnOrderLines = (await prisma.returnOrderLine.deleteMany()).count;
  deleted.returnOrders = (await prisma.returnOrder.deleteMany()).count;
  deleted.boqActualCosts = (await prisma.boqActualCost.deleteMany()).count;
  deleted.consumptionOrderLines = (await prisma.consumptionOrderLine.deleteMany()).count;
  deleted.consumptionOrders = (await prisma.consumptionOrder.deleteMany()).count;
  deleted.inventoryTransferLines = (await prisma.inventoryTransferLine.deleteMany()).count;
  deleted.inventoryTransfers = (await prisma.inventoryTransfer.deleteMany()).count;
  deleted.projectInventoryMovements = (await prisma.projectInventoryMovement.deleteMany()).count;
  deleted.purchaseInvoiceAllocations = (await prisma.purchaseInvoiceAllocation.deleteMany()).count;
  deleted.purchaseInvoiceLines = (await prisma.purchaseInvoiceLine.deleteMany()).count;
  deleted.purchaseInvoices = (await prisma.purchaseInvoice.deleteMany()).count;
  return deleted;
}

async function resetBalancesForProject(projectId: string): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  deleted.projectInventory = (
    await prisma.projectInventory.deleteMany({ where: { projectId } })
  ).count;

  const contractIds = await contractIdsForProject(projectId);
  if (contractIds.length > 0) {
    deleted.contractInventory = (
      await prisma.contractInventory.deleteMany({
        where: { contractId: { in: contractIds } },
      })
    ).count;
  } else {
    deleted.contractInventory = 0;
  }
  return deleted;
}

async function resetBalancesAll(): Promise<Record<string, number>> {
  return {
    projectInventory: (await prisma.projectInventory.deleteMany()).count,
    contractInventory: (await prisma.contractInventory.deleteMany()).count,
  };
}

inventoryMaintenanceRouter.post(
  '/purge',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as PurgeBody;
    const deleteMovements = body.deleteMovements === true;
    const resetBalances = body.resetBalances === true;
    if (!deleteMovements && !resetBalances) {
      res.status(400).json({ error: 'Select at least one action: deleteMovements or resetBalances' });
      return;
    }

    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
    }

    const deleted: Record<string, number> = {};
    await prisma.$transaction(async () => {
      if (deleteMovements) {
        Object.assign(
          deleted,
          projectId ? await purgeMovementsForProject(projectId) : await purgeMovementsAll(),
        );
      }
      if (resetBalances) {
        Object.assign(
          deleted,
          projectId ? await resetBalancesForProject(projectId) : await resetBalancesAll(),
        );
      }
    });

    res.json(
      serialize({
        ok: true,
        projectId: projectId || null,
        deleteMovements,
        resetBalances,
        deleted,
      }),
    );
  }),
);
