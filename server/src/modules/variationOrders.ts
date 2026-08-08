import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requirePermission, requireAnyPermission, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { roundMoney } from '../lib/money.js';
import { approveVariationOrder, mapVoApproveError } from '../lib/variationOrderApprove.js';
import { syncVariationOrderRegistry, markDocumentRegistryDeleted } from '../lib/documentRegistrySync.js';
import { notifyVoSubmitted, notifyVoResolved } from '../lib/notificationHooks.js';

export const variationOrdersRouter = Router();
variationOrdersRouter.use(requireAuth);

const readPerm = requireAnyPermission('boq', 'projects', 'billing');
const writePerm = requirePermission('boq');

function num(v: unknown): number {
  return Number(v ?? 0);
}

type LineInput = {
  lineType: 'new_item' | 'adjust' | 'delete_item';
  boqItemId?: string;
  itemCode?: string;
  description?: string;
  unit?: string;
  chapterCode?: string;
  chapterName?: string;
  workTypeCode?: string;
  sectionCode?: string;
  sectionName?: string;
  tenderQty?: number;
  unitRateTotal?: number;
  newTenderQty?: number;
  newUnitRate?: number;
};

async function computeLineAmount(
  contractId: string,
  line: LineInput,
  boqCache: Map<string, { tenderQty: unknown; unitRateTotal: unknown }>,
): Promise<number> {
  if (line.lineType === 'new_item') {
    const qty = num(line.tenderQty);
    const rate = num(line.unitRateTotal);
    return roundMoney(qty * rate);
  }

  if (!line.boqItemId) throw new Error('boqItemId required');

  let boq = boqCache.get(line.boqItemId);
  if (!boq) {
    const row = await prisma.boqItem.findFirst({
      where: { id: line.boqItemId, contractId, isDeleted: false },
      select: { tenderQty: true, unitRateTotal: true },
    });
    if (!row) throw new Error(`BOQ item not found: ${line.boqItemId}`);
    boq = row;
    boqCache.set(line.boqItemId, row);
  }

  const oldQty = num(boq.tenderQty);
  const oldRate = num(boq.unitRateTotal);
  const oldAmount = roundMoney(oldQty * oldRate);

  if (line.lineType === 'delete_item') {
    return roundMoney(-oldAmount);
  }

  const newQty = line.newTenderQty != null ? num(line.newTenderQty) : oldQty;
  const newRate = line.newUnitRate != null ? num(line.newUnitRate) : oldRate;
  const newAmount = roundMoney(newQty * newRate);
  return roundMoney(newAmount - oldAmount);
}

function assertValidLineInput(line: LineInput): void {
  if (!['new_item', 'adjust', 'delete_item'].includes(line.lineType)) {
    throw new Error(`Invalid lineType: ${line.lineType}`);
  }
  if (line.lineType === 'new_item') {
    const qty = num(line.tenderQty);
    const rate = num(line.unitRateTotal);
    if (!Number.isFinite(qty) || !Number.isFinite(rate) || qty <= 0 || rate < 0) {
      throw new Error(
        'بند جديد غير مكتمل: الكمية يجب أن تكون أكبر من صفر والسعر ≥ 0. احذف البنود الفارغة قبل الحفظ.',
      );
    }
    if (!line.itemCode?.trim() || !line.description?.trim() || !line.unit?.trim()) {
      throw new Error('بند جديد يتطلب كود البند والوصف والوحدة.');
    }
    return;
  }
  if (!line.boqItemId?.trim()) {
    throw new Error('تعديل/حذف بند يتطلب اختيار بند BOQ.');
  }
  if (line.lineType === 'adjust') {
    if (line.newTenderQty != null && (!Number.isFinite(num(line.newTenderQty)) || num(line.newTenderQty) < 0)) {
      throw new Error('كمية التعديل غير صالحة.');
    }
    if (line.newUnitRate != null && (!Number.isFinite(num(line.newUnitRate)) || num(line.newUnitRate) < 0)) {
      throw new Error('سعر التعديل غير صالح.');
    }
  }
}

