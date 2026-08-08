import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requirePermission, requireAnyPermission, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { createTransaction } from '../accounting/journal.js';
import { AccountCodes } from '../accounting/accountCodes.js';
import { notifyMosDraft, notifyMosResolved } from '../lib/notificationHooks.js';

export const mosExtractsRouter = Router();
mosExtractsRouter.use(requireAuth);

const readPerm = requireAnyPermission('billing', 'costs');

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

type MosRow = Prisma.MaterialOnSiteExtractGetPayload<Record<string, never>>;

/** Attach BOQ description/unit (no relation defined — looked up by id). */
async function attachBoqInfo(rows: MosRow[]): Promise<Record<string, unknown>[]> {
  const boqIds = [...new Set(rows.map((r) => r.boqItemId).filter(Boolean))];
  const boqItems = boqIds.length
    ? await prisma.boqItem.findMany({
        where: { id: { in: boqIds } },
        select: { id: true, description: true, unit: true },
      })
    : [];
  const boqMap = new Map(boqItems.map((b) => [b.id, b]));
  return rows.map((row) => {
    const boq = boqMap.get(row.boqItemId);
    return {
      ...(serialize(row) as Record<string, unknown>),
      boqItemDescription: boq?.description ?? null,
      boqItemUnit: boq?.unit ?? null,
    };
  });
}

async function loadMos(id: string): Promise<Record<string, unknown> | undefined> {
  const row = await prisma.materialOnSiteExtract.findUnique({ where: { id } });
  if (!row) return undefined;
  const [withBoq] = await attachBoqInfo([row]);
  return withBoq;
}

