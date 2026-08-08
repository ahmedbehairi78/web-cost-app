import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth, requireAnyPermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import type { DbClient } from './inventoryHelpers.js';
import { buildConsumptionIssueEntries } from '../accounting/consumptionJournal.js';
import { createTransaction } from '../accounting/journal.js';
import { resolveProjectWarehouseAccount } from '../accounting/projectWarehouseGl.js';
import { validateConsumptionLines } from '../lib/consumptionAllocation.js';
import {
  assertBoqMaterialAllowed,
  assertProjectAccess,
  getAccessibleProjectIds,
  getProjectAvailableQuantity,
  getProjectInventoryByMaterial,
  issueProjectInventory,
  num,
  toMoney,
} from './inventoryHelpers.js';

export const consumptionOrdersRouter = Router();
consumptionOrdersRouter.use(requireAuth);
const inventoryUsePerm = requireAnyPermission('inventory', 'costs', 'transfers');

async function generateOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const cnt = await tx.consumptionOrder.count({
    where: { orderNumber: { startsWith: 'CON-' } },
  });
  const seq = String(cnt + 1).padStart(4, '0');
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `CON-${date}-${seq}`;
}

async function resolveProjectIdForContract(
  contractId: string,
  explicitProjectId?: string,
): Promise<string> {
  const trimmed = String(explicitProjectId || '').trim();
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { projectId: true },
  });
  if (!contract?.projectId) throw new Error('Contract has no linked project');
  if (trimmed && trimmed !== contract.projectId) {
    throw new Error('contractId does not belong to the given project');
  }
  return trimmed || contract.projectId;
}

async function loadOrderWithLines(client: DbClient, orderId: number) {
  const order = await client.consumptionOrder.findUnique({
    where: { id: orderId },
    include: {
      lines: {
        include: {
          materialCategory: { select: { code: true, name: true, unit: true } },
        },
      },
    },
  });
  if (!order) return undefined;

  const boqIds = [...new Set(order.lines.map((l) => l.boqItemId))];
  const boqItems =
    boqIds.length > 0
      ? await client.boqItem.findMany({
          where: { id: { in: boqIds } },
          select: { id: true, itemCode: true, description: true },
        })
      : [];
  const boqMap = new Map(boqItems.map((b) => [b.id, b]));

  const base = serialize(order) as Record<string, unknown>;
  return {
    ...base,
    lines: order.lines.map((line) => {
      const boq = boqMap.get(line.boqItemId);
      const flat = serialize(line) as Record<string, unknown>;
      return {
        ...flat,
        materialCode: line.materialCategory?.code,
        materialName: line.materialCategory?.name,
        materialUnit: line.materialCategory?.unit,
        boqItemCode: boq?.itemCode,
        boqDescription: boq?.description,
      };
    }),
  };
}

consumptionOrdersRouter.get(
  '/',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const accessibleProjectIds = await getAccessibleProjectIds(prisma, req.user);
    const where: Prisma.ConsumptionOrderWhereInput = {};

    if (req.query.contractId) where.contractId = String(req.query.contractId);
    if (req.query.projectId) where.projectId = String(req.query.projectId);
    if (accessibleProjectIds !== null) {
      if (accessibleProjectIds.length === 0) {
        res.json([]);
        return;
      }
      where.projectId = { in: accessibleProjectIds };
    }
    if (req.query.status) where.status = String(req.query.status);

    const rows = await prisma.consumptionOrder.findMany({
      where,
      orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
      include: {
        project: { select: { projectName: true } },
        lines: {
          include: {
            materialCategory: { select: { code: true, name: true, unit: true } },
          },
        },
      },
    });

    const contractIds = [...new Set(rows.map((r) => r.contractId))];
    const contracts = await prisma.contract.findMany({
      where: { id: { in: contractIds } },
      select: { id: true, contractName: true, contractNumber: true },
    });
    const contractMap = new Map(contracts.map((c) => [c.id, c]));

    const boqIds = [...new Set(rows.flatMap((r) => r.lines.map((l) => l.boqItemId)))];
    const boqItems =
      boqIds.length > 0
        ? await prisma.boqItem.findMany({
            where: { id: { in: boqIds } },
            select: { id: true, itemCode: true, description: true },
          })
        : [];
    const boqMap = new Map(boqItems.map((b) => [b.id, b]));

    res.json(
      rows.map((row) => {
        const c = contractMap.get(row.contractId);
        const base = serialize(row) as Record<string, unknown>;
        return {
          ...base,
          contractName: c?.contractName,
          contractNumber: c?.contractNumber,
          projectName: row.project?.projectName,
          lines: row.lines.map((line) => {
            const boq = boqMap.get(line.boqItemId);
            const flat = serialize(line) as Record<string, unknown>;
            return {
              ...flat,
              materialCode: line.materialCategory?.code,
              materialName: line.materialCategory?.name,
              materialUnit: line.materialCategory?.unit,
              boqItemCode: boq?.itemCode,
              boqDescription: boq?.description,
            };
          }),
        };
      }),
    );
  }),
);

