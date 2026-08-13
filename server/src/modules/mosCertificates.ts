import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requirePermission, requireAnyPermission, requireModuleWrite } from '../middleware/auth.js';
import { withIdempotency } from '../middleware/idempotency.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { roundMoney } from '../lib/money.js';
import { notifyMosDraft, notifyMosResolved } from '../lib/notificationHooks.js';
import { approveMosCertificate } from '../lib/mosCertificateApprove.js';
import { syncMosCertificateRegistry } from '../lib/documentRegistrySync.js';
import { buildMosPriorMaps } from '../lib/mosPriorMaps.js';

export const mosCertificatesRouter = Router();
mosCertificatesRouter.use(requireAuth);
mosCertificatesRouter.use(withIdempotency());

const readPerm = requireAnyPermission('billing', 'costs');
const writePerm = requirePermission('billing');

type MosLineRow = Prisma.MosCertificateLineGetPayload<Record<string, never>>;

function num(v: unknown): number {
  return Number(v ?? 0);
}

async function attachBoqToLines(lines: MosLineRow[]): Promise<Record<string, unknown>[]> {
  const boqIds = [...new Set(lines.map((l) => l.boqItemId).filter(Boolean))];
  const boqItems = boqIds.length
    ? await prisma.boqItem.findMany({
        where: { id: { in: boqIds } },
        select: { id: true, description: true, unit: true, itemCode: true, tenderQty: true },
      })
    : [];
  const boqMap = new Map(boqItems.map((b) => [b.id, b]));
  return lines.map((line) => {
    const boq = boqMap.get(line.boqItemId);
    return {
      ...(serialize(line) as Record<string, unknown>),
      boqItemDescription: boq?.description ?? null,
      boqItemUnit: boq?.unit ?? null,
      boqItemCode: boq?.itemCode ?? null,
      tenderQty: boq?.tenderQty != null ? num(boq.tenderQty) : null,
    };
  });
}

async function loadCertificate(id: string): Promise<Record<string, unknown> | undefined> {
  const row = await prisma.mosCertificate.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!row) return undefined;
  const lines = await attachBoqToLines(row.lines);
  return {
    ...(serialize(row) as Record<string, unknown>),
    lines,
  };
}

/** @deprecated use buildMosPriorMaps from mosPriorMaps.ts */
async function buildPriorMaps(contractId: string) {
  return buildMosPriorMaps(contractId);
}

async function nextCertificateMeta(contractId: string): Promise<{ certificateNo: string; sequenceNo: number; phase: string }> {
  const year = new Date().getFullYear();
  const prefix = `MOS-${year}-`;
  const last = await prisma.mosCertificate.findFirst({
    where: { contractId, certificateNo: { startsWith: prefix } },
    orderBy: { certificateNo: 'desc' },
    select: { certificateNo: true },
  });

  let seq = 1;
  if (last?.certificateNo) {
    const parts = last.certificateNo.split('-');
    const parsed = parseInt(parts[parts.length - 1] ?? '', 10);
    if (!Number.isNaN(parsed)) seq = parsed + 1;
  }

  const maxSeq = await prisma.mosCertificate.aggregate({
    where: { contractId },
    _max: { sequenceNo: true },
  });
  const nextSeq = (maxSeq._max.sequenceNo ?? 0) + 1;

  return {
    certificateNo: `${prefix}${String(seq).padStart(3, '0')}`,
    sequenceNo: nextSeq,
    phase: nextSeq === 1 ? 'initial' : 'periodic',
  };
}

type CreateLineInput = {
  boqItemId: string;
  suppliedQtyThisPeriod: number;
  onSitePercentage: number;
  unitPrice: number;
};

// GET /api/mos-certificates?contractId=&status=
mosCertificatesRouter.get(
  '/',
  readPerm,
  asyncHandler(async (req, res) => {
    const where: Prisma.MosCertificateWhereInput = {};
    if (req.query.contractId) where.contractId = String(req.query.contractId);
    if (req.query.status) where.status = String(req.query.status);

    const rows = await prisma.mosCertificate.findMany({
      where,
      orderBy: [{ sequenceNo: 'desc' }, { createdAt: 'desc' }],
      include: { lines: true },
    });

    const result = await Promise.all(
      rows.map(async (row) => ({
        ...(serialize(row) as Record<string, unknown>),
        lines: await attachBoqToLines(row.lines),
      })),
    );
    res.json(result);
  }),
);

// GET /api/mos-certificates/equivalent-map?contractId=
mosCertificatesRouter.get(
  '/equivalent-map',
  readPerm,
  asyncHandler(async (req, res) => {
    const contractId = String(req.query.contractId ?? '').trim();
    if (!contractId) {
      res.status(400).json({ error: 'contractId is required' });
      return;
    }
    const { equivalent, supplied } = await buildPriorMaps(contractId);
    res.json({ equivalent, supplied });
  }),
);