// GET /api/mos-extracts?contractId=&boqItemId=&status=
mosExtractsRouter.get(
  '/',
  readPerm,
  asyncHandler(async (req, res) => {
    const where: Prisma.MaterialOnSiteExtractWhereInput = {};
    if (req.query.contractId) where.contractId = String(req.query.contractId);
    if (req.query.boqItemId) where.boqItemId = String(req.query.boqItemId);
    if (req.query.status) where.status = String(req.query.status);

    const rows = await prisma.materialOnSiteExtract.findMany({
      where,
      orderBy: [{ extractDate: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(await attachBoqInfo(rows));
  }),
);

// GET /api/mos-extracts/boq-summary?boqItemId=&contractId=
mosExtractsRouter.get(
  '/boq-summary',
  readPerm,
  asyncHandler(async (req, res) => {
    const boqItemId = String(req.query.boqItemId ?? '').trim();
    const contractId = String(req.query.contractId ?? '').trim();
    if (!boqItemId || !contractId) {
      res.status(400).json({ error: 'boqItemId and contractId are required' });
      return;
    }
    const rows = await prisma.materialOnSiteExtract.findMany({
      where: { boqItemId, contractId, status: 'approved' },
      orderBy: [{ extractDate: 'desc' }, { createdAt: 'desc' }],
    });
    const items = await attachBoqInfo(rows);
    const totalEquivalentQty = round2(
      items.reduce((sum, it) => sum + Number((it as { equivalentQuantity?: number }).equivalentQuantity ?? 0), 0),
    );
    res.json({ totalEquivalentQty, approvedCount: items.length, items });
  }),
);

// POST /api/mos-extracts
mosExtractsRouter.post(
  '/',
  requirePermission('billing'),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      firestoreId?: string;
      contractId: string;
      boqItemId: string;
      suppliedQuantity: number;
      onSitePercentage: number;
      unitPrice: number;
      deliveryNoteRef?: string;
      extractDate?: string;
      notes?: string;
    };

    if (!body.contractId || !body.boqItemId) {
      res.status(400).json({ error: 'contractId and boqItemId are required' });
      return;
    }
    if (typeof body.suppliedQuantity !== 'number' || body.suppliedQuantity <= 0) {
      res.status(400).json({ error: 'suppliedQuantity must be a positive number' });
      return;
    }
    if (typeof body.onSitePercentage !== 'number' || body.onSitePercentage <= 0 || body.onSitePercentage > 100) {
      res.status(400).json({ error: 'onSitePercentage must be between 0 and 100' });
      return;
    }
    if (typeof body.unitPrice !== 'number' || body.unitPrice < 0) {
      res.status(400).json({ error: 'unitPrice must be non-negative' });
      return;
    }

    const equivalentQuantity = round2(body.suppliedQuantity * (body.onSitePercentage / 100));
    const claimedAmount = round2(equivalentQuantity * body.unitPrice);

    const year = new Date().getFullYear();
    const lastRow = await prisma.materialOnSiteExtract.findFirst({
      where: { extractNumber: { startsWith: `MOS-${year}-` } },
      orderBy: { extractNumber: 'desc' },
      select: { extractNumber: true },
    });

    let seq = 1;
    if (lastRow?.extractNumber) {
      const parts = lastRow.extractNumber.split('-');
      const parsed = parseInt(parts[parts.length - 1] ?? '', 10);
      if (!Number.isNaN(parsed)) seq = parsed + 1;
    }
    const extractNumber = `MOS-${year}-${String(seq).padStart(3, '0')}`;

    const id = randomUUID();
    await prisma.materialOnSiteExtract.create({
      data: {
        id,
        firestoreId: body.firestoreId ?? null,
        contractId: body.contractId,
        boqItemId: body.boqItemId,
        suppliedQuantity: body.suppliedQuantity,
        onSitePercentage: body.onSitePercentage,
        equivalentQuantity,
        unitPrice: body.unitPrice,
        claimedAmount,
        deliveryNoteRef: body.deliveryNoteRef ?? null,
        extractNumber,
        extractDate: body.extractDate ?? null,
        notes: body.notes ?? null,
        status: 'draft',
        createdBy: req.user?.id ?? null,
      },
    });

    res.status(201).json(await loadMos(id));
    notifyMosDraft(
      { id, extractNumber, contractId: body.contractId },
      req.user?.id,
    );
  }),
);

// POST /api/mos-extracts/:id/approve — admin أو projects_manager فقط
mosExtractsRouter.post(
  '/:id/approve',
  requireRole('admin', 'projects_manager'),
  asyncHandler(async (req, res) => {
    const row = await prisma.materialOnSiteExtract.findUnique({ where: { id: req.params.id } });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (row.status !== 'draft') {
      res.status(400).json({ error: `Cannot approve extract in status: ${row.status}` });
      return;
    }

    const contractId = row.contractId;
    const boqItemId = row.boqItemId;
    const claimedAmount = round2(Number(row.claimedAmount));
    const extractNumber = String(row.extractNumber ?? '').trim();

    const boq = await prisma.boqItem.findUnique({
      where: { id: boqItemId },
      select: { description: true },
    });
    const boqDescription = boq?.description ?? boqItemId;

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: { projectId: true },
    });
    const projectId = contract?.projectId;

    await prisma.$transaction(async (tx) => {
      const journal = await createTransaction(
        {
          date: String(row.extractDate ?? new Date().toISOString().slice(0, 10)),
          description: `تشوين - ${boqDescription}`,
          reference: extractNumber || undefined,
          costCenterId: contractId,
          projectId: projectId || undefined,
          entries: [
            { accountCode: AccountCodes.RECEIVABLES, accountName: 'ح/ عملاء - مستخلصات تحت التحصيل', debit: claimedAmount, credit: 0 },
            { accountCode: AccountCodes.REVENUE,     accountName: 'ح/ إيرادات عقود المقاولات',        debit: 0,             credit: claimedAmount },
          ],
        },
        req.user?.id,
        tx,
      );

      await tx.materialOnSiteExtract.update({
        where: { id: req.params.id },
        data: { status: 'approved', transactionId: journal.id },
      });
    });

    res.json(await loadMos(req.params.id));
    notifyMosResolved(req.params.id);
  }),
);
