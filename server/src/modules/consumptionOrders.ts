import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth, requireAnyPermission } from '../middleware/auth.js';
import { withIdempotency } from '../middleware/idempotency.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import type { DbClient } from './inventoryHelpers.js';
import { buildConsumptionIssueEntries } from '../accounting/consumptionJournal.js';
import { createTransaction } from '../accounting/journal.js';
import { resolveProjectWarehouseAccount } from '../accounting/projectWarehouseGl.js';
import { validateConsumptionLines } from '../lib/consumptionAllocation.js';
import { businessTodayCompact } from '../lib/businessCalendar.js';
import {
  assertBoqMaterialAllowed,
  assertProjectAccess,
  consumptionTouchesUnpriced,
  getAccessibleProjectIds,
  getProjectAvailableQuantity,
  getProjectInventoryByMaterial,
  issueProjectInventory,
  num,
  releaseProjectInventoryReserve,
  reserveProjectInventory,
  toMoney,
  EPSILON,
} from './inventoryHelpers.js';
import {
  moduleAccess,
  normalizeUserPermissions,
} from '../permissions.js';
import type { Request, Response, NextFunction } from 'express';
export const consumptionOrdersRouter = Router();
consumptionOrdersRouter.use(requireAuth);
consumptionOrdersRouter.use(withIdempotency());
const inventoryUsePerm = requireAnyPermission('inventory', 'costs', 'transfers');

function canApproveCost(user: NonNullable<Request['user']>): boolean {
  return moduleAccess(normalizeUserPermissions(user.permissions), 'costs').edit === true;
}