async function buildLineCreates(
  contractId: string,
  lines: LineInput[],
): Promise<{ lineData: Prisma.VariationOrderLineCreateWithoutVariationOrderInput[]; totalValue: number }> {
  const boqCache = new Map<string, { tenderQty: unknown; unitRateTotal: unknown }>();
  const lineData: Prisma.VariationOrderLineCreateWithoutVariationOrderInput[] = [];
  let totalValue = 0;

  for (const line of lines) {
    assertValidLineInput(line);
    const lineAmount = await computeLineAmount(contractId, line, boqCache);
    totalValue = roundMoney(totalValue + lineAmount);

    lineData.push({
      lineType: line.lineType,
      ...(line.boqItemId ? { boqItem: { connect: { id: line.boqItemId } } } : {}),
      itemCode: line.itemCode?.trim() || null,
      description: line.description?.trim() || null,
      unit: line.unit?.trim() || null,
      chapterCode: line.chapterCode?.trim() || null,
      chapterName: line.chapterName?.trim() || null,
      workTypeCode: line.workTypeCode?.trim() || null,
      sectionCode: line.sectionCode?.trim() || null,
      sectionName: line.sectionName?.trim() || null,
      tenderQty: line.tenderQty != null ? num(line.tenderQty) : null,
      unitRateTotal: line.unitRateTotal != null ? num(line.unitRateTotal) : null,
      newTenderQty: line.newTenderQty != null ? num(line.newTenderQty) : null,
      newUnitRate: line.newUnitRate != null ? num(line.newUnitRate) : null,
      lineAmount,
    });
  }

  return { lineData, totalValue: roundMoney(totalValue) };
}

async function loadOrder(id: string): Promise<Record<string, unknown> | undefined> {
  const row = await prisma.variationOrder.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!row) return undefined;

  const boqIds = row.lines.map((l) => l.boqItemId).filter(Boolean) as string[];
  const boqItems = boqIds.length
    ? await prisma.boqItem.findMany({
        where: { id: { in: boqIds } },
        select: { id: true, itemCode: true, description: true, unit: true, tenderQty: true, unitRateTotal: true },
      })
    : [];
  const boqMap = new Map(boqItems.map((b) => [b.id, b]));

  const lines = row.lines.map((line) => {
    const boq = line.boqItemId ? boqMap.get(line.boqItemId) : undefined;
    return {
      ...(serialize(line) as Record<string, unknown>),
      boqItemCode: boq?.itemCode ?? null,
      boqItemDescription: boq?.description ?? null,
      boqItemUnit: boq?.unit ?? null,
      boqTenderQty: boq?.tenderQty != null ? num(boq.tenderQty) : null,
      boqUnitRate: boq?.unitRateTotal != null ? num(boq.unitRateTotal) : null,
    };
  });

  return {
    ...(serialize(row) as Record<string, unknown>),
    lines,
  };
}

async function nextVoMeta(contractId: string): Promise<{ voNumber: string; sequenceNo: number }> {
  const year = new Date().getFullYear();
  const prefix = `VO-${year}-`;
  const last = await prisma.variationOrder.findFirst({
    where: { contractId, voNumber: { startsWith: prefix } },
    orderBy: { voNumber: 'desc' },
    select: { voNumber: true },
  });

  let seq = 1;
  if (last?.voNumber) {
    const parts = last.voNumber.split('-');
    const parsed = parseInt(parts[parts.length - 1] ?? '', 10);
    if (!Number.isNaN(parsed)) seq = parsed + 1;
  }

  const maxSeq = await prisma.variationOrder.aggregate({
    where: { contractId },
    _max: { sequenceNo: true },
  });

  return {
    voNumber: `${prefix}${String(seq).padStart(3, '0')}`,
    sequenceNo: (maxSeq._max.sequenceNo ?? 0) + 1,
  };
}

variationOrdersRouter.get(
  '/',
  readPerm,
  asyncHandler(async (req, res) => {
    const contractId = String(req.query.contractId ?? '').trim();
    const status = String(req.query.status ?? '').trim();
    const where: Prisma.VariationOrderWhereInput = {};
    if (contractId) where.contractId = contractId;
    if (status) where.status = status;

    const rows = await prisma.variationOrder.findMany({
      where,
      orderBy: [{ sequenceNo: 'desc' }],
      include: { lines: true },
    });

    const result = await Promise.all(rows.map((r) => loadOrder(r.id)));
    res.json(result.filter(Boolean));
  }),
);

variationOrdersRouter.get(
  '/:id',
  readPerm,
  asyncHandler(async (req, res) => {
    const loaded = await loadOrder(req.params.id);
    if (!loaded) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(loaded);
  }),
);

