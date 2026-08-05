import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth, requireAnyPermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { projectInventoryTransfersRouter } from './projectInventoryTransfers.js';
import { AccountCodes } from '../accounting/accountCodes.js';
import { ensureMissingCoaAccounts } from '../accounting/ensureCoaSeed.js';
import {
  buildOpeningInventoryReference,
  postOpeningInventoryJournal,
} from '../accounting/openingInventoryJournal.js';
import { resolveProjectWarehouseAccount } from '../accounting/projectWarehouseGl.js';
import { roundMoney } from '../lib/money.js';
import { moduleAccess } from '../permissions.js';
import {
  EPSILON,
  assertProjectAccess,
  computeContractInventoryBalance,
  getAssignedContractIds,
  getAvailableQuantity,
  getInventoryByContractMaterial,
  getProjectAvailableQuantity,
  getProjectInventoryByMaterial,
  num,
  toMoney,
  upsertProjectInventoryReceipt,
} from './inventoryHelpers.js';

function canImportOpeningBalances(user: Express.Request['user']): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'projects_manager') return true;
  return moduleAccess(user.permissions, 'inventory').create === true;
}

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

const inventoryUsePerm = requireAnyPermission('inventory', 'costs', 'transfers');

inventoryRouter.use('/project-transfers', projectInventoryTransfersRouter);

async function userHasProjectAccess(user: Express.Request['user'], projectId: string): Promise<boolean> {
  const assignedIds = getAssignedContractIds(user);
  if (assignedIds === null) return true;
  if (assignedIds.length === 0) return false;
  const row = await prisma.contract.findFirst({
    where: { projectId, id: { in: assignedIds } },
    select: { id: true },
  });
  return Boolean(row);
}

function mapContractInventoryRow(
  row: Prisma.ContractInventoryGetPayload<{ include: { materialCategory: true } }>,
  contract?: { contractName: string; contractNumber: string; project?: { projectName: string; projectCode: string } | null },
) {
  const obj = serialize(row) as Record<string, unknown>;
  return {
    ...obj,
    contractName: contract?.contractName,
    contractNumber: contract?.contractNumber,
    projectName: contract?.project?.projectName,
    projectCode: contract?.project?.projectCode,
    materialCode: row.materialCategory?.code,
    materialName: row.materialCategory?.name,
    unitCost: obj.avgUnitCost ?? obj.unitCost,
    quantityAvailable: num(row.quantityBalance),
  };
}

inventoryRouter.get(
  '/',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const assignedIds = getAssignedContractIds(req.user);
    const where: Prisma.ContractInventoryWhereInput = {};

    if (req.query.contractId) where.contractId = String(req.query.contractId);
    if (assignedIds !== null) {
      if (assignedIds.length === 0) {
        res.json([]);
        return;
      }
      where.contractId = req.query.contractId
        ? String(req.query.contractId)
        : { in: assignedIds };
      if (req.query.contractId && !assignedIds.includes(String(req.query.contractId))) {
        res.status(403).json({ error: 'Access denied to this contract' });
        return;
      }
    }

    const rows = await prisma.contractInventory.findMany({
      where,
      include: { materialCategory: true },
      orderBy: { id: 'asc' },
    });

    const contractIds = [...new Set(rows.map((r) => r.contractId))];
    const contracts = await prisma.contract.findMany({
      where: { id: { in: contractIds } },
      include: { project: { select: { projectName: true, projectCode: true } } },
    });
    const contractMap = new Map(contracts.map((c) => [c.id, c]));

    res.json(
      rows
        .map((row) => mapContractInventoryRow(row, contractMap.get(row.contractId)))
        .sort((a, b) => {
          const ra = a as Record<string, unknown>;
          const rb = b as Record<string, unknown>;
          const pa = String(ra.projectCode ?? '');
          const pb = String(rb.projectCode ?? '');
          if (pa !== pb) return pa.localeCompare(pb);
          const ca = String(ra.contractNumber ?? '');
          const cb = String(rb.contractNumber ?? '');
          if (ca !== cb) return ca.localeCompare(cb);
          return String(ra.materialCode ?? ra.itemDescription ?? '').localeCompare(
            String(rb.materialCode ?? rb.itemDescription ?? ''),
          );
        }),
    );
  }),
);