consumptionOrdersRouter.post(
  '/',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const body = req.body as {
      contractId: string;
      projectId?: string;
      orderDate: string;
      notes?: string;
      expenseAccountCode?: string;
      expenseAccountName?: string;
      lines: Array<{
        boqItemId: string;
        materialCategoryId: number;
        quantity: number;
      }>;
    };

    if (!body.contractId || !body.orderDate || !Array.isArray(body.lines) || body.lines.length === 0) {
      res.status(400).json({ error: 'contractId, orderDate, and lines are required' });
      return;
    }

    const projectId = await resolveProjectIdForContract(body.contractId, body.projectId);
    await assertProjectAccess(prisma, user, projectId);

    const maxAvailableByMaterial = new Map<number, number>();
    for (const line of body.lines) {
      const materialCategoryId = Number(line.materialCategoryId);
      if (maxAvailableByMaterial.has(materialCategoryId)) continue;
      const inv = await getProjectInventoryByMaterial(prisma, projectId, materialCategoryId);
      maxAvailableByMaterial.set(
        materialCategoryId,
        inv ? getProjectAvailableQuantity(inv) : 0,
      );
    }
    validateConsumptionLines({ lines: body.lines, maxAvailableByMaterial });

    const result = await prisma.$transaction(async (tx) => {
      const orderNumber = await generateOrderNumber(tx);
      const order = await tx.consumptionOrder.create({
        data: {
          orderNumber,
          contractId: body.contractId,
          projectId,
          orderDate: body.orderDate,
          recordedBy: user.id,
          status: 'draft',
          notes: body.notes ?? null,
          expenseAccountCode: body.expenseAccountCode?.trim() || null,
          expenseAccountName: body.expenseAccountName?.trim() || null,
        },
      });

      for (const [idx, line] of body.lines.entries()) {
        await assertBoqMaterialAllowed(tx, line.boqItemId, line.materialCategoryId);

        const inv = await getProjectInventoryByMaterial(tx, projectId, line.materialCategoryId);
        if (!inv) {
          throw new Error(`Line ${idx + 1}: no project warehouse stock for this material`);
        }

        const unitCost = inv.avgUnitCost;
        const totalCost = toMoney(line.quantity * unitCost);
        await tx.consumptionOrderLine.create({
          data: {
            orderId: order.id,
            boqItemId: line.boqItemId,
            materialCategoryId: line.materialCategoryId,
            quantity: line.quantity,
            unitCost,
            totalCost,
          },
        });
      }

      return order.id;
    });

    const loaded = await loadOrderWithLines(prisma, result);
    res.status(201).json({ ok: true, order: loaded });
  }),
);