function requireCostApprover(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!canApproveCost(req.user)) {
    res.status(403).json({ error: 'لا صلاحية لاعتماد تكلفة الصرف' });
    return;
  }
  next();
}
async function generateOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const cnt = await tx.consumptionOrder.count({
    where: { orderNumber: { startsWith: 'CON-' } },
  });
  const seq = String(cnt + 1).padStart(4, '0');
  const date = businessTodayCompact();
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
          select: { id: true, itemCode: true, description: true, chapterName: true, chapterCode: true },
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
        chapterName: boq?.chapterName || boq?.chapterCode || undefined,
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
            select: { id: true, itemCode: true, description: true, chapterName: true, chapterCode: true },
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
              chapterName: boq?.chapterName || boq?.chapterCode || undefined,
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
        expenseAccountCode?: string;
        expenseAccountName?: string;
      }>;
    };

    if (!body.contractId || !body.orderDate || !Array.isArray(body.lines) || body.lines.length === 0) {
      res.status(400).json({ error: 'contractId, orderDate, and lines are required' });
      return;
    }

    const projectId = await resolveProjectIdForContract(body.contractId, body.projectId);
    await assertProjectAccess(prisma, user, projectId);

    const maxAvailableByMaterial = new Map<number, number>();
    const invByMaterial = new Map<number, NonNullable<Awaited<ReturnType<typeof getProjectInventoryByMaterial>>>>();
    for (const line of body.lines) {
      const materialCategoryId = Number(line.materialCategoryId);
      if (maxAvailableByMaterial.has(materialCategoryId)) continue;
      const inv = await getProjectInventoryByMaterial(prisma, projectId, materialCategoryId);
      if (inv) invByMaterial.set(materialCategoryId, inv);
      maxAvailableByMaterial.set(
        materialCategoryId,
        inv ? getProjectAvailableQuantity(inv) : 0,
      );
    }
    validateConsumptionLines({ lines: body.lines, maxAvailableByMaterial });

    const qtyByMaterial = new Map<number, number>();
    for (const line of body.lines) {
      const mid = Number(line.materialCategoryId);
      qtyByMaterial.set(mid, toMoney((qtyByMaterial.get(mid) ?? 0) + Number(line.quantity)));
    }

    let requiresCostApproval = false;
    for (const [mid, qty] of qtyByMaterial) {
      const inv = invByMaterial.get(mid);
      if (!inv) continue;
      if (consumptionTouchesUnpriced(inv, qty)) {
        requiresCostApproval = true;
        break;
      }
    }

    const headerExpenseCode = body.expenseAccountCode?.trim()
      || body.lines.map((l) => l.expenseAccountCode?.trim()).find(Boolean)
      || null;
    const headerExpenseName = body.expenseAccountName?.trim()
      || body.lines.map((l) => l.expenseAccountName?.trim()).find(Boolean)
      || null;

    const result = await prisma.$transaction(async (tx) => {
      const orderNumber = await generateOrderNumber(tx);
      const order = await tx.consumptionOrder.create({
        data: {
          orderNumber,
          contractId: body.contractId,
          projectId,
          orderDate: body.orderDate,
          recordedBy: user.id,
          status: requiresCostApproval ? 'pending_cost' : 'draft',
          requiresCostApproval,
          notes: body.notes ?? null,
          expenseAccountCode: headerExpenseCode,
          expenseAccountName: headerExpenseName,
        },
      });

      for (const [idx, line] of body.lines.entries()) {
        await assertBoqMaterialAllowed(tx, line.boqItemId, line.materialCategoryId);

        const inv = await getProjectInventoryByMaterial(tx, projectId, line.materialCategoryId);
        if (!inv) {
          throw new Error(`Line ${idx + 1}: no project warehouse stock for this material`);
        }

        const lineExpenseCode = line.expenseAccountCode?.trim() || headerExpenseCode || null;
        const lineExpenseName = line.expenseAccountName?.trim() || headerExpenseName || null;
        if (!lineExpenseCode) {
          throw new Error(`Line ${idx + 1}: expenseAccountCode is required`);
        }

        const unitCost = requiresCostApproval ? 0 : inv.avgUnitCost;
        const totalCost = toMoney(line.quantity * unitCost);
        await tx.consumptionOrderLine.create({
          data: {
            orderId: order.id,
            boqItemId: line.boqItemId,
            materialCategoryId: line.materialCategoryId,
            quantity: line.quantity,
            unitCost,
            totalCost,
            expenseAccountCode: lineExpenseCode,
            expenseAccountName: lineExpenseName,
          },
        });
      }

      if (requiresCostApproval) {
        for (const [mid, qty] of qtyByMaterial) {
          const inv = await getProjectInventoryByMaterial(tx, projectId, mid);
          if (!inv) throw new Error(`No project warehouse stock for material ${mid}`);
          await reserveProjectInventory(tx, inv.id, qty);
        }
      }

      return order.id;
    });

    const loaded = await loadOrderWithLines(prisma, result);
    const autoConfirm = Boolean((body as { autoConfirm?: boolean }).autoConfirm);
    const loadedStatus = loaded ? String((loaded as { status?: string }).status ?? '') : '';
    if (
      autoConfirm
      && loaded
      && loadedStatus === 'draft'
      && !requiresCostApproval
    ) {
      // Continue below via internal confirm — keep one HTTP op for offline queue.
      req.params = { ...req.params, id: String(result) };
      // Fall through: invoke confirm handler body by posting to same flow
      const confirmResult = await prisma.$transaction(async (tx) => {
        const orderId = result;
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
                expenseAccountCode: line.expenseAccountCode,
                expenseAccountName: line.expenseAccountName,
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

        const confirmed = await loadOrderWithLines(tx, orderId);
        return {
          ...confirmed,
          projectId,
          contractId: order.contractId,
          orderDate: order.orderDate,
          orderNumber: order.orderNumber,
          expenseAccountCode: order.expenseAccountCode,
          expenseAccountName: order.expenseAccountName,
          totalCost: orderTotalCost,
        };
      });
      res.status(201).json({ ok: true, order: confirmResult });
      return;
    }

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
      if (order.status === 'pending_cost') {
        throw new Error('Cannot confirm pending_cost order — use approve-cost after pricing');
      }
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
              expenseAccountCode: line.expenseAccountCode,
              expenseAccountName: line.expenseAccountName,
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

