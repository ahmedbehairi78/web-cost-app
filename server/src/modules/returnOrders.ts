import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth, requireAnyPermission } from '../middleware/auth.js';
import { withIdempotency } from '../middleware/idempotency.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import type { DbClient } from './inventoryHelpers.js';
import { createTransaction } from '../accounting/journal.js';
import { resolveProjectWarehouseAccount } from '../accounting/projectWarehouseGl.js';
import { buildReturnToWarehouseEntries } from '../accounting/returnInventoryJournal.js';
import { AccountCodes } from '../accounting/accountCodes.js';
import {
  EPSILON,
  assertContractAccess,
  assertProjectAccess,
  getAssignedContractIds,
  getReturnedQuantityForConsumptionLine,
  getReturnableQuantityForConsumptionLine,
  num,
  returnProjectInventory,
  toMoney,
} from './inventoryHelpers.js';

export const returnOrdersRouter = Router();
returnOrdersRouter.use(requireAuth);
returnOrdersRouter.use(withIdempotency());
const inventoryUsePerm = requireAnyPermission('inventory', 'costs', 'transfers');

async function generateReturnNumber(tx: Prisma.TransactionClient): Promise<string> {
  const cnt = await tx.returnOrder.count({
    where: { returnNumber: { startsWith: 'RET-' } },
  });
  const seq = String(cnt + 1).padStart(4, '0');
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `RET-${date}-${seq}`;
}

async function resolveProjectIdForContract(
  contractId: string,
  explicitProjectId?: string,
): Promise<string> {
  const trimmed = String(explicitProjectId || '').trim();
  if (trimmed) return trimmed;
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { projectId: true },
  });
  if (!contract?.projectId) throw new Error('Contract has no linked project');
  return contract.projectId;
}

async function loadReturnOrderWithLines(client: DbClient, returnOrderId: number) {
  const order = await client.returnOrder.findUnique({
    where: { id: returnOrderId },
    include: {
      lines: {
        include: {
          materialCategory: { select: { code: true, name: true, unit: true } },
          consumptionOrderLine: {
            include: { order: { select: { orderNumber: true } } },
          },
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
        consumptionOrderNumber: line.consumptionOrderLine?.order?.orderNumber,
      };
    }),
  };
}

async function resolveExpenseFromConsumptionLine(
  client: DbClient,
  consumptionOrderLineId: number,
): Promise<{
  expenseAccountCode: string | null;
  expenseAccountName: string | null;
  consumptionOrderNumber: string;
} | null> {
  const line = await client.consumptionOrderLine.findUnique({
    where: { id: consumptionOrderLineId },
    include: { order: { select: { expenseAccountCode: true, expenseAccountName: true, orderNumber: true } } },
  });
  if (!line?.order) return null;
  const lineCode = String(line.expenseAccountCode ?? '').trim();
  const lineName = String(line.expenseAccountName ?? '').trim();
  const headerCode = String(line.order.expenseAccountCode ?? '').trim();
  const headerName = String(line.order.expenseAccountName ?? '').trim();
  return {
    expenseAccountCode: lineCode || headerCode || null,
    expenseAccountName: lineName || headerName || null,
    consumptionOrderNumber: line.order.orderNumber,
  };
}

async function loadConsumptionLineContext(client: DbClient, consumptionOrderLineId: number) {
  const line = await client.consumptionOrderLine.findUnique({
    where: { id: consumptionOrderLineId },
    include: {
      order: {
        include: {
          project: { select: { projectName: true } },
        },
      },
      materialCategory: { select: { code: true, name: true, unit: true } },
    },
  });
  if (!line) return undefined;

  const contract = await client.contract.findUnique({
    where: { id: line.order.contractId },
    select: { contractName: true, contractNumber: true },
  });
  const boq = await client.boqItem.findUnique({
    where: { id: line.boqItemId },
    select: { itemCode: true, description: true },
  });

  const { issued, returned, returnable } = await getReturnableQuantityForConsumptionLine(
    client,
    consumptionOrderLineId,
  );
  const expense = await resolveExpenseFromConsumptionLine(client, consumptionOrderLineId);
  const base = serialize({
    ...line,
    consumptionOrderId: line.orderId,
    orderNumber: line.order.orderNumber,
    orderDate: line.order.orderDate,
    orderStatus: line.order.status,
    contractId: line.order.contractId,
    projectId: line.order.projectId,
    expenseAccountCode: expense?.expenseAccountCode ?? line.order.expenseAccountCode,
    expenseAccountName: expense?.expenseAccountName ?? line.order.expenseAccountName,
    contractName: contract?.contractName,
    contractNumber: contract?.contractNumber,
    projectName: line.order.project?.projectName,
    materialCode: line.materialCategory?.code,
    materialName: line.materialCategory?.name,
    materialUnit: line.materialCategory?.unit,
    boqItemCode: boq?.itemCode,
    boqDescription: boq?.description,
  }) as Record<string, unknown>;

  return {
    ...base,
    contractId: String(base.contractId ?? ''),
    projectId: base.projectId != null ? String(base.projectId) : undefined,
    expenseAccountCode: expense?.expenseAccountCode ?? null,
    expenseAccountName: expense?.expenseAccountName ?? null,
    consumptionOrderNumber: expense?.consumptionOrderNumber ?? base.orderNumber,
    issuedQuantity: issued,
    returnedQuantity: returned,
    returnableQuantity: returnable,
  };
}

returnOrdersRouter.get(
  '/returnable/:consumptionOrderLineId',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const lineId = Number(req.params.consumptionOrderLineId);
    if (!Number.isFinite(lineId)) {
      res.status(400).json({ error: 'Invalid consumption order line id' });
      return;
    }

    const ctx = await loadConsumptionLineContext(prisma, lineId);
    if (!ctx) {
      res.status(404).json({ error: 'Consumption line not found' });
      return;
    }

    assertContractAccess(req.user!, String(ctx.contractId));
    const projectId =
      String(ctx.projectId || '').trim() ||
      (await resolveProjectIdForContract(String(ctx.contractId)));
    await assertProjectAccess(prisma, req.user!, projectId);

    res.json({ ok: true, line: ctx });
  }),
);

