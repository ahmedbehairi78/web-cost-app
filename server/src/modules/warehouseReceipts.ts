import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth, requireAnyPermission } from '../middleware/auth.js';
import { withIdempotency } from '../middleware/idempotency.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import {
  moduleAccess,
  normalizeUserPermissions,
} from '../permissions.js';
import {
  assertProjectAccess,
  getAccessibleProjectIds,
  num,
  receiveUnpricedProjectInventory,
  reverseUnpricedProjectInventory,
} from './inventoryHelpers.js';
import { businessTodayCompact } from '../lib/businessCalendar.js';

export const warehouseReceiptsRouter = Router();
warehouseReceiptsRouter.use(requireAuth);
warehouseReceiptsRouter.use(withIdempotency());

const inventoryUsePerm = requireAnyPermission('inventory', 'costs', 'transfers');

function canApproveReceipt(user: NonNullable<Request['user']>): boolean {
  if (user.role === 'admin' || user.role === 'projects_manager') return true;
  return moduleAccess(normalizeUserPermissions(user.permissions), 'costs').edit === true;
}

function requireReceiptApprover(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!canApproveReceipt(req.user)) {
    res.status(403).json({ error: 'لا صلاحية لاعتماد استلام المخزن' });
    return;
  }
  next();
}

async function nextReceiptNumber(tx: Prisma.TransactionClient = prisma): Promise<string> {
  const day = businessTodayCompact();
  const prefix = `WR-${day}-`;
  const latest = await tx.warehouseReceipt.findFirst({
    where: { receiptNumber: { startsWith: prefix } },
    orderBy: { receiptNumber: 'desc' },
    select: { receiptNumber: true },
  });
  let seq = 1;
  if (latest?.receiptNumber) {
    const m = latest.receiptNumber.match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

async function loadReceipt(id: string) {
  const row = await prisma.warehouseReceipt.findUnique({
    where: { id },
    include: {
      project: { select: { projectName: true, projectCode: true } },
      lines: {
        include: {
          materialCategory: { select: { code: true, name: true, unit: true } },
        },
      },
    },
  });
  if (!row) return null;
  const base = serialize(row) as Record<string, unknown>;
  return {
    ...base,
    id: row.id,
    projectId: row.projectId,
    projectName: row.project?.projectName,
    projectCode: row.project?.projectCode,
    lines: row.lines.map((line) => {
      const flat = serialize(line) as Record<string, unknown>;
      return {
        ...flat,
        materialCode: line.materialCategory?.code,
        materialName: line.materialCategory?.name,
        materialUnit: line.materialCategory?.unit,
      };
    }),
  };
}

type ReceiptLineInput = {
  materialCategoryId: number;
  quantity: number;
  unitCost?: number | null;
};

async function applySubmitStock(
  tx: Prisma.TransactionClient,
  receiptId: string,
  projectId: string,
  lines: Array<{ materialCategoryId: number; quantity: Prisma.Decimal | number }>,
): Promise<void> {
  for (const line of lines) {
    const materialCategoryId = Number(line.materialCategoryId);
    const qty = num(line.quantity);
    const cat = await tx.materialCategory.findUnique({ where: { id: materialCategoryId } });
    if (!cat) throw new Error(`Material category ${materialCategoryId} not found`);
    await receiveUnpricedProjectInventory(
      tx,
      projectId,
      materialCategoryId,
      cat.name,
      cat.unit,
      qty,
      {
        referenceType: 'warehouse_receipt',
        referenceId: receiptId,
        notes: 'pending cost approval',
      },
    );
  }
}

warehouseReceiptsRouter.get(
  '/',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const accessible = await getAccessibleProjectIds(prisma, req.user);
    const where: Prisma.WarehouseReceiptWhereInput = {};
    if (req.query.projectId) where.projectId = String(req.query.projectId);
    if (req.query.status) where.status = String(req.query.status);
    if (accessible !== null) {
      if (accessible.length === 0) {
        res.json([]);
        return;
      }
      where.projectId = { in: accessible };
    }

    const rows = await prisma.warehouseReceipt.findMany({
      where,
      orderBy: [{ receiptDate: 'desc' }, { createdAt: 'desc' }],
      include: {
        project: { select: { projectName: true, projectCode: true } },
        lines: {
          include: {
            materialCategory: { select: { code: true, name: true, unit: true } },
          },
        },
      },
      take: 200,
    });

    res.json(
      rows.map((row) => {
        const base = serialize(row) as Record<string, unknown>;
        return {
          ...base,
          projectName: row.project?.projectName,
          projectCode: row.project?.projectCode,
          lines: row.lines.map((line) => {
            const flat = serialize(line) as Record<string, unknown>;
            return {
              ...flat,
              materialCode: line.materialCategory?.code,
              materialName: line.materialCategory?.name,
              materialUnit: line.materialCategory?.unit,
            };
          }),
        };
      }),
    );
  }),
);

warehouseReceiptsRouter.get(
  '/:id',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const loaded = await loadReceipt(String(req.params.id));
    if (!loaded) {
      res.status(404).json({ error: 'Receipt not found' });
      return;
    }
    await assertProjectAccess(prisma, req.user, loaded.projectId);
    res.json(loaded);
  }),
);