/** Finalize a pending_cost order after warehouse receipts are priced. */
consumptionOrdersRouter.post(
  '/:id/approve-cost',
  requireCostApprover,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const orderId = Number(req.params.id);

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.consumptionOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new Error('Order not found');
      if (order.status !== 'pending_cost') {
        throw new Error(`Cannot approve-cost from status: ${order.status}`);
      }

      const projectId =
        String(order.projectId || '').trim() ||
        (await resolveProjectIdForContract(order.contractId));
      await assertProjectAccess(tx, user, projectId);

      const lines = await tx.consumptionOrderLine.findMany({ where: { orderId } });
      if (lines.length === 0) throw new Error('Consumption order has no lines');

      const qtyByMaterial = new Map<number, number>();
      for (const line of lines) {
        const mid = Number(line.materialCategoryId);
        qtyByMaterial.set(mid, toMoney((qtyByMaterial.get(mid) ?? 0) + num(line.quantity)));
      }

      for (const [mid, qty] of qtyByMaterial) {
        const inv = await getProjectInventoryByMaterial(tx, projectId, mid);
        if (!inv) throw new Error(`Project inventory not found for material ${mid}`);
        if (num(inv.avgUnitCost) <= EPSILON) {
          throw new Error(
            `Material ${mid} still has no approved unit cost — approve warehouse receipt first`,
          );
        }
        // Treat reserved qty for this order as available again for the priced check.
        const availableWithReserve = toMoney(inv.quantityBalance + num(inv.quantityReserved));
        const pricedAvail = Math.max(
          0,
          toMoney(availableWithReserve - num(inv.quantityUnpriced)),
        );
        if (qty > pricedAvail + EPSILON) {
          throw new Error(
            `Material ${mid} still has unpriced stock covering this issue — approve receipts first`,
          );
        }
        await releaseProjectInventoryReserve(tx, inv.id, qty);

        const fresh = await getProjectInventoryByMaterial(tx, projectId, mid);
        const avg = fresh?.avgUnitCost ?? 0;
        for (const line of lines.filter((l) => Number(l.materialCategoryId) === mid)) {
          const totalCost = toMoney(num(line.quantity) * avg);
          await tx.consumptionOrderLine.update({
            where: { id: line.id },
            data: { unitCost: avg, totalCost },
          });
        }
      }

      // Mark as draft so the shared confirm path can run — then execute issue inline
      await tx.consumptionOrder.update({
        where: { id: orderId },
        data: { status: 'draft', requiresCostApproval: false },
      });

      const refreshedLines = await tx.consumptionOrderLine.findMany({ where: { orderId } });

      const maxAvailableByMaterial = new Map<number, number>();
      for (const line of refreshedLines) {
        const materialCategoryId = Number(line.materialCategoryId);
        if (maxAvailableByMaterial.has(materialCategoryId)) continue;
        const inv = await getProjectInventoryByMaterial(tx, projectId, materialCategoryId);
        maxAvailableByMaterial.set(
          materialCategoryId,
          inv ? getProjectAvailableQuantity(inv) : 0,
        );
      }
      validateConsumptionLines({
        lines: refreshedLines.map((line) => ({
          boqItemId: line.boqItemId,
          materialCategoryId: Number(line.materialCategoryId),
          quantity: num(line.quantity),
        })),
        maxAvailableByMaterial,
      });

      const boqIds = [...new Set(refreshedLines.map((line) => line.boqItemId))];
      const boqItems =
        boqIds.length > 0
          ? await tx.boqItem.findMany({
              where: { id: { in: boqIds } },
              select: { id: true, itemCode: true, description: true },
            })
          : [];
      const boqMap = new Map(boqItems.map((item) => [item.id, item]));

      let orderTotalCost = 0;

      for (const [idx, line] of refreshedLines.entries()) {
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

        const headerOrder = await tx.consumptionOrder.findUnique({ where: { id: orderId } });
        const journalEntries = buildConsumptionIssueEntries({
          expenseAccountCode: headerOrder?.expenseAccountCode,
          expenseAccountName: headerOrder?.expenseAccountName,
          inventoryAccountCode: warehouse.accountCode,
          inventoryAccountName: warehouse.accountName,
          lines: refreshedLines.map((line) => {
            const boq = boqMap.get(line.boqItemId);
            return {
              totalCost: num(line.totalCost),
              boqItemCode: boq?.itemCode,
              boqDescription: boq?.description,
              expenseAccountCode: line.expenseAccountCode,
              expenseAccountName: line.expenseAccountName,
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
        totalCost: orderTotalCost,
      };
    });

    res.json({ ok: true, order: result });
  }),
);