returnOrdersRouter.get(
  '/',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const assignedIds = getAssignedContractIds(req.user);
    const where: Prisma.ReturnOrderWhereInput = {};

    if (req.query.contractId) where.contractId = String(req.query.contractId);
    if (req.query.projectId) where.projectId = String(req.query.projectId);
    if (assignedIds !== null && assignedIds.length > 0) {
      where.contractId = { in: assignedIds };
    } else if (assignedIds !== null && assignedIds.length === 0) {
      res.json([]);
      return;
    }
    if (req.query.status) where.status = String(req.query.status);

    const rows = await prisma.returnOrder.findMany({
      where,
      orderBy: [{ returnDate: 'desc' }, { id: 'desc' }],
      include: {
        project: { select: { projectName: true } },
      },
    });

    const contractIds = [...new Set(rows.map((r) => r.contractId))];
    const contracts = await prisma.contract.findMany({
      where: { id: { in: contractIds } },
      select: { id: true, contractName: true, contractNumber: true },
    });
    const contractMap = new Map(contracts.map((c) => [c.id, c]));

    const withLines = await Promise.all(
      rows.map(async (row) => {
        const loaded = await loadReturnOrderWithLines(prisma, row.id);
        const c = contractMap.get(row.contractId);
        return {
          ...loaded,
          contractName: c?.contractName,
          contractNumber: c?.contractNumber,
          projectName: row.project?.projectName,
        };
      }),
    );

    res.json(withLines);
  }),
);

returnOrdersRouter.post(
  '/',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const body = req.body as {
      contractId: string;
      projectId?: string;
      returnDate: string;
      notes?: string;
      lines: Array<{
        consumptionOrderLineId: number;
        quantity: number;
        reason?: string;
      }>;
    };

    if (!body.contractId || !body.returnDate || !Array.isArray(body.lines) || body.lines.length === 0) {
      res.status(400).json({ error: 'contractId, returnDate, and lines are required' });
      return;
    }

    assertContractAccess(user, body.contractId);
    const projectId = await resolveProjectIdForContract(body.contractId, body.projectId);
    await assertProjectAccess(prisma, user, projectId);

    const returnOrderId = await prisma.$transaction(async (tx) => {
      const returnNumber = await generateReturnNumber(tx);
      const order = await tx.returnOrder.create({
        data: {
          returnNumber,
          projectId,
          contractId: body.contractId,
          returnDate: body.returnDate,
          recordedBy: user.id,
          status: 'draft',
          notes: body.notes ?? null,
        },
      });

      for (const [idx, line] of body.lines.entries()) {
        if (!line.consumptionOrderLineId || !(line.quantity > 0)) {
          throw new Error(`Line ${idx + 1}: consumptionOrderLineId and positive quantity required`);
        }

        const col = await tx.consumptionOrderLine.findUnique({
          where: { id: line.consumptionOrderLineId },
          include: { order: true },
        });
        if (!col) throw new Error(`Line ${idx + 1}: consumption line not found`);
        if (col.order.status !== 'confirmed') {
          throw new Error(`Line ${idx + 1}: consumption order must be confirmed before return`);
        }
        if (col.order.contractId !== body.contractId) {
          throw new Error(`Line ${idx + 1}: consumption line belongs to a different contract`);
        }

        const lineProjectId =
          String(col.order.projectId || '').trim() ||
          (await resolveProjectIdForContract(col.order.contractId));
        if (lineProjectId !== projectId) {
          throw new Error(`Line ${idx + 1}: consumption line belongs to a different project`);
        }

        const alreadyReturned = await getReturnedQuantityForConsumptionLine(tx, line.consumptionOrderLineId);
        const returnable = num(col.quantity) - alreadyReturned;
        if (line.quantity > returnable + EPSILON) {
          throw new Error(
            `Line ${idx + 1}: return quantity exceeds returnable balance (${returnable.toFixed(2)})`,
          );
        }

        const unitCost = num(col.unitCost);
        const totalCost = toMoney(line.quantity * unitCost);
        await tx.returnOrderLine.create({
          data: {
            returnOrderId: order.id,
            consumptionOrderLineId: line.consumptionOrderLineId,
            materialCategoryId: col.materialCategoryId,
            boqItemId: col.boqItemId,
            quantity: line.quantity,
            unitCost,
            totalCost,
            reason: line.reason ?? null,
          },
        });
      }

      return order.id;
    });

    const result = await loadReturnOrderWithLines(prisma, returnOrderId);
    res.status(201).json({ ok: true, order: result });
  }),
);