variationOrdersRouter.post(
  '/',
  writePerm,
  asyncHandler(async (req, res) => {
    const body = req.body as {
      contractId: string;
      voDate?: string;
      title?: string;
      notes?: string;
      lines: LineInput[];
    };

    if (!body.contractId?.trim()) {
      res.status(400).json({ error: 'contractId is required' });
      return;
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      res.status(400).json({ error: 'At least one line is required' });
      return;
    }

    const contract = await prisma.contract.findUnique({
      where: { id: body.contractId },
      select: { id: true, projectId: true },
    });
    if (!contract) {
      res.status(404).json({ error: 'Contract not found' });
      return;
    }

    let lineData: Prisma.VariationOrderLineCreateWithoutVariationOrderInput[];
    let totalValue: number;
    try {
      const built = await buildLineCreates(body.contractId, body.lines);
      lineData = built.lineData;
      totalValue = built.totalValue;
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'invalid_lines' });
      return;
    }

    const { voNumber, sequenceNo } = await nextVoMeta(body.contractId);
    const id = randomUUID();

    await prisma.variationOrder.create({
      data: {
        id,
        contractId: body.contractId,
        projectId: contract.projectId,
        voNumber,
        sequenceNo,
        voDate: body.voDate ?? null,
        title: body.title?.trim() || '',
        notes: body.notes?.trim() || null,
        status: 'draft',
        totalValue,
        createdBy: req.user?.id ?? null,
        lines: { create: lineData },
      },
    });

    await syncVariationOrderRegistry(id);
    const loadedOrder = await loadOrder(id);
    
    const newBoqItemIds: string[] = [];
    if (loadedOrder && Array.isArray(loadedOrder.lines)) {
      for (let i = 0; i < body.lines.length; i++) {
        if (body.lines[i].lineType === 'new_item' && loadedOrder.lines[i]?.boqItemId) {
          newBoqItemIds.push(loadedOrder.lines[i].boqItemId);
        }
      }
    }
    
    res.status(201).json({ ...loadedOrder, newBoqItemIds });
  }),
);

variationOrdersRouter.post(
  '/:id/submit',
  writePerm,
  asyncHandler(async (req, res) => {
    const row = await prisma.variationOrder.findUnique({ where: { id: req.params.id } });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (row.status !== 'draft') {
      res.status(400).json({ error: `Cannot submit in status: ${row.status}` });
      return;
    }

    await prisma.variationOrder.update({
      where: { id: req.params.id },
      data: { status: 'submitted' },
    });
    await syncVariationOrderRegistry(req.params.id);
    notifyVoSubmitted(
      { id: row.id, voNumber: row.voNumber, contractId: row.contractId, projectId: row.projectId },
      req.user?.id,
    );
    res.json(await loadOrder(req.params.id));
  }),
);

variationOrdersRouter.post(
  '/:id/approve',
  requireRole('admin', 'projects_manager'),
  asyncHandler(async (req, res) => {
    const row = await prisma.variationOrder.findUnique({ where: { id: req.params.id } });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (row.status !== 'submitted') {
      res.status(400).json({ error: `Cannot approve in status: ${row.status}` });
      return;
    }

    try {
      await approveVariationOrder(req.params.id, req.user?.id);
    } catch (err) {
      const mapped = mapVoApproveError(err);
      res.status(mapped.status).json({ error: mapped.error });
      return;
    }
    notifyVoResolved(req.params.id);
    res.json(await loadOrder(req.params.id));
  }),
);

variationOrdersRouter.post(
  '/:id/reject',
  requireRole('admin', 'projects_manager'),
  asyncHandler(async (req, res) => {
    const row = await prisma.variationOrder.findUnique({ where: { id: req.params.id } });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (row.status !== 'submitted') {
      res.status(400).json({ error: `Cannot reject in status: ${row.status}` });
      return;
    }

    await prisma.variationOrder.update({
      where: { id: req.params.id },
      data: { status: 'rejected' },
    });
    await syncVariationOrderRegistry(req.params.id);
    notifyVoResolved(req.params.id);
    res.json(await loadOrder(req.params.id));
  }),
);

variationOrdersRouter.delete(
  '/:id',
  writePerm,
  asyncHandler(async (req, res) => {
    const row = await prisma.variationOrder.findUnique({ where: { id: req.params.id } });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (row.status !== 'draft') {
      res.status(400).json({ error: 'Only draft orders can be deleted' });
      return;
    }

    await prisma.variationOrder.delete({ where: { id: req.params.id } });
    await markDocumentRegistryDeleted('boq', req.params.id);
    res.json({ ok: true });
  }),
);