warehouseReceiptsRouter.post(
  '/',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const body = req.body as {
      projectId: string;
      receiptDate: string;
      supplierInvoiceRef: string;
      notes?: string;
      submit?: boolean;
      lines: ReceiptLineInput[];
    };

    if (!body.projectId || !body.receiptDate || !body.supplierInvoiceRef?.trim()) {
      res.status(400).json({ error: 'projectId, receiptDate, and supplierInvoiceRef are required' });
      return;
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      res.status(400).json({ error: 'At least one receipt line is required' });
      return;
    }

    await assertProjectAccess(prisma, user, body.projectId);
    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
      select: { id: true },
    });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    for (const [idx, line] of body.lines.entries()) {
      const qty = Number(line.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        res.status(400).json({ error: `Line ${idx + 1}: quantity must be > 0` });
        return;
      }
      const catId = Number(line.materialCategoryId);
      if (!Number.isFinite(catId)) {
        res.status(400).json({ error: `Line ${idx + 1}: materialCategoryId required` });
        return;
      }
    }

    const submitNow = body.submit !== false;
    const id = await prisma.$transaction(async (tx) => {
      const receiptNumber = await nextReceiptNumber(tx);
      const receipt = await tx.warehouseReceipt.create({
        data: {
          id: randomUUID(),
          receiptNumber,
          projectId: body.projectId,
          receiptDate: body.receiptDate,
          supplierInvoiceRef: body.supplierInvoiceRef.trim(),
          notes: body.notes?.trim() || null,
          status: submitNow ? 'pending_approval' : 'draft',
          createdBy: user.id,
          lines: {
            create: body.lines.map((line) => ({
              materialCategoryId: Number(line.materialCategoryId),
              quantity: Number(line.quantity),
              unitCost: null,
              totalCost: null,
            })),
          },
        },
        include: { lines: true },
      });

      if (submitNow) {
        await applySubmitStock(tx, receipt.id, body.projectId, receipt.lines);
      }
      return receipt.id;
    });

    const loaded = await loadReceipt(id);
    res.status(201).json({ ok: true, receipt: loaded });
  }),
);

warehouseReceiptsRouter.post(
  '/:id/submit',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = String(req.params.id);

    await prisma.$transaction(async (tx) => {
      const receipt = await tx.warehouseReceipt.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!receipt) throw new Error('Receipt not found');
      if (receipt.status !== 'draft') {
        throw new Error(`Cannot submit from status: ${receipt.status}`);
      }
      await assertProjectAccess(tx, user, receipt.projectId);
      if (receipt.lines.length === 0) throw new Error('Receipt has no lines');

      await applySubmitStock(tx, receipt.id, receipt.projectId, receipt.lines);
      await tx.warehouseReceipt.update({
        where: { id },
        data: { status: 'pending_approval' },
      });
    });

    const loaded = await loadReceipt(id);
    res.json({ ok: true, receipt: loaded });
  }),
);

warehouseReceiptsRouter.post(
  '/:id/approve',
  requireReceiptApprover,
  asyncHandler(async (_req, res) => {
    res.status(410).json({
      error:
        'اعتماد الاستلام يتم عبر فاتورة المشتريات في التكاليف الفعلية (مع الضريبة وخصم الإضافة). لا يُرحَّل قيد WR من المخزن.',
      code: 'WAREHOUSE_RECEIPT_APPROVE_VIA_INVOICE',
    });
  }),
);

warehouseReceiptsRouter.post(
  '/:id/reject',
  requireReceiptApprover,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = String(req.params.id);

    await prisma.$transaction(async (tx) => {
      const receipt = await tx.warehouseReceipt.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!receipt) throw new Error('Receipt not found');
      if (receipt.status !== 'pending_approval' && receipt.status !== 'draft') {
        throw new Error(`Cannot reject from status: ${receipt.status}`);
      }
      await assertProjectAccess(tx, user, receipt.projectId);

      if (receipt.status === 'pending_approval') {
        const materialIds = [...new Set(receipt.lines.map((l) => Number(l.materialCategoryId)))];
        const pendingCost = await tx.consumptionOrder.findFirst({
          where: {
            projectId: receipt.projectId,
            status: 'pending_cost',
            lines: { some: { materialCategoryId: { in: materialIds } } },
          },
          select: { orderNumber: true },
        });
        if (pendingCost) {
          throw new Error(
            `لا يمكن الرفض: يوجد صرف معلّق التكلفة (${pendingCost.orderNumber}) على أصناف هذا الاستلام`,
          );
        }

        for (const line of receipt.lines) {
          await reverseUnpricedProjectInventory(
            tx,
            receipt.projectId,
            Number(line.materialCategoryId),
            num(line.quantity),
            { referenceType: 'warehouse_receipt_reject', referenceId: id },
          );
        }
      }

      await tx.warehouseReceipt.update({
        where: { id },
        data: {
          status: 'rejected',
          approvedBy: user.id,
          approvedAt: new Date(),
        },
      });
    });

    const loaded = await loadReceipt(id);
    res.json({ ok: true, receipt: loaded });
  }),
);
