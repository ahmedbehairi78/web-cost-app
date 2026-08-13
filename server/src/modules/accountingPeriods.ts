import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { requireAuth, requireReferenceRead, requireModuleWrite } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { dateRangesOverlap } from '../accounting/periodLock.js';
import { assertNoOpenPlBalancesForPeriodLock } from '../accounting/fiscalPeriodClosingService.js';

export const accountingPeriodsRouter = Router();
accountingPeriodsRouter.use(requireAuth);

const viewPerm = requireReferenceRead('ledger', 'overhead');
const adminOnly = requireModuleWrite('overhead');

function parseAllowedUserIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => String(v).trim()).filter(Boolean))];
}

function normalizePeriodPayload(body: {
  label?: string;
  periodStart?: string;
  periodEnd?: string;
}): { label: string; periodStart: string; periodEnd: string } | { error: string } {
  const label = String(body.label ?? '').trim();
  const periodStart = String(body.periodStart ?? '').trim().slice(0, 10);
  const periodEnd = String(body.periodEnd ?? '').trim().slice(0, 10);
  if (!label || !periodStart || !periodEnd) {
    return { error: 'label, periodStart, and periodEnd are required' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    return { error: 'periodStart and periodEnd must be YYYY-MM-DD' };
  }
  if (periodStart > periodEnd) {
    return { error: 'periodStart must be before or equal to periodEnd' };
  }
  return { label, periodStart, periodEnd };
}

accountingPeriodsRouter.get(
  '/',
  viewPerm,
  asyncHandler(async (_req, res) => {
    const rows = await prisma.accountingPeriodLock.findMany({
      orderBy: [{ periodStart: 'desc' }],
    });
    res.json(
      rows.map((r) =>
        serialize({
          ...r,
          allowedUserIds: parseAllowedUserIds(r.allowedUserIds),
        }),
      ),
    );
  }),
);

accountingPeriodsRouter.post(
  '/',
  adminOnly,
  asyncHandler(async (req, res) => {
    const parsed = normalizePeriodPayload(req.body as { label?: string; periodStart?: string; periodEnd?: string });
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { label, periodStart, periodEnd } = parsed;
    const allowedUserIds = parseAllowedUserIds(
      (req.body as { allowedUserIds?: unknown }).allowedUserIds,
    );

    const existing = await prisma.accountingPeriodLock.findMany({
      select: { id: true, label: true, periodStart: true, periodEnd: true },
    });
    const overlap = existing.find((p) =>
      dateRangesOverlap(periodStart, periodEnd, p.periodStart, p.periodEnd),
    );
    if (overlap) {
      res.status(409).json({
        error: `Overlapping period: ${overlap.label} (${overlap.periodStart}–${overlap.periodEnd})`,
      });
      return;
    }

    // Block lock while P&L (4…/5…) still open — income-statement close required first.
    await assertNoOpenPlBalancesForPeriodLock(periodEnd);

    const row = await prisma.accountingPeriodLock.create({
      data: {
        id: randomUUID(),
        label,
        periodStart,
        periodEnd,
        status: 'locked',
        lockedAt: new Date(),
        lockedBy: req.user?.id ?? null,
        allowedUserIds,
      },
    });
    res.status(201).json(
      serialize({
        ...row,
        allowedUserIds: parseAllowedUserIds(row.allowedUserIds),
      }),
    );
  }),
);

accountingPeriodsRouter.post(
  '/:id/lock',
  adminOnly,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.accountingPeriodLock.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Period not found' });
      return;
    }
    if (existing.status !== 'locked') {
      await assertNoOpenPlBalancesForPeriodLock(existing.periodEnd);
    }
    const row = await prisma.accountingPeriodLock.update({
      where: { id },
      data: {
        status: 'locked',
        lockedAt: new Date(),
        lockedBy: req.user?.id ?? null,
      },
    });
    res.json(
      serialize({
        ...row,
        allowedUserIds: parseAllowedUserIds(row.allowedUserIds),
      }),
    );
  }),
);

accountingPeriodsRouter.post(
  '/:id/unlock',
  adminOnly,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.accountingPeriodLock.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Period not found' });
      return;
    }
    const row = await prisma.accountingPeriodLock.update({
      where: { id },
      data: { status: 'open' },
    });
    res.json(
      serialize({
        ...row,
        allowedUserIds: parseAllowedUserIds(row.allowedUserIds),
      }),
    );
  }),
);

accountingPeriodsRouter.put(
  '/:id/allowed-users',
  adminOnly,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.accountingPeriodLock.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Period not found' });
      return;
    }
    const allowedUserIds = parseAllowedUserIds(
      (req.body as { allowedUserIds?: unknown }).allowedUserIds,
    );
    const row = await prisma.accountingPeriodLock.update({
      where: { id },
      data: { allowedUserIds },
    });
    res.json(
      serialize({
        ...row,
        allowedUserIds: parseAllowedUserIds(row.allowedUserIds),
      }),
    );
  }),
);