// GET /api/mos-certificates/prior-summary?contractId=
mosCertificatesRouter.get(
  '/prior-summary',
  readPerm,
  asyncHandler(async (req, res) => {
    const contractId = String(req.query.contractId ?? '').trim();
    if (!contractId) {
      res.status(400).json({ error: 'contractId is required' });
      return;
    }
    const { equivalent, supplied } = await buildPriorMaps(contractId);
    res.json({
      priorEquivalentByBoqItemId: equivalent,
      priorSuppliedByBoqItemId: supplied,
    });
  }),
);

// POST /api/mos-certificates
mosCertificatesRouter.post(
  '/',
  writePerm,
  asyncHandler(async (req, res) => {
    const body = req.body as {
      contractId: string;
      extractDate?: string;
      deliveryNoteRef?: string;
      notes?: string;
      lines: CreateLineInput[];
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

    const { equivalent: priorEq, supplied: priorSup } = await buildPriorMaps(body.contractId);
    const boqIds = body.lines.map((l) => l.boqItemId);
    const boqRows = await prisma.boqItem.findMany({
      where: { id: { in: boqIds }, contractId: body.contractId, isDeleted: false },
      select: { id: true, tenderQty: true, unitRateTotal: true },
    });
    const boqMap = new Map(boqRows.map((b) => [b.id, b]));

    const lineData: Prisma.MosCertificateLineCreateWithoutCertificateInput[] = [];
    let totalClaimed = 0;

    for (const line of body.lines) {
      if (!line.boqItemId) {
        res.status(400).json({ error: 'Each line requires boqItemId' });
        return;
      }
      const boq = boqMap.get(line.boqItemId);
      if (!boq) {
        res.status(400).json({ error: `BOQ item not found for contract: ${line.boqItemId}` });
        return;
      }

      const suppliedThis = num(line.suppliedQtyThisPeriod);
      const pct = num(line.onSitePercentage);
      if (suppliedThis <= 0) {
        res.status(400).json({ error: 'suppliedQtyThisPeriod must be positive' });
        return;
      }
      if (pct <= 0 || pct > 100) {
        res.status(400).json({ error: 'onSitePercentage must be between 0 and 100' });
        return;
      }

      const unitPrice = roundMoney(num(line.unitPrice) || num(boq.unitRateTotal));
      const priorEquivalent = priorEq[line.boqItemId] ?? 0;
      const priorSupplied = priorSup[line.boqItemId] ?? 0;
      const equivalentQty = roundMoney(suppliedThis * (pct / 100));
      const equivalentCumulative = roundMoney(priorEquivalent + equivalentQty);
      const suppliedCumulative = roundMoney(priorSupplied + suppliedThis);
      const tenderQty = num(boq.tenderQty);

      if (tenderQty > 0 && equivalentCumulative > tenderQty + 0.01) {
        res.status(400).json({
          error: 'equivalent_cumulative_exceeds_tender',
          boqItemId: line.boqItemId,
          equivalentCumulative,
          tenderQty,
        });
        return;
      }

      const claimedAmount = roundMoney(equivalentQty * unitPrice);
      totalClaimed = roundMoney(totalClaimed + claimedAmount);

      lineData.push({
        boqItemId: line.boqItemId,
        suppliedQtyThisPeriod: suppliedThis,
        suppliedQtyCumulative: suppliedCumulative,
        onSitePercentage: pct,
        equivalentQty,
        equivalentCumulative,
        unitPrice,
        claimedAmount,
      });
    }

    const { certificateNo, sequenceNo, phase } = await nextCertificateMeta(body.contractId);
    const id = randomUUID();

    await prisma.mosCertificate.create({
      data: {
        id,
        contractId: body.contractId,
        certificateNo,
        sequenceNo,
        phase,
        extractDate: body.extractDate ?? null,
        deliveryNoteRef: body.deliveryNoteRef?.trim() || null,
        notes: body.notes?.trim() || null,
        status: 'draft',
        totalClaimed,
        createdBy: req.user?.id ?? null,
        lines: { create: lineData },
      },
    });

    await syncMosCertificateRegistry(id);

    const loaded = await loadCertificate(id);
    notifyMosDraft({ id, extractNumber: certificateNo, contractId: body.contractId }, req.user?.id);
    res.status(201).json(loaded);
  }),
);

// POST /api/mos-certificates/:id/approve
mosCertificatesRouter.post(
  '/:id/approve',
  requireModuleWrite('billing'),
  asyncHandler(async (req, res) => {
    const row = await prisma.mosCertificate.findUnique({
      where: { id: req.params.id },
      include: { lines: true },
    });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (row.status !== 'draft') {
      res.status(400).json({ error: `Cannot approve certificate in status: ${row.status}` });
      return;
    }

    await approveMosCertificate(req.params.id, req.user?.id);

    notifyMosResolved(req.params.id);
    res.json(await loadCertificate(req.params.id));
  }),
);