returnOrdersRouter.post(
  '/:id/confirm',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const returnOrderId = Number(req.params.id);

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.returnOrder.findUnique({ where: { id: returnOrderId } });
      if (!order) throw new Error('Return order not found');
      if (order.status !== 'draft') throw new Error(`Cannot confirm from status: ${order.status}`);

      assertContractAccess(user, order.contractId);
      await assertProjectAccess(tx, user, order.projectId);

      const lines = await tx.returnOrderLine.findMany({ where: { returnOrderId } });
      if (lines.length === 0) throw new Error('Return order has no lines');

      let orderTotalCost = 0;

      for (const [idx, line] of lines.entries()) {
        const col = await tx.consumptionOrderLine.findUnique({
          where: { id: line.consumptionOrderLineId },
          include: { order: true },
        });
        if (!col || col.order.status !== 'confirmed') {
          throw new Error(`Line ${idx + 1}: linked consumption order is not confirmed`);
        }

        const alreadyReturned = await getReturnedQuantityForConsumptionLine(
          tx,
          line.consumptionOrderLineId,
          returnOrderId,
        );
        const returnable = num(col.quantity) - alreadyReturned;
        if (num(line.quantity) > returnable + EPSILON) {
          throw new Error(`Line ${idx + 1}: return quantity exceeds returnable balance at confirmation`);
        }

        await returnProjectInventory(tx, order.projectId, line.materialCategoryId, num(line.quantity), {
          referenceType: 'return_order',
          referenceId: String(returnOrderId),
        });

        await tx.boqActualCost.create({
          data: {
            boqItemId: line.boqItemId,
            contractId: order.contractId,
            materialCategoryId: line.materialCategoryId,
            consumptionOrderId: col.orderId,
            quantity: -num(line.quantity),
            unitCost: line.unitCost,
            totalCost: -num(line.totalCost),
            costElement: 'materials',
          },
        });

        orderTotalCost = toMoney(orderTotalCost + num(line.totalCost));
      }

      await tx.returnOrder.update({
        where: { id: returnOrderId },
        data: { status: 'confirmed' },
      });

      if (orderTotalCost > 0) {
        const warehouse = await resolveProjectWarehouseAccount(tx, order.projectId);
        if (!warehouse) {
          throw new Error(
            'حساب مخزن المشروع (127…) غير مربوط — اربط المخزن من تبويب الرصيد قبل تأكيد الإرجاع',
          );
        }

        const expenseGroups: Array<{
          expenseAccountCode: string;
          expenseAccountName: string;
          totalCost: number;
        }> = [];

        for (const line of lines) {
          const expense = await resolveExpenseFromConsumptionLine(tx, line.consumptionOrderLineId);
          expenseGroups.push({
            expenseAccountCode:
              expense?.expenseAccountCode?.trim() || AccountCodes.EXPENSE_MATERIALS,
            expenseAccountName: expense?.expenseAccountName?.trim() || 'مواد البناء',
            totalCost: num(line.totalCost),
          });
        }

        const journalEntries = buildReturnToWarehouseEntries({
          inventoryAccountCode: warehouse.accountCode,
          inventoryAccountName: warehouse.accountName,
          expenseGroups,
        });

        await createTransaction(
          {
            date: order.returnDate,
            description:
              String(order.notes || '').trim() || `إرجاع مخزن — ${order.returnNumber}`,
            reference: order.returnNumber,
            projectId: order.projectId,
            costCenterId: order.contractId,
            entries: journalEntries,
          },
          user.id,
          tx,
        );
      }

      const expense = await resolveExpenseFromConsumptionLine(tx, lines[0]!.consumptionOrderLineId);
      const loaded = await loadReturnOrderWithLines(tx, returnOrderId);

      return {
        ...loaded,
        projectId: order.projectId,
        contractId: order.contractId,
        returnDate: order.returnDate,
        totalCost: orderTotalCost,
        expenseAccountCode: expense?.expenseAccountCode ?? null,
        expenseAccountName: expense?.expenseAccountName ?? null,
        consumptionOrderNumber: expense?.consumptionOrderNumber ?? null,
        journalPosted: orderTotalCost > 0,
      };
    });

    res.json({ ok: true, order: result });
  }),
);
