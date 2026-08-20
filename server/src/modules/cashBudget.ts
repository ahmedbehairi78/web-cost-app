import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { requireAuth, requireModuleWrite, requirePermission } from '../middleware/auth.js';
import { withIdempotency } from '../middleware/idempotency.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { roundMoney } from '../lib/money.js';
import { businessTodayCompact } from '../lib/businessCalendar.js';
import {
  computeCashBudgetSummary,
  isCashBudgetPeriodType,
  isCustodyCashLeafCode,
  originKey,
  periodEndFor,
  ymdKey,
} from '../lib/cashBudget.js';
import { buildCashBudgetSuggestion } from '../lib/cashBudgetSuggest.js';

const SIDES = new Set(['obligation', 'source']);

async function nextPeriodNumber(): Promise<string> {
  const day = businessTodayCompact();
  const prefix = `CB-${day}-`;
  const latest = await prisma.cashBudgetPeriod.findFirst({
    where: { periodNumber: { startsWith: prefix } },
    orderBy: { periodNumber: 'desc' },
    select: { periodNumber: true },
  });
  let seq = 1;
  if (latest?.periodNumber) {
    const m = latest.periodNumber.match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

function toLinePayload(row: {
  side: string;
  category: string;
  description: string;
  amount: number;
  dueDate?: string | null;
  origin: string;
  originType?: string | null;
  originId?: string | null;
  projectId?: string | null;
  contractId?: string | null;
  excluded?: boolean;
  sortOrder?: number;
}) {
  return {
    id: randomUUID(),
    side: row.side,
    category: row.category,
    description: row.description,
    amount: roundMoney(Number(row.amount) || 0),
    dueDate: row.dueDate ? ymdKey(row.dueDate) || null : null,
    origin: row.origin === 'manual' ? 'manual' : 'auto',
    originType: row.originType ?? null,
    originId: row.originId ?? null,
    projectId: row.projectId ?? null,
    contractId: row.contractId ?? null,
    excluded: row.excluded === true,
    sortOrder: row.sortOrder ?? 0,
  };
}

function assertDraft(status: string): string | null {
  if (status !== 'draft') return 'الفترة معتمدة — أعد الفتح قبل التعديل';
  return null;
}

export const cashBudgetRouter = Router();
cashBudgetRouter.use(requireAuth);
cashBudgetRouter.use(requirePermission('cash_budget'));
cashBudgetRouter.use(withIdempotency());

cashBudgetRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.cashBudgetPeriod.findMany({
      where: { isDeleted: false },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
      include: { lines: { where: { isDeleted: false } } },
    });
    const list = rows.map((row) => {
      const summary = computeCashBudgetSummary({
        openingBank: Number(row.openingBank),
        openingCash: Number(row.openingCash),
        lines: row.lines.map((l) => ({
          side: l.side,
          category: l.category,
          amount: Number(l.amount),
          excluded: l.excluded,
        })),
      });
      const { lines: _lines, ...header } = row;
      void _lines;
      return { ...header, summary, lineCount: row.lines.length };
    });
    res.json(serialize(list));
  }),
);

cashBudgetRouter.patch(
  '/coa/:accountId/min-balance',
  requireModuleWrite('cash_budget'),
  asyncHandler(async (req, res) => {
    const acc = await prisma.chartOfAccount.findFirst({
      where: { id: req.params.accountId },
    });
    if (!acc) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    if (acc.isGroup || !isCustodyCashLeafCode(acc.accountCode)) {
      res.status(400).json({ error: 'minBalance applies to active 12102… leaf accounts only' });
      return;
    }
    const minBalance = roundMoney(Number(req.body?.minBalance) || 0);
    const updated = await prisma.chartOfAccount.update({
      where: { id: acc.id },
      data: { minBalance },
    });
    res.json(serialize(updated));
  }),
);

cashBudgetRouter.post(
  '/',
  requireModuleWrite('cash_budget'),
  asyncHandler(async (req, res) => {
    const periodType = req.body?.periodType;
    const periodStart = ymdKey(req.body?.periodStart);
    if (!isCashBudgetPeriodType(periodType) || !periodStart) {
      res.status(400).json({ error: 'periodType and periodStart are required' });
      return;
    }
    const periodEnd = periodEndFor(periodType, periodStart);
    const suggested = await buildCashBudgetSuggestion({ periodType, periodStart, periodEnd });
    const created = await prisma.cashBudgetPeriod.create({
      data: {
        id: randomUUID(),
        periodNumber: await nextPeriodNumber(),
        periodType,
        periodStart,
        periodEnd,
        status: 'draft',
        openingBank: suggested.openingBank,
        openingCash: suggested.openingCash,
        notes: typeof req.body?.notes === 'string' ? req.body.notes : null,
        createdBy: req.user?.id ?? null,
        lines: { create: suggested.lines.map((line) => toLinePayload(line)) },
      },
      include: { lines: { where: { isDeleted: false }, orderBy: { sortOrder: 'asc' } } },
    });
    res.status(201).json(serialize(withSummary(created)));
  }),
);

cashBudgetRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await prisma.cashBudgetPeriod.findFirst({
      where: { id: req.params.id, isDeleted: false },
      include: { lines: { where: { isDeleted: false }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(serialize(withSummary(row)));
  }),
);

cashBudgetRouter.patch(
  '/:id',
  requireModuleWrite('cash_budget'),
  asyncHandler(async (req, res) => {
    const row = await prisma.cashBudgetPeriod.findFirst({
      where: { id: req.params.id, isDeleted: false },
    });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const locked = assertDraft(row.status);
    if (locked) {
      res.status(409).json({ error: locked });
      return;
    }
    const data: { notes?: string | null; openingBank?: number; openingCash?: number } = {};
    if (typeof req.body?.notes === 'string' || req.body?.notes === null) data.notes = req.body.notes;
    if (req.body?.openingBank != null) data.openingBank = roundMoney(Number(req.body.openingBank));
    if (req.body?.openingCash != null) data.openingCash = roundMoney(Number(req.body.openingCash));
    const updated = await prisma.cashBudgetPeriod.update({
      where: { id: row.id },
      data,
      include: { lines: { where: { isDeleted: false }, orderBy: { sortOrder: 'asc' } } },
    });
    res.json(serialize(withSummary(updated)));
  }),
);

cashBudgetRouter.post(
  '/:id/suggest',
  requireModuleWrite('cash_budget'),
  asyncHandler(async (req, res) => {
    const row = await prisma.cashBudgetPeriod.findFirst({
      where: { id: req.params.id, isDeleted: false },
      include: { lines: { where: { isDeleted: false } } },
    });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const locked = assertDraft(row.status);
    if (locked) {
      res.status(409).json({ error: locked });
      return;
    }
    if (!isCashBudgetPeriodType(row.periodType)) {
      res.status(400).json({ error: 'Invalid period type' });
      return;
    }
    const suggested = await buildCashBudgetSuggestion({
      periodType: row.periodType,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
    });
    const prevAuto = new Map<string, { excluded: boolean }>();
    for (const line of row.lines) {
      if (line.origin === 'auto' && line.originType && line.originId) {
        prevAuto.set(originKey(line.originType, line.originId), { excluded: line.excluded });
      }
    }
    const mergedAuto = suggested.lines.map((line) => {
      const prev = line.originType && line.originId
        ? prevAuto.get(originKey(line.originType, line.originId))
        : undefined;
      return { ...line, excluded: prev?.excluded === true };
    });
    const keepManualIds = row.lines.filter((l) => l.origin === 'manual').map((l) => l.id);

    await prisma.$transaction(async (tx) => {
      await tx.cashBudgetLine.updateMany({
        where: { periodId: row.id, origin: 'auto', isDeleted: false },
        data: { isDeleted: true },
      });
      if (mergedAuto.length) {
        await tx.cashBudgetLine.createMany({
          data: mergedAuto.map((line) => ({ ...toLinePayload(line), periodId: row.id })),
        });
      }
      await tx.cashBudgetPeriod.update({
        where: { id: row.id },
        data: { openingBank: suggested.openingBank, openingCash: suggested.openingCash },
      });
      void keepManualIds;
    });

    const fresh = await prisma.cashBudgetPeriod.findFirst({
      where: { id: row.id },
      include: { lines: { where: { isDeleted: false }, orderBy: { sortOrder: 'asc' } } },
    });
    res.json(serialize(withSummary(fresh!)));
  }),
);

cashBudgetRouter.post(
  '/:id/lines',
  requireModuleWrite('cash_budget'),
  asyncHandler(async (req, res) => {
    const row = await prisma.cashBudgetPeriod.findFirst({
      where: { id: req.params.id, isDeleted: false },
    });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const locked = assertDraft(row.status);
    if (locked) {
      res.status(409).json({ error: locked });
      return;
    }
    const side = String(req.body?.side ?? '');
    const category = String(req.body?.category ?? 'other').trim() || 'other';
    const description = String(req.body?.description ?? '').trim();
    const amount = roundMoney(Number(req.body?.amount) || 0);
    if (!SIDES.has(side) || !description || amount <= 0) {
      res.status(400).json({ error: 'side, description and amount are required' });
      return;
    }
    const line = await prisma.cashBudgetLine.create({
      data: {
        ...toLinePayload({
          side,
          category,
          description,
          amount,
          dueDate: req.body?.dueDate ?? null,
          origin: 'manual',
          originType: 'manual',
          originId: randomUUID(),
          projectId: req.body?.projectId ?? null,
          contractId: req.body?.contractId ?? null,
        }),
        periodId: row.id,
      },
    });
    res.status(201).json(serialize(line));
  }),
);

cashBudgetRouter.patch(
  '/:id/lines/:lineId',
  requireModuleWrite('cash_budget'),
  asyncHandler(async (req, res) => {
    const line = await prisma.cashBudgetLine.findFirst({
      where: { id: req.params.lineId, periodId: req.params.id, isDeleted: false },
      include: { period: true },
    });
    if (!line) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const locked = assertDraft(line.period.status);
    if (locked) {
      res.status(409).json({ error: locked });
      return;
    }
    const data: Record<string, unknown> = {};
    if (typeof req.body?.description === 'string') data.description = req.body.description.trim();
    if (req.body?.amount != null) data.amount = roundMoney(Number(req.body.amount));
    if (req.body?.dueDate !== undefined) data.dueDate = ymdKey(req.body.dueDate) || null;
    if (typeof req.body?.excluded === 'boolean') data.excluded = req.body.excluded;
    if (typeof req.body?.notes === 'string' || req.body?.notes === null) data.notes = req.body.notes;
    if (typeof req.body?.category === 'string') data.category = req.body.category.trim();
    const updated = await prisma.cashBudgetLine.update({ where: { id: line.id }, data });
    res.json(serialize(updated));
  }),
);

cashBudgetRouter.delete(
  '/:id/lines/:lineId',
  requireModuleWrite('cash_budget'),
  asyncHandler(async (req, res) => {
    const line = await prisma.cashBudgetLine.findFirst({
      where: { id: req.params.lineId, periodId: req.params.id, isDeleted: false },
      include: { period: true },
    });
    if (!line) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const locked = assertDraft(line.period.status);
    if (locked) {
      res.status(409).json({ error: locked });
      return;
    }
    await prisma.cashBudgetLine.update({ where: { id: line.id }, data: { isDeleted: true } });
    res.json({ ok: true });
  }),
);

cashBudgetRouter.post(
  '/:id/approve',
  requireModuleWrite('cash_budget'),
  asyncHandler(async (req, res) => {
    const row = await prisma.cashBudgetPeriod.findFirst({
      where: { id: req.params.id, isDeleted: false },
      include: { lines: { where: { isDeleted: false }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (row.status === 'approved') {
      res.json(serialize(withSummary(row)));
      return;
    }
    const updated = await prisma.cashBudgetPeriod.update({
      where: { id: row.id },
      data: { status: 'approved', approvedBy: req.user?.id ?? null },
      include: { lines: { where: { isDeleted: false }, orderBy: { sortOrder: 'asc' } } },
    });
    res.json(serialize(withSummary(updated)));
  }),
);

cashBudgetRouter.post(
  '/:id/reopen',
  requireModuleWrite('cash_budget'),
  asyncHandler(async (req, res) => {
    const row = await prisma.cashBudgetPeriod.findFirst({
      where: { id: req.params.id, isDeleted: false },
      include: { lines: { where: { isDeleted: false }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const updated = await prisma.cashBudgetPeriod.update({
      where: { id: row.id },
      data: { status: 'draft', approvedBy: null },
      include: { lines: { where: { isDeleted: false }, orderBy: { sortOrder: 'asc' } } },
    });
    res.json(serialize(withSummary(updated)));
  }),
);

cashBudgetRouter.delete(
  '/:id',
  requireModuleWrite('cash_budget'),
  asyncHandler(async (req, res) => {
    const row = await prisma.cashBudgetPeriod.findFirst({
      where: { id: req.params.id, isDeleted: false },
    });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const locked = assertDraft(row.status);
    if (locked) {
      res.status(409).json({ error: locked });
      return;
    }
    await prisma.cashBudgetPeriod.update({ where: { id: row.id }, data: { isDeleted: true } });
    res.json({ ok: true });
  }),
);

function withSummary<T extends {
  openingBank: unknown;
  openingCash: unknown;
  lines: Array<{ side: string; category: string; amount: unknown; excluded: boolean }>;
}>(row: T) {
  const summary = computeCashBudgetSummary({
    openingBank: Number(row.openingBank),
    openingCash: Number(row.openingCash),
    lines: row.lines.map((l) => ({
      side: l.side,
      category: l.category,
      amount: Number(l.amount),
      excluded: l.excluded,
    })),
  });
  return { ...row, summary };
}