inventoryRouter.get(
  '/project/:projectId/summary',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    if (!(await userHasProjectAccess(req.user, projectId))) {
      res.status(403).json({ error: 'Access denied to this project' });
      return;
    }

    const rows = await prisma.projectInventory.findMany({
      where: { projectId },
      include: { materialCategory: true },
      orderBy: { id: 'asc' },
    });

    const items = rows.map((row) => {
      const obj = serialize(row) as Record<string, unknown>;
      const balance = num(row.quantityBalance);
      return {
        ...obj,
        projectId: obj.projectId ?? projectId,
        materialCode: row.materialCategory?.code,
        materialName: row.materialCategory?.name,
        unitCost: obj.avgUnitCost ?? obj.unitCost,
        quantityAvailable: getProjectAvailableQuantity({ quantityBalance: balance }),
        quantityUnpriced: num(
          (row as { quantityUnpriced?: Prisma.Decimal | number | null }).quantityUnpriced,
        ),
      };
    });

    const totalValue = items.reduce(
      (sum, i) =>
        sum + Number((i as Record<string, unknown>).quantityBalance ?? 0) *
          Number((i as Record<string, unknown>).avgUnitCost ?? (i as Record<string, unknown>).unitCost ?? 0),
      0,
    );

    res.json({ projectId, items, totalValue, itemCount: items.length });
  }),
);

inventoryRouter.get(
  '/project/:projectId/movements',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    if (!(await userHasProjectAccess(req.user, projectId))) {
      res.status(403).json({ error: 'Access denied to this project' });
      return;
    }

    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;

    const where: Prisma.ProjectInventoryMovementWhereInput = { projectId };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const rows = await prisma.projectInventoryMovement.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const materialIds = [...new Set(rows.map((r) => r.materialCategoryId))];
    const materials =
      materialIds.length > 0
        ? await prisma.materialCategory.findMany({
            where: { id: { in: materialIds } },
            select: { id: true, code: true, name: true, unit: true },
          })
        : [];
    const matMap = new Map(materials.map((m) => [m.id, m]));

    res.json({
      projectId,
      movements: rows.map((row) => {
        const mc = matMap.get(row.materialCategoryId);
        return {
          ...(serialize(row) as Record<string, unknown>),
          materialCode: mc?.code,
          materialName: mc?.name,
          materialUnit: mc?.unit,
        };
      }),
    });
  }),
);

/**
 * Import opening warehouse balances from Excel rows.
 * Dr project 127… / Cr partners' current 31401001 — skip materials that already have a project_inventory row.
 */
inventoryRouter.post(
  '/project/:projectId/opening-import',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    if (!canImportOpeningBalances(req.user)) {
      res.status(403).json({
        error: 'Only admin, projects manager, or users with inventory.create can import opening balances',
      });
      return;
    }

    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) {
      res.status(400).json({ error: 'projectId is required' });
      return;
    }

    try {
      await assertProjectAccess(prisma, req.user, projectId);
    } catch (e) {
      res.status(403).json({ error: e instanceof Error ? e.message : 'Access denied to this project' });
      return;
    }

    const body = req.body as {
      date?: string;
      rows?: Array<{ materialCategoryCode?: string; quantity?: number; avgUnitCost?: number }>;
    };
    const date = String(body.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return;
    }
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) {
      res.status(400).json({ error: 'rows array is required' });
      return;
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
      select: { id: true, projectName: true, projectCode: true },
    });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await ensureMissingCoaAccounts({
      codes: ['314', '31401', AccountCodes.PARTNERS_CURRENT],
    });

    const warehouse = await resolveProjectWarehouseAccount(prisma, projectId);
    if (!warehouse) {
      res.status(400).json({
        error:
          'حساب مخزن المشروع (127…) غير مربوط. اربط حساب المخزن من تبويب رصيد المخزن قبل الاستيراد.',
      });
      return;
    }

    const reference = buildOpeningInventoryReference(project.projectCode || project.id);

    type ImportResult = {
      imported: number;
      skipped: number;
      errors: string[];
      transactionId?: string;
      reference?: string;
      totalAmount?: number;
    };

    const result = await prisma.$transaction(async (tx) => {
      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];
      let totalAmount = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const code = String(row.materialCategoryCode ?? '').trim();
        const quantity = Number(row.quantity);
        const avgUnitCost = Number(row.avgUnitCost);
        const rowLabel = `Row ${i + 1}`;

        if (!code) {
          errors.push(`${rowLabel}: material category code is required`);
          continue;
        }
        if (!Number.isFinite(quantity) || quantity <= EPSILON) {
          errors.push(`${rowLabel} (${code}): quantity must be greater than zero`);
          continue;
        }
        if (!Number.isFinite(avgUnitCost) || avgUnitCost < 0) {
          errors.push(`${rowLabel} (${code}): avg unit cost must be a non-negative number`);
          continue;
        }

        const material = await tx.materialCategory.findFirst({
          where: { code },
          select: { id: true, code: true, name: true, unit: true },
        });
        if (!material) {
          errors.push(`${rowLabel} (${code}): material category not found`);
          continue;
        }

        const existing = await getProjectInventoryByMaterial(tx, projectId, material.id);
        if (existing) {
          skipped += 1;
          continue;
        }

        const qty = roundMoney(quantity);
        const unitCost = roundMoney(avgUnitCost);
        const lineTotal = roundMoney(qty * unitCost);

        await upsertProjectInventoryReceipt(
          tx,
          projectId,
          material.id,
          material.name,
          material.unit || 'عدد',
          qty,
          unitCost,
          { referenceType: 'opening_balance', referenceId: reference },
        );

        imported += 1;
        totalAmount = roundMoney(totalAmount + lineTotal);
      }

      const out: ImportResult = { imported, skipped, errors };

      if (imported > 0 && totalAmount > 0) {
        const transactionId = await postOpeningInventoryJournal(tx, {
          date,
          reference,
          projectId,
          projectName: project.projectName,
          totalAmount,
          warehouse,
          userId: req.user?.id,
        });
        out.transactionId = transactionId;
        out.reference = reference;
        out.totalAmount = totalAmount;
      }

      return out;
    });

    res.json(result);
  }),
);

