import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuth, requireReferenceRead, requireModuleWrite } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { Prisma } from '@prisma/client';
import { serialize } from '../prisma/serialize.js';
import {
  buildOverheadPreview,
  clearProposedLines,
  closeOverheadPeriod,
  loadActiveIndirectCenterIds,
  normalizeBoqLoadingBasis,
  normalizeDistributionBasis,
  persistPeriodBoqLoadingBasis,
  persistPeriodIncludedCenterIds,
  readPeriodBoqLoadingBasis,
  reopenOverheadPeriod,
  saveProposedLines,
  type BoqLoadingBasis,
  type DistributionBasis,
  type ProposedLineInput,
} from '../accounting/overheadAllocation.js';

const VALID_DISTRIBUTION_BASES = new Set<DistributionBasis>(['billing_works', 'contract_value', 'equal', 'revenue_ratio']);
const VALID_BOQ_BASES = new Set<BoqLoadingBasis>(['boq_value', 'boq_qty', 'equal']);

export const overheadAllocationRouter = Router();
overheadAllocationRouter.use(requireAuth);

const viewPerm = requireReferenceRead('overhead');
const writePerm = requireModuleWrite('overhead');

overheadAllocationRouter.get(
  '/periods',
  viewPerm,
  asyncHandler(async (_req, res) => {
    const rows = await prisma.overheadAllocationPeriod.findMany({
      orderBy: [{ periodStart: 'desc' }],
    });
    res.json(rows.map((r) => serialize(r)));
  }),
);

overheadAllocationRouter.post(
  '/periods',
  writePerm,
  asyncHandler(async (req, res) => {
    const body = req.body as {
      label?: string;
      periodStart?: string;
      periodEnd?: string;
      notes?: string;
      distributionBasis?: string;
      boqLoadingBasis?: string;
    };
    const label = String(body.label ?? '').trim();
    const periodStart = String(body.periodStart ?? '').trim();
    const periodEnd = String(body.periodEnd ?? '').trim();
    if (!label || !periodStart || !periodEnd) {
      res.status(400).json({ error: 'label, periodStart, and periodEnd are required' });
      return;
    }
    if (periodStart > periodEnd) {
      res.status(400).json({ error: 'periodStart must be before periodEnd' });
      return;
    }
    const distributionBasis = normalizeDistributionBasis(body.distributionBasis);
    const boqLoadingBasis = normalizeBoqLoadingBasis(body.boqLoadingBasis);
    const defaultIncludedIds = await loadActiveIndirectCenterIds();
    const id = randomUUID();
    let row;
    try {
      row = await prisma.overheadAllocationPeriod.create({
        data: {
          id,
          label,
          periodStart,
          periodEnd,
          distributionBasis,
          boqLoadingBasis,
          includedIndirectCenterIds: defaultIncludedIds,
          status: 'draft',
          notes: body.notes?.trim() || null,
          createdBy: req.user?.id ?? null,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        res.status(409).json({ error: 'فترة توزيع بنفس التواريخ موجودة مسبقاً.' });
        return;
      }
      throw e;
    }
    res.status(201).json(serialize(row));
  }),
);

overheadAllocationRouter.patch(
  '/periods/:id',
  writePerm,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const row = await prisma.overheadAllocationPeriod.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'Period not found' });
      return;
    }
    if (row.status !== 'draft') {
      res.status(400).json({ error: 'Only draft periods can be edited' });
      return;
    }
    const body = req.body as {
      label?: string;
      periodStart?: string;
      periodEnd?: string;
      notes?: string;
      distributionBasis?: string;
      boqLoadingBasis?: string;
      includedIndirectCenterIds?: string[];
    };
    const periodStart = body.periodStart !== undefined ? String(body.periodStart).trim() : row.periodStart;
    const periodEnd = body.periodEnd !== undefined ? String(body.periodEnd).trim() : row.periodEnd;
    if (periodStart > periodEnd) {
      res.status(400).json({ error: 'periodStart must be before periodEnd' });
      return;
    }
    const distributionBasis =
      body.distributionBasis !== undefined
        ? normalizeDistributionBasis(body.distributionBasis)
        : normalizeDistributionBasis(row.distributionBasis);
    const boqLoadingBasis =
      body.boqLoadingBasis !== undefined
        ? normalizeBoqLoadingBasis(body.boqLoadingBasis)
        : await readPeriodBoqLoadingBasis(id);
    const updated = await prisma.overheadAllocationPeriod.update({
      where: { id },
      data: {
        ...(body.label !== undefined ? { label: String(body.label).trim() } : {}),
        periodStart,
        periodEnd,
        distributionBasis,
        ...(body.notes !== undefined ? { notes: body.notes?.trim() || null } : {}),
      },
    });
    if (body.boqLoadingBasis !== undefined) {
      await persistPeriodBoqLoadingBasis(id, boqLoadingBasis);
    }
    if (body.includedIndirectCenterIds !== undefined) {
      await persistPeriodIncludedCenterIds(id, body.includedIndirectCenterIds);
      await clearProposedLines(id);
    }
    if (body.distributionBasis !== undefined || body.boqLoadingBasis !== undefined) {
      await clearProposedLines(id).catch(() => undefined);
    }
    const preview = body.includedIndirectCenterIds !== undefined
      ? await buildOverheadPreview(id)
      : null;
    res.json({
      ...(serialize(updated) as Record<string, unknown>),
      boqLoadingBasis,
      ...(preview
        ? {
            includedIndirectCenterIds: preview.includedIndirectCenterIds,
            indirectCenterSelection: preview.indirectCenterSelection,
          }
        : {}),
    });
  }),
);