consumptionOrdersRouter.post(
  '/:id/confirm',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const orderId = Number(req.params.id);

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.consumptionOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new Error('Order not found');
      if (order.status !== 'draft') throw new Error(`Cannot confirm from status: ${order.status}`);

      const projectId =
        String(order.projectId || '').trim() ||
        (await resolveProjectIdForContract(order.contractId));
      await assertProjectAccess(tx, user, projectId);

      if (!order.projectId) {
        await tx.consumptionOrder.update({
          where: { id: orderId },
          data: { projectId },
        });
      }

      const lines = await tx.consumptionOrderLine.findMany({ where: { orderId } });
      if (lines.length === 0) throw new Error('Consumption order has no lines');

      const maxAvailableByMaterial = new Map<number, number>();
      for (const line of lines) {
        const materialCategoryId = Number(line.materialCategoryId);
        if (maxAvailableByMaterial.has(materialCategoryId)) continue;
        const inv = await getProjectInventoryByMaterial(tx, projectId, materialCategoryId);
        maxAvailableByMaterial.set(
          materialCategoryId,
          inv ? getProjectAvailableQuantity(inv) : 0,
        );
      }
      validateConsumptionLines({
        lines: lines.map((line) => ({
          boqItemId: line.boqItemId,
          materialCategoryId: Number(line.materialCategoryId),
          quantity: num(line.quantity),
        })),
        maxAvailableByMaterial,
      });

      const boqIds = [...new Set(lines.map((line) => line.boqItemId))];
      const boqItems =
        boqIds.length > 0
          ? await tx.boqItem.findMany({
              where: { id: { in: boqIds } },
              select: { id: true, itemCode: true, description: true },
            })
          : [];
      const boqMap = new Map(boqItems.map((item) => [item.id, item]));

      let orderTotalCost = 0;

      for (const [idx, line] of lines.entries()) {
        await assertBoqMaterialAllowed(tx, line.boqItemId, line.materialCategoryId);

        const inv = await getProjectInventoryByMaterial(tx, projectId, line.materialCategoryId);
        if (!inv) throw new Error(`Line ${idx + 1}: project inventory not found`);

        await issueProjectInventory(tx, projectId, line.materialCategoryId, num(line.quantity), {
          referenceType: 'consumption_order',
          referenceId: String(orderId),
        });

        await tx.boqActualCost.create({
          data: {
            boqItemId: line.boqItemId,
            contractId: order.contractId,
            materialCategoryId: line.materialCategoryId,
            consumptionOrderId: orderId,
            quantity: line.quantity,
            unitCost: line.unitCost,
            totalCost: line.totalCost,
            costElement: 'materials',
          },
        });

        orderTotalCost = toMoney(orderTotalCost + num(line.totalCost));
      }

      if (orderTotalCost > 0) {
        const warehouse = await resolveProjectWarehouseAccount(tx, projectId);
        if (!warehouse) {
          throw new Error(
            'Warehouse account (127…) is not linked to this project — link inventoryAccountCode on the project or a 127 leaf in chart of accounts',
          );
        }

        const journalEntries = buildConsumptionIssueEntries({
          expenseAccountCode: order.expenseAccountCode,
          expenseAccountName: order.expenseAccountName,
          inventoryAccountCode: warehouse.accountCode,
          inventoryAccountName: warehouse.accountName,
          lines: lines.map((line) => {
            const boq = boqMap.get(line.boqItemId);
            return {
              totalCost: num(line.totalCost),
              boqItemCode: boq?.itemCode,
              boqDescription: boq?.description,
            };
          }),
        });

        await createTransaction(
          {
            date: order.orderDate,
            description:
              String(order.notes || '').trim() ||
              `Warehouse issue — ${order.orderNumber}`,
            reference: order.orderNumber,
            projectId,
            costCenterId: order.contractId,
            entries: journalEntries,
          },
          user.id,
          tx,
        );
      }

      await tx.consumptionOrder.update({
        where: { id: orderId },
        data: { status: 'confirmed' },
      });

      const loaded = await loadOrderWithLines(tx, orderId);
      return {
        ...loaded,
        projectId,
        contractId: order.contractId,
        orderDate: order.orderDate,
        orderNumber: order.orderNumber,
        expenseAccountCode: order.expenseAccountCode,
        expenseAccountName: order.expenseAccountName,
        totalCost: orderTotalCost,
      };
    });

    res.json({ ok: true, order: result });
  }),
);