inventoryRouter.get(
  '/spent-by-contract',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const assignedIds = getAssignedContractIds(req.user);
    if (assignedIds !== null && assignedIds.length === 0) {
      res.json([]);
      return;
    }

    // Materials only — Dashboard adds this to GL class-5 (which already includes
    // subcontractor / custody / contract-expense / OHA). Other cost_element values
    // must not be double-counted here.
    const where: Prisma.BoqActualCostWhereInput = { costElement: 'materials' };
    if (assignedIds !== null && assignedIds.length > 0) {
      where.contractId = { in: assignedIds };
    }
    if (req.query.contractId) {
      const cid = String(req.query.contractId);
      if (assignedIds !== null && !assignedIds.includes(cid)) {
        res.status(403).json({ error: 'Access denied to this contract' });
        return;
      }
      where.contractId = cid;
    }

    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom).trim().slice(0, 10) : '';
    const dateTo = req.query.dateTo ? String(req.query.dateTo).trim().slice(0, 10) : '';
    if (dateFrom || dateTo) {
      where.recordedAt = {
        ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00.000Z`) } : {}),
        ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
      };
    }

    const projectIdFilter = req.query.projectId ? String(req.query.projectId).trim() : '';
    const groupByRaw = String(req.query.groupBy || '').trim();
    const groupByMonth = groupByRaw === 'month';
    const groupByDay = groupByRaw === 'day';

    const contracts = await prisma.contract.findMany({
      where: {
        isDeleted: false,
        ...(projectIdFilter ? { projectId: projectIdFilter } : {}),
        ...(assignedIds !== null && assignedIds.length > 0 ? { id: { in: assignedIds } } : {}),
      },
      select: { id: true, projectId: true },
    });
    const projectByContract = new Map(contracts.map((c) => [c.id, c.projectId]));

    if (projectIdFilter) {
      const allowed = contracts.map((c) => c.id);
      if (allowed.length === 0) {
        res.json([]);
        return;
      }
      const existing = where.contractId;
      if (typeof existing === 'string') {
        if (!allowed.includes(existing)) {
          res.json([]);
          return;
        }
      } else if (existing && typeof existing === 'object' && 'in' in existing && Array.isArray(existing.in)) {
        where.contractId = { in: existing.in.filter((id) => allowed.includes(String(id))) };
      } else {
        where.contractId = { in: allowed };
      }
    }

    const rows = await prisma.boqActualCost.findMany({
      where,
      select: { contractId: true, totalCost: true, recordedAt: true },
    });

    type Agg = {
      contractId: string;
      projectId: string;
      totalSpent: number;
      month?: string;
      day?: string;
    };
    const bucket = new Map<string, Agg>();
    for (const row of rows) {
      const projectId = projectByContract.get(row.contractId) ?? '';
      if (projectIdFilter && projectId !== projectIdFilter) continue;
      // Business calendar day (Africa/Cairo) — avoid UTC date shift on recordedAt.
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: process.env.BUSINESS_TIMEZONE?.trim() || 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(row.recordedAt);
      const month = groupByMonth ? day.slice(0, 7) : undefined;
      const dayKey = groupByDay ? day : undefined;
      const key = groupByDay
        ? `${row.contractId}|${dayKey}`
        : groupByMonth
          ? `${row.contractId}|${month}`
          : row.contractId;
      const prev = bucket.get(key);
      const add = num(row.totalCost);
      if (prev) {
        prev.totalSpent += add;
      } else {
        bucket.set(key, {
          contractId: row.contractId,
          projectId,
          totalSpent: add,
          ...(month ? { month } : {}),
          ...(dayKey ? { day: dayKey } : {}),
        });
      }
    }

    res.json(
      [...bucket.values()].map((r) => ({
        contractId: r.contractId,
        projectId: r.projectId,
        totalSpent: num(r.totalSpent),
        ...(r.month ? { month: r.month } : {}),
        ...(r.day ? { day: r.day } : {}),
      })),
    );
  }),
);

inventoryRouter.get(
  '/:contractId/summary',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const { contractId } = req.params;
    const assignedIds = getAssignedContractIds(req.user);
    if (assignedIds !== null && !assignedIds.includes(contractId)) {
      res.status(403).json({ error: 'Access denied to this contract' });
      return;
    }

    const rows = await prisma.contractInventory.findMany({
      where: { contractId },
      include: { materialCategory: true },
      orderBy: { id: 'asc' },
    });

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      include: { project: { select: { projectName: true, projectCode: true } } },
    });

    const items = rows.map((row) => mapContractInventoryRow(row, contract ?? undefined));
    const totalValue = items.reduce(
      (sum, i) =>
        sum + Number((i as Record<string, unknown>).quantityBalance ?? 0) *
          Number((i as Record<string, unknown>).avgUnitCost ?? (i as Record<string, unknown>).unitCost ?? 0),
      0,
    );

    res.json({ contractId, items, totalValue, itemCount: items.length });
  }),
);

/** @deprecated استخدم consumption-orders — يبقى للتوافق */
inventoryRouter.post(
  '/consume',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const body = req.body as {
      inventoryItemId?: number;
      materialCategoryId?: number;
      contractId?: string;
      quantity: number;
      consumptionDate: string;
      boqItemId?: string;
    };

    if (!body.quantity || !body.consumptionDate) {
      res.status(400).json({ error: 'quantity and consumptionDate are required' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      let invId = body.inventoryItemId;
      let contractId = body.contractId;
      if (!invId && body.materialCategoryId && contractId) {
        const inv = await getInventoryByContractMaterial(tx, contractId, body.materialCategoryId);
        if (!inv) throw new Error('Inventory item not found');
        invId = inv.id;
      }
      if (!invId) throw new Error('inventoryItemId or materialCategoryId+contractId required');

      const item = await tx.contractInventory.findUnique({ where: { id: invId } });
      if (!item) throw new Error('Inventory item not found');

      contractId = item.contractId;
      const assignedIds = getAssignedContractIds(req.user);
      if (assignedIds !== null && !assignedIds.includes(contractId)) {
        throw new Error('Access denied to this contract');
      }

      if (body.boqItemId && item.materialCategoryId) {
        const link = await tx.boqItemMaterial.findFirst({
          where: { boqItemId: body.boqItemId, materialCategoryId: item.materialCategoryId },
        });
        if (!link) throw new Error('Material is not linked to the selected BOQ item');
      }

      const available = getAvailableQuantity({ quantityBalance: num(item.quantityBalance) });
      if (body.quantity > available + EPSILON) {
        throw new Error(`Insufficient balance. Available: ${available.toFixed(2)}`);
      }

      const quantityConsumed = num(item.quantityConsumed) + body.quantity;
      const quantityBalance = computeContractInventoryBalance({
        quantityIn: item.quantityIn,
        quantityTransferredIn: item.quantityTransferredIn,
        quantityConsumed,
        quantityTransferredOut: item.quantityTransferredOut,
        quantityReserved: item.quantityReserved,
      });

      await tx.contractInventory.update({
        where: { id: invId },
        data: { quantityConsumed, quantityBalance },
      });

      if (body.boqItemId) {
        const unitCost = num(item.avgUnitCost);
        await tx.boqActualCost.create({
          data: {
            boqItemId: body.boqItemId,
            contractId,
            materialCategoryId: item.materialCategoryId,
            quantity: body.quantity,
            unitCost,
            totalCost: toMoney(body.quantity * unitCost),
          },
        });
      }

      const updated = await tx.contractInventory.findUnique({ where: { id: invId } });
      return serialize(updated);
    });

    res.status(201).json({ ok: true, item: result });
  }),
);

inventoryRouter.get(
  '/boq-actuals',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const contractId = req.query.contractId ? String(req.query.contractId) : null;

    const purchaseLines = await prisma.purchaseInvoiceLine.findMany({
      where: {
        boqItemId: { not: null },
        ...(contractId ? { allocations: { some: { contractId } } } : {}),
      },
      include: {
        allocations: contractId ? { where: { contractId } } : true,
      },
    });

    const purchaseMap = new Map<string, { totalPurchased: number; invoiceCount: Set<string> }>();
    for (const line of purchaseLines) {
      const boqId = line.boqItemId!;
      const entry = purchaseMap.get(boqId) ?? { totalPurchased: 0, invoiceCount: new Set<string>() };
      for (const alloc of line.allocations) {
        entry.totalPurchased += num(alloc.totalCost);
      }
      entry.invoiceCount.add(line.invoiceId);
      purchaseMap.set(boqId, entry);
    }

    const actualGrouped = await prisma.boqActualCost.groupBy({
      by: ['boqItemId'],
      where: contractId ? { contractId } : undefined,
      _sum: { totalCost: true },
    });

    let projectId: string | null = null;
    if (contractId) {
      const cRow = await prisma.contract.findUnique({
        where: { id: contractId },
        select: { projectId: true },
      });
      projectId = cRow?.projectId ?? null;
    }

    const inventoryRows =
      projectId != null
        ? await prisma.projectInventory.findMany({
            where: { projectId },
            include: { materialCategory: true },
            orderBy: { id: 'asc' },
          })
        : contractId
          ? []
          : await prisma.projectInventory.findMany({
              include: { materialCategory: true },
              orderBy: { id: 'asc' },
            });

    res.json({
      purchases: [...purchaseMap.entries()].map(([boqItemId, v]) => ({
        boqItemId,
        totalPurchased: v.totalPurchased,
        invoiceCount: v.invoiceCount.size,
      })),
      actualCosts: actualGrouped.map((r) => ({
        boqItemId: r.boqItemId,
        totalConsumed: num(r._sum.totalCost),
      })),
      projectInventory: inventoryRows.map((row) => ({
        ...(serialize(row) as Record<string, unknown>),
        itemDescription: row.materialCategory?.name ?? row.itemDescription,
        unit: row.materialCategory?.unit ?? row.unit,
      })),
      inventory: inventoryRows.map((row) => ({
        ...(serialize(row) as Record<string, unknown>),
        itemDescription: row.materialCategory?.name ?? row.itemDescription,
        unit: row.materialCategory?.unit ?? row.unit,
      })),
    });
  }),
);

inventoryRouter.get(
  '/consumption',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const assignedIds = getAssignedContractIds(req.user);
    const where: Prisma.ConsumptionOrderWhereInput = { status: 'confirmed' };

    if (req.query.contractId) where.contractId = String(req.query.contractId);
    if (assignedIds !== null && assignedIds.length > 0) {
      where.contractId = req.query.contractId
        ? String(req.query.contractId)
        : { in: assignedIds };
    } else if (assignedIds !== null && assignedIds.length === 0) {
      res.json([]);
      return;
    }
    if (req.query.from) where.orderDate = { gte: String(req.query.from) };
    if (req.query.to) {
      where.orderDate =
        typeof where.orderDate === 'object' && where.orderDate !== null
          ? { ...where.orderDate, lte: String(req.query.to) }
          : { lte: String(req.query.to) };
    }

    const rows = await prisma.consumptionOrderLine.findMany({
      where: { order: where },
      include: {
        order: {
          include: {
            project: { select: { projectName: true } },
          },
        },
        materialCategory: { select: { code: true, name: true, unit: true } },
      },
      orderBy: { order: { orderDate: 'desc' } },
    });

    const contractIds = [...new Set(rows.map((r) => r.order.contractId))];
    const contracts = await prisma.contract.findMany({
      where: { id: { in: contractIds } },
      select: { id: true, contractName: true },
    });
    const contractMap = new Map(contracts.map((c) => [c.id, c]));

    res.json(
      rows.map((row) => ({
        id: row.order.id,
        orderNumber: row.order.orderNumber,
        contractId: row.order.contractId,
        orderDate: row.order.orderDate,
        recordedBy: row.order.recordedBy,
        boqItemId: row.boqItemId,
        materialCategoryId: row.materialCategoryId,
        quantity: serialize(row.quantity),
        unitCost: serialize(row.unitCost),
        totalCost: serialize(row.totalCost),
        itemDescription: row.materialCategory?.name ?? row.materialCategory?.code ?? '—',
        unit: row.materialCategory?.unit ?? '—',
        contractName: contractMap.get(row.order.contractId)?.contractName,
        projectName: row.order.project?.projectName,
      })),
    );
  }),
);