overheadAllocationRouter.get(
  '/periods/:id/preview',
  viewPerm,
  asyncHandler(async (req, res) => {
    const preview = await buildOverheadPreview(String(req.params.id));
    res.json(preview);
  }),
);

overheadAllocationRouter.put(
  '/periods/:id/proposed-lines',
  writePerm,
  asyncHandler(async (req, res) => {
    const body = req.body as { lines?: ProposedLineInput[] };
    if (!Array.isArray(body.lines)) {
      res.status(400).json({ error: 'lines array is required' });
      return;
    }
    await saveProposedLines(String(req.params.id), body.lines);
    const preview = await buildOverheadPreview(String(req.params.id));
    res.json(preview);
  }),
);

overheadAllocationRouter.delete(
  '/periods/:id/proposed-lines',
  writePerm,
  asyncHandler(async (req, res) => {
    await clearProposedLines(String(req.params.id));
    const preview = await buildOverheadPreview(String(req.params.id));
    res.json(preview);
  }),
);

overheadAllocationRouter.get(
  '/periods/:id/lines',
  viewPerm,
  asyncHandler(async (req, res) => {
    const lines = await prisma.overheadAllocationLine.findMany({
      where: { periodId: String(req.params.id) },
      include: {
        contract: { select: { contractName: true, contractNumber: true } },
        indirectCenter: { select: { code: true, name: true } },
        transaction: { select: { reference: true } },
      },
    });
    res.json(
      lines.map((l) => ({
        ...(serialize(l) as Record<string, unknown>),
        contractName: l.contract.contractName,
        contractNumber: l.contract.contractNumber,
        indirectCenterCode: l.indirectCenter.code,
        indirectCenterName: l.indirectCenter.name,
        transactionReference: l.transaction?.reference,
      })),
    );
  }),
);

overheadAllocationRouter.post(
  '/periods/:id/close',
  writePerm,
  asyncHandler(async (req, res) => {
    const result = await closeOverheadPeriod(String(req.params.id), req.user?.id);
    res.json(result);
  }),
);

overheadAllocationRouter.post(
  '/periods/:id/reopen',
  requireModuleWrite('overhead'),
  asyncHandler(async (req, res) => {
    await reopenOverheadPeriod(String(req.params.id), req.user?.id);
    res.json({ ok: true });
  }),
);
