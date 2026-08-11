import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuth, requireReferenceRead, requireModuleWrite } from '../middleware/auth.js';
import { withIdempotency } from '../middleware/idempotency.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { Prisma } from '@prisma/client';
import { roundMoney } from '../lib/money.js';
import { businessTodayCompact, businessTodayYmd } from '../lib/businessCalendar.js';
import { syncFixedAssetsFromGl } from '../accounting/fixedAssetGlSync.js';

export const fixedAssetsRouter = Router();
fixedAssetsRouter.use(requireAuth);
fixedAssetsRouter.use(withIdempotency());

const viewPerm = requireReferenceRead('assets' as never);
const writePerm = requireModuleWrite('assets' as never);
/** Pending-setup rows from Actual Costs invoice may be created with costs write. */
const createFromCostsOrAssets = requireModuleWrite('assets' as never, 'costs' as never);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Generate next asset number: FA-YYYYMMDD-NNNN */
async function generateAssetNumber(): Promise<string> {
  const today = businessTodayCompact();
  const prefix = `FA-${today}-`;
  const last = await prisma.fixedAsset.findFirst({
    where: { assetNumber: { startsWith: prefix } },
    orderBy: { assetNumber: 'desc' },
    select: { assetNumber: true },
  });
  const seq = last ? parseInt(last.assetNumber.slice(-4), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/** Compute quarterly depreciation amount from current bookValue */
function computeQuarterlyDepr(
  model: string,
  bookValue: number,
  assetValue: number,
  salvageValue: number,
  usefulLifeYears: number,
  annualRate: number,
): number {
  if (model === 'straight_line') {
    const annual = (assetValue - salvageValue) / usefulLifeYears;
    return roundMoney(annual / 4);
  }
  // declining balance
  return roundMoney((bookValue * annualRate) / 4);
}

/**
 * Compute accumulated depreciation for past periods (for opening entry on old assets).
 * Returns total accumulated from acquisitionDate up to (but NOT including) currentQuarterStart.
 */
function computeOpeningAccumulatedDepr(
  acquisitionDate: string,
  importDateStr: string,
  model: string,
  assetValue: number,
  salvageValue: number,
  usefulLifeYears: number,
  annualRate: number,
): number {
  const acq = new Date(acquisitionDate);
  const imp = new Date(importDateStr);

  // Find start of the first full quarter after acquisitionDate
  const acqYear = acq.getFullYear();
  const acqMonth = acq.getMonth(); // 0-indexed
  // First full quarter start: next quarter boundary after acq
  const firstQtrMonth = Math.ceil((acqMonth + 1) / 3) * 3; // 3,6,9,12
  let firstQtrYear = acqYear;
  let firstQtrStartMonth: number;
  if (firstQtrMonth >= 12) {
    firstQtrStartMonth = 0; // January
    firstQtrYear = acqYear + 1;
  } else {
    firstQtrStartMonth = firstQtrMonth; // 0-indexed
  }
  let qStart = new Date(firstQtrYear, firstQtrStartMonth, 1);

  // Find start of current quarter (quarter of importDate)
  const impYear = imp.getFullYear();
  const impMonth = imp.getMonth();
  const impQtrStartMonth = Math.floor(impMonth / 3) * 3;
  const currentQtrStart = new Date(impYear, impQtrStartMonth, 1);

  let bookValue = assetValue;
  let accumulated = 0;

  while (qStart < currentQtrStart && bookValue > salvageValue) {
    const depr = computeQuarterlyDepr(model, bookValue, assetValue, salvageValue, usefulLifeYears, annualRate);
    const actual = Math.min(depr, bookValue - salvageValue);
    accumulated += actual;
    bookValue -= actual;
    // Advance quarter
    const nextMonth = qStart.getMonth() + 3;
    if (nextMonth >= 12) {
      qStart = new Date(qStart.getFullYear() + 1, nextMonth - 12, 1);
    } else {
      qStart = new Date(qStart.getFullYear(), nextMonth, 1);
    }
  }

  return roundMoney(accumulated);
}

/** Get quarter label + boundaries for a given date */
function quarterForDate(dateStr: string): { label: string; start: string; end: string } {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth();
  const q = Math.floor(month / 3) + 1;
  const startMonth = (q - 1) * 3;
  const endMonth = startMonth + 2;
  const endDay = new Date(year, endMonth + 1, 0).getDate();
  return {
    label: `Q${q}-${year}`,
    start: `${year}-${String(startMonth + 1).padStart(2, '0')}-01`,
    end: `${year}-${String(endMonth + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
  };
}

/** Parse explicit quarter label e.g. "Q2-2026" → start/end dates */
function parsePeriodLabel(label: string): { start: string; end: string } | null {
  const m = label.match(/^Q([1-4])-(\d{4})$/);
  if (!m) return null;
  const q = parseInt(m[1], 10);
  const year = parseInt(m[2], 10);
  const startMonth = (q - 1) * 3;
  const endMonth = startMonth + 2;
  const endDay = new Date(year, endMonth + 1, 0).getDate();
  return {
    start: `${year}-${String(startMonth + 1).padStart(2, '0')}-01`,
    end: `${year}-${String(endMonth + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
  };
}

// ─── Groups ─────────────────────────────────────────────────────────────────

fixedAssetsRouter.get(
  '/groups',
  viewPerm,
  asyncHandler(async (_req, res) => {
    const rows = await prisma.fixedAssetGroup.findMany({
      where: { isDeleted: false },
      orderBy: { id: 'asc' },
    });
    res.json(rows.map((r) => serialize(r)));
  }),
);

fixedAssetsRouter.post(
  '/groups',
  writePerm,
  asyncHandler(async (req, res) => {
    const b = req.body as {
      groupName?: string;
      defaultAssetAccountCode?: string;
      defaultDepreciationAccountCode?: string;
      defaultExpenseAccountCode?: string;
      defaultDepreciationModel?: string;
      defaultUsefulLifeYears?: number;
      defaultAnnualRate?: number;
    };
    const groupName = String(b.groupName ?? '').trim();
    if (!groupName) return res.status(400).json({ error: 'group_name required' });
    const row = await prisma.fixedAssetGroup.create({
      data: {
        groupName,
        defaultAssetAccountCode: String(b.defaultAssetAccountCode ?? '').trim(),
        defaultDepreciationAccountCode: String(b.defaultDepreciationAccountCode ?? '').trim(),
        defaultExpenseAccountCode: String(b.defaultExpenseAccountCode ?? '').trim(),
        defaultDepreciationModel: b.defaultDepreciationModel ?? 'straight_line',
        defaultUsefulLifeYears: new Prisma.Decimal(b.defaultUsefulLifeYears ?? 5),
        defaultAnnualRate: b.defaultAnnualRate != null ? new Prisma.Decimal(b.defaultAnnualRate) : null,
      },
    });
    res.status(201).json(serialize(row));
  }),
);

fixedAssetsRouter.put(
  '/groups/:id',
  writePerm,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const b = req.body as Partial<{
      groupName: string;
      defaultAssetAccountCode: string;
      defaultDepreciationAccountCode: string;
      defaultExpenseAccountCode: string;
      defaultDepreciationModel: string;
      defaultUsefulLifeYears: number;
      defaultAnnualRate: number | null;
    }>;
    const row = await prisma.fixedAssetGroup.update({
      where: { id },
      data: {
        ...(b.groupName != null && { groupName: String(b.groupName).trim() }),
        ...(b.defaultAssetAccountCode != null && { defaultAssetAccountCode: String(b.defaultAssetAccountCode).trim() }),
        ...(b.defaultDepreciationAccountCode != null && { defaultDepreciationAccountCode: String(b.defaultDepreciationAccountCode).trim() }),
        ...(b.defaultExpenseAccountCode != null && { defaultExpenseAccountCode: String(b.defaultExpenseAccountCode).trim() }),
        ...(b.defaultDepreciationModel != null && { defaultDepreciationModel: b.defaultDepreciationModel }),
        ...(b.defaultUsefulLifeYears != null && { defaultUsefulLifeYears: new Prisma.Decimal(b.defaultUsefulLifeYears) }),
        ...(b.defaultAnnualRate !== undefined && {
          defaultAnnualRate: b.defaultAnnualRate != null ? new Prisma.Decimal(b.defaultAnnualRate) : null,
        }),
        updatedAt: new Date(),
      },
    });
    res.json(serialize(row));
  }),
);

// ─── Assets CRUD ────────────────────────────────────────────────────────────

fixedAssetsRouter.get(
  '/',
  viewPerm,
  asyncHandler(async (req, res) => {
    const { status, groupId, costCenterId } = req.query as Record<string, string>;
    const where: Prisma.FixedAssetWhereInput = { isDeleted: false };
    if (status) where.status = status;
    if (groupId) where.groupId = parseInt(groupId, 10);
    if (costCenterId) where.costCenterId = costCenterId;
    const rows = await prisma.fixedAsset.findMany({
      where,
      include: { group: { select: { groupName: true } }, depreciationEntries: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rows.map((r) => serialize(r)));
  }),
);

/** List depreciation entries — must be registered before GET /:id */
fixedAssetsRouter.get(
  '/depreciation',
  viewPerm,
  asyncHandler(async (req, res) => {
    const { periodLabel, assetId } = req.query as Record<string, string>;
    const where: Prisma.FixedAssetDepreciationEntryWhereInput = {};
    if (periodLabel) where.periodLabel = periodLabel;
    if (assetId) where.assetId = assetId;
    const rows = await prisma.fixedAssetDepreciationEntry.findMany({
      where,
      include: { asset: { select: { assetNumber: true, assetName: true } } },
      orderBy: [{ periodLabel: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(rows.map((r) => serialize(r)));
  }),
);

/** Asset register report — must be registered before GET /:id */
fixedAssetsRouter.get(
  '/register-report',
  viewPerm,
  asyncHandler(async (req, res) => {
    const { status } = req.query as { status?: string };
    const where: Prisma.FixedAssetWhereInput = { isDeleted: false };
    if (status) where.status = status;
    const assets = await prisma.fixedAsset.findMany({
      where,
      include: {
        group: { select: { groupName: true } },
        depreciationEntries: { where: { periodLabel: { not: 'OPENING' } }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ groupId: 'asc' }, { assetNumber: 'asc' }],
    });

    const rows = assets.map((a) => {
      const accumulatedDepr = roundMoney(
        Number(a.openingAccumulatedDepr) +
          a.depreciationEntries.reduce((s, e) => s + Number(e.depreciationAmount), 0),
      );
      return {
        ...(serialize(a) as Record<string, unknown>),
        groupName: a.group?.groupName ?? null,
        accumulatedDepreciation: accumulatedDepr,
        netBookValue: roundMoney(Number(a.assetValue) - accumulatedDepr),
      };
    });

    const totals = {
      totalAssetValue: roundMoney(rows.reduce((s, r) => s + ((r as Record<string, unknown>).assetValue as number), 0)),
      totalAccumulatedDepr: roundMoney(rows.reduce((s, r) => s + (r.accumulatedDepreciation as number), 0)),
      totalNetBookValue: roundMoney(rows.reduce((s, r) => s + (r.netBookValue as number), 0)),
    };

    res.json({ rows, totals });
  }),
);

fixedAssetsRouter.get(
  '/:id',
  viewPerm,
  asyncHandler(async (req, res) => {
    const asset = await prisma.fixedAsset.findFirst({
      where: { id: req.params.id, isDeleted: false },
      include: {
        group: true,
        depreciationEntries: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    // Build future depreciation schedule preview (up to fully depreciated)
    const schedule: Array<{
      periodLabel: string;
      periodStart: string;
      periodEnd: string;
      depreciationAmount: number;
      bookValueAfter: number;
    }> = [];

    let bv = Number(asset.bookValue);
    const salvage = Number(asset.salvageValue);
    if (asset.status === 'active' && bv > salvage) {
      const today = businessTodayYmd();
      let { label, start, end } = quarterForDate(today);
      // Advance to next quarter if current already has an entry
      const existingLabels = new Set(asset.depreciationEntries.map((e) => e.periodLabel));
      for (let i = 0; i < 80 && bv > salvage; i++) {
        if (!existingLabels.has(label)) {
          const depr = computeQuarterlyDepr(
            asset.depreciationModel,
            bv,
            Number(asset.assetValue),
            salvage,
            Number(asset.usefulLifeYears),
            Number(asset.annualDepreciationRate),
          );
          const actual = roundMoney(Math.min(depr, bv - salvage));
          bv = roundMoney(bv - actual);
          schedule.push({ periodLabel: label, periodStart: start, periodEnd: end, depreciationAmount: actual, bookValueAfter: bv });
        }
        // Next quarter
        const nextStart = new Date(end);
        nextStart.setDate(nextStart.getDate() + 1);
        const ns = nextStart.toISOString().slice(0, 10);
        const next = quarterForDate(ns);
        label = next.label;
        start = next.start;
        end = next.end;
      }
    }

    res.json({ ...(serialize(asset) as Record<string, unknown>), depreciationSchedule: schedule });
  }),
);

/** Import orphan GL fixed-asset cost debits (11… excl. 119) into the register as pending_setup. */
fixedAssetsRouter.post(
  '/sync-from-gl',
  writePerm,
  asyncHandler(async (_req, res) => {
    const result = await syncFixedAssetsFromGl();
    res.json(result);
  }),
);

fixedAssetsRouter.post(
  '/',
  createFromCostsOrAssets,
  asyncHandler(async (req, res) => {
    const b = req.body as {
      assetName?: string;
      groupId?: number;
      acquisitionDate?: string;
      assetValue?: number;
      salvageValue?: number;
      usefulLifeYears?: number;
      depreciationModel?: string;
      annualDepreciationRate?: number;
      assetAccountCode?: string;
      assetAccountName?: string;
      accumulatedDepreciationAccountCode?: string;
      accumulatedDepreciationAccountName?: string;
      expenseAccountCode?: string;
      expenseAccountName?: string;
      costCenterId?: string;
      costCenterType?: string;
      purchaseTransactionId?: string;
      notes?: string;
      status?: string;
    };

    const assetName = String(b.assetName ?? '').trim();
    const acquisitionDate = String(b.acquisitionDate ?? '').trim();
    const assetValue = Number(b.assetValue ?? 0);
    if (!assetName || !acquisitionDate || assetValue <= 0) {
      return res.status(400).json({ error: 'assetName, acquisitionDate, assetValue required' });
    }

    const assetNumber = await generateAssetNumber();
    const salvageValue = Number(b.salvageValue ?? 0);
    const usefulLifeYears = Number(b.usefulLifeYears ?? 5);
    const depreciationModel = b.depreciationModel ?? 'straight_line';
    const annualRate = b.annualDepreciationRate ?? (depreciationModel === 'straight_line' ? 1 / usefulLifeYears : (2 / usefulLifeYears));

    // Compute opening accumulated depreciation for old assets
    const today = businessTodayYmd();
    const isOld = acquisitionDate < today;
    let openingAccumulatedDepr = 0;

    if (isOld && b.status !== 'pending_setup') {
      openingAccumulatedDepr = computeOpeningAccumulatedDepr(
        acquisitionDate,
        today,
        depreciationModel,
        assetValue,
        salvageValue,
        usefulLifeYears,
        annualRate,
      );
    }

    const bookValue = roundMoney(assetValue - openingAccumulatedDepr);
    const status = b.status ?? (
      b.assetAccountCode && b.expenseAccountCode && b.accumulatedDepreciationAccountCode && b.costCenterId
        ? (isOld ? 'active' : 'active')
        : 'pending_setup'
    );

    const asset = await prisma.fixedAsset.create({
      data: {
        id: randomUUID(),
        assetNumber,
        assetName,
        groupId: b.groupId ?? null,
        acquisitionDate,
        assetValue: new Prisma.Decimal(assetValue),
        salvageValue: new Prisma.Decimal(salvageValue),
        usefulLifeYears: new Prisma.Decimal(usefulLifeYears),
        depreciationModel,
        annualDepreciationRate: new Prisma.Decimal(annualRate),
        assetAccountCode: String(b.assetAccountCode ?? '').trim(),
        assetAccountName: b.assetAccountName ?? null,
        accumulatedDepreciationAccountCode: String(b.accumulatedDepreciationAccountCode ?? '').trim(),
        accumulatedDepreciationAccountName: b.accumulatedDepreciationAccountName ?? null,
        expenseAccountCode: String(b.expenseAccountCode ?? '').trim(),
        expenseAccountName: b.expenseAccountName ?? null,
        costCenterId: b.costCenterId ?? null,
        costCenterType: b.costCenterType ?? null,
        bookValue: new Prisma.Decimal(bookValue),
        openingAccumulatedDepr: new Prisma.Decimal(openingAccumulatedDepr),
        status,
        purchaseTransactionId: b.purchaseTransactionId ?? null,
        notes: b.notes ?? null,
      },
    });

    // If old asset: create OPENING depreciation entry
    if (isOld && openingAccumulatedDepr > 0) {
      const { start: qStart, end: qEnd } = parsePeriodLabel(quarterForDate(acquisitionDate).label) ?? { start: acquisitionDate, end: today };
      await prisma.fixedAssetDepreciationEntry.create({
        data: {
          assetId: asset.id,
          periodLabel: 'OPENING',
          periodStart: acquisitionDate,
          periodEnd: today,
          depreciationAmount: new Prisma.Decimal(openingAccumulatedDepr),
          bookValueBefore: new Prisma.Decimal(assetValue),
          bookValueAfter: new Prisma.Decimal(bookValue),
          status: 'posted',
        },
      });
    }

    res.status(201).json(serialize(asset));
  }),
);

fixedAssetsRouter.put(
  '/:id',
  writePerm,
  asyncHandler(async (req, res) => {
    const existing = await prisma.fixedAsset.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!existing) return res.status(404).json({ error: 'Asset not found' });

    const b = req.body as Partial<{
      assetName: string;
      groupId: number | null;
      acquisitionDate: string;
      assetValue: number;
      salvageValue: number;
      usefulLifeYears: number;
      depreciationModel: string;
      annualDepreciationRate: number;
      assetAccountCode: string;
      assetAccountName: string;
      accumulatedDepreciationAccountCode: string;
      accumulatedDepreciationAccountName: string;
      expenseAccountCode: string;
      expenseAccountName: string;
      costCenterId: string | null;
      costCenterType: string | null;
      notes: string;
      status: string;
    }>;

    // Recompute bookValue if financial fields change
    const newAssetValue = b.assetValue != null ? Number(b.assetValue) : Number(existing.assetValue);
    const newSalvage = b.salvageValue != null ? Number(b.salvageValue) : Number(existing.salvageValue);
    const newUsefulLife = b.usefulLifeYears != null ? Number(b.usefulLifeYears) : Number(existing.usefulLifeYears);
    const newModel = b.depreciationModel ?? existing.depreciationModel;
    const newRate = b.annualDepreciationRate != null ? Number(b.annualDepreciationRate) : Number(existing.annualDepreciationRate);
    const openingDepr = Number(existing.openingAccumulatedDepr);
    const newBookValue = roundMoney(newAssetValue - openingDepr);

    // Determine status: if all required fields are now set → active
    const newExpense = b.expenseAccountCode ?? existing.expenseAccountCode;
    const newAccum = b.accumulatedDepreciationAccountCode ?? existing.accumulatedDepreciationAccountCode;
    const newAssetAcc = b.assetAccountCode ?? existing.assetAccountCode;
    const newCostCenter = b.costCenterId !== undefined ? b.costCenterId : existing.costCenterId;
    const allFieldsSet = newExpense && newAccum && newAssetAcc && newCostCenter;
    const currentStatus = b.status ?? existing.status;
    const resolvedStatus = currentStatus === 'pending_setup' && allFieldsSet ? 'active' : currentStatus;

    const updated = await prisma.fixedAsset.update({
      where: { id: req.params.id },
      data: {
        ...(b.assetName != null && { assetName: String(b.assetName).trim() }),
        ...(b.groupId !== undefined && { groupId: b.groupId }),
        ...(b.acquisitionDate != null && { acquisitionDate: b.acquisitionDate }),
        ...(b.assetValue != null && { assetValue: new Prisma.Decimal(newAssetValue) }),
        ...(b.salvageValue != null && { salvageValue: new Prisma.Decimal(newSalvage) }),
        ...(b.usefulLifeYears != null && { usefulLifeYears: new Prisma.Decimal(newUsefulLife) }),
        ...(b.depreciationModel != null && { depreciationModel: newModel }),
        ...(b.annualDepreciationRate != null && { annualDepreciationRate: new Prisma.Decimal(newRate) }),
        ...(b.assetAccountCode != null && { assetAccountCode: String(b.assetAccountCode).trim() }),
        ...(b.assetAccountName !== undefined && { assetAccountName: b.assetAccountName ?? null }),
        ...(b.accumulatedDepreciationAccountCode != null && { accumulatedDepreciationAccountCode: String(b.accumulatedDepreciationAccountCode).trim() }),
        ...(b.accumulatedDepreciationAccountName !== undefined && { accumulatedDepreciationAccountName: b.accumulatedDepreciationAccountName ?? null }),
        ...(b.expenseAccountCode != null && { expenseAccountCode: String(b.expenseAccountCode).trim() }),
        ...(b.expenseAccountName !== undefined && { expenseAccountName: b.expenseAccountName ?? null }),
        ...(b.costCenterId !== undefined && { costCenterId: b.costCenterId ?? null }),
        ...(b.costCenterType !== undefined && { costCenterType: b.costCenterType ?? null }),
        ...(b.notes !== undefined && { notes: b.notes ?? null }),
        bookValue: new Prisma.Decimal(newBookValue),
        status: resolvedStatus,
        updatedAt: new Date(),
      },
    });
    res.json(serialize(updated));
  }),
);

fixedAssetsRouter.delete(
  '/:id',
  writePerm,
  asyncHandler(async (req, res) => {
    await prisma.fixedAsset.update({
      where: { id: req.params.id },
      data: { isDeleted: true, updatedAt: new Date() },
    });
    res.json({ ok: true });
  }),
);

// ─── Depreciation ────────────────────────────────────────────────────────────

/** Preview depreciation for a quarter — returns per-asset amounts, no GL posted */
fixedAssetsRouter.post(
  '/depreciation/compute',
  viewPerm,
  asyncHandler(async (req, res) => {
    const { periodLabel } = req.body as { periodLabel?: string };
    if (!periodLabel) return res.status(400).json({ error: 'periodLabel required (e.g. Q2-2026)' });
    const bounds = parsePeriodLabel(periodLabel);
    if (!bounds) return res.status(400).json({ error: 'Invalid periodLabel format. Expected Q1-2026' });

    const assets = await prisma.fixedAsset.findMany({
      where: { isDeleted: false, status: 'active' },
    });

    const lines = assets
      .map((a) => {
        const bv = Number(a.bookValue);
        const salvage = Number(a.salvageValue);
        if (bv <= salvage) return null;

        // Check not already posted for this period
        const depr = computeQuarterlyDepr(
          a.depreciationModel,
          bv,
          Number(a.assetValue),
          salvage,
          Number(a.usefulLifeYears),
          Number(a.annualDepreciationRate),
        );
        const actual = roundMoney(Math.min(depr, bv - salvage));
        return {
          assetId: a.id,
          assetNumber: a.assetNumber,
          assetName: a.assetName,
          bookValueBefore: bv,
          depreciationAmount: actual,
          bookValueAfter: roundMoney(bv - actual),
          expenseAccountCode: a.expenseAccountCode,
          expenseAccountName: a.expenseAccountName,
          accumulatedDepreciationAccountCode: a.accumulatedDepreciationAccountCode,
          costCenterId: a.costCenterId,
        };
      })
      .filter(Boolean);

    const total = roundMoney(lines.reduce((s, l) => s + (l?.depreciationAmount ?? 0), 0));
    res.json({ periodLabel, periodStart: bounds.start, periodEnd: bounds.end, lines, total });
  }),
);

/** Post depreciation for a quarter — creates GL entries + updates bookValue */
fixedAssetsRouter.post(
  '/depreciation/post',
  writePerm,
  asyncHandler(async (req, res) => {
    const { periodLabel, lines } = req.body as {
      periodLabel?: string;
      lines?: Array<{
        assetId: string;
        depreciationAmount: number;
        bookValueBefore: number;
        bookValueAfter: number;
        expenseAccountCode: string;
        accumulatedDepreciationAccountCode: string;
        costCenterId?: string | null;
      }>;
    };

    if (!periodLabel || !lines?.length) {
      return res.status(400).json({ error: 'periodLabel and lines required' });
    }
    const bounds = parsePeriodLabel(periodLabel);
    if (!bounds) return res.status(400).json({ error: 'Invalid periodLabel' });

    // Check not already posted
    const alreadyPosted = await prisma.fixedAssetDepreciationEntry.findFirst({
      where: { periodLabel, status: 'posted', asset: { isDeleted: false } },
    });
    if (alreadyPosted) {
      return res.status(409).json({ error: `Depreciation already posted for ${periodLabel}` });
    }

    await prisma.$transaction(async (tx) => {
      for (const line of lines) {
        const asset = await tx.fixedAsset.findFirst({ where: { id: line.assetId, isDeleted: false } });
        if (!asset) continue;

        const bvAfter = roundMoney(Number(line.bookValueAfter));
        const newStatus = bvAfter <= Number(asset.salvageValue) ? 'fully_depreciated' : 'active';

        await tx.fixedAsset.update({
          where: { id: line.assetId },
          data: {
            bookValue: new Prisma.Decimal(bvAfter),
            status: newStatus,
            updatedAt: new Date(),
          },
        });

        await tx.fixedAssetDepreciationEntry.create({
          data: {
            assetId: line.assetId,
            periodLabel,
            periodStart: bounds.start,
            periodEnd: bounds.end,
            depreciationAmount: new Prisma.Decimal(line.depreciationAmount),
            bookValueBefore: new Prisma.Decimal(line.bookValueBefore),
            bookValueAfter: new Prisma.Decimal(bvAfter),
            status: 'posted',
          },
        });
      }
    });

    res.json({ ok: true, periodLabel, posted: lines.length });
  }),
);

// ─── Excel Import ─────────────────────────────────────────────────────────────

fixedAssetsRouter.post(
  '/import',
  writePerm,
  asyncHandler(async (req, res) => {
    const { rows } = req.body as {
      rows?: Array<{
        assetName?: string;
        groupName?: string;
        acquisitionDate?: string;
        assetValue?: number;
        salvageValue?: number;
        usefulLifeYears?: number;
        depreciationModel?: string;
        assetAccountCode?: string;
        assetAccountName?: string;
        accumulatedDepreciationAccountCode?: string;
        accumulatedDepreciationAccountName?: string;
        expenseAccountCode?: string;
        expenseAccountName?: string;
        costCenterId?: string;
        costCenterType?: string;
        notes?: string;
      }>;
    };

    if (!rows?.length) return res.status(400).json({ error: 'rows required' });

    // Preload groups for name lookup
    const groups = await prisma.fixedAssetGroup.findMany({ where: { isDeleted: false } });
    const groupByName = new Map(groups.map((g) => [g.groupName.trim(), g]));

    const today = businessTodayYmd();
    const created: string[] = [];
    const errors: Array<{ row: number; error: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const assetName = String(r.assetName ?? '').trim();
      const acquisitionDate = String(r.acquisitionDate ?? '').trim();
      const assetValue = Number(r.assetValue ?? 0);

      if (!assetName || !acquisitionDate || assetValue <= 0) {
        errors.push({ row: i + 1, error: 'assetName, acquisitionDate, assetValue required' });
        continue;
      }

      const group = r.groupName ? groupByName.get(r.groupName.trim()) : undefined;
      const salvageValue = Number(r.salvageValue ?? 0);
      const usefulLifeYears = Number(r.usefulLifeYears ?? group?.defaultUsefulLifeYears ?? 5);
      const depreciationModel = r.depreciationModel ?? group?.defaultDepreciationModel ?? 'straight_line';
      const annualRate = depreciationModel === 'straight_line' ? 1 / usefulLifeYears : (2 / usefulLifeYears);

      const assetAccountCode = r.assetAccountCode ?? group?.defaultAssetAccountCode ?? '';
      const accumAccCode = r.accumulatedDepreciationAccountCode ?? group?.defaultDepreciationAccountCode ?? '';
      const expenseAccCode = r.expenseAccountCode ?? group?.defaultExpenseAccountCode ?? '';

      const openingAccumulatedDepr = acquisitionDate < today
        ? computeOpeningAccumulatedDepr(acquisitionDate, today, depreciationModel, assetValue, salvageValue, usefulLifeYears, annualRate)
        : 0;

      const bookValue = roundMoney(assetValue - openingAccumulatedDepr);
      const allFieldsSet = assetAccountCode && accumAccCode && expenseAccCode && r.costCenterId;
      const status = allFieldsSet ? 'active' : 'pending_setup';

      try {
        const assetNumber = await generateAssetNumber();
        const asset = await prisma.fixedAsset.create({
          data: {
            id: randomUUID(),
            assetNumber,
            assetName,
            groupId: group?.id ?? null,
            acquisitionDate,
            assetValue: new Prisma.Decimal(assetValue),
            salvageValue: new Prisma.Decimal(salvageValue),
            usefulLifeYears: new Prisma.Decimal(usefulLifeYears),
            depreciationModel,
            annualDepreciationRate: new Prisma.Decimal(annualRate),
            assetAccountCode,
            assetAccountName: r.assetAccountName ?? null,
            accumulatedDepreciationAccountCode: accumAccCode,
            accumulatedDepreciationAccountName: r.accumulatedDepreciationAccountName ?? null,
            expenseAccountCode: expenseAccCode,
            expenseAccountName: r.expenseAccountName ?? null,
            costCenterId: r.costCenterId ?? null,
            costCenterType: r.costCenterType ?? null,
            bookValue: new Prisma.Decimal(bookValue),
            openingAccumulatedDepr: new Prisma.Decimal(openingAccumulatedDepr),
            status,
            notes: r.notes ?? null,
          },
        });

        if (openingAccumulatedDepr > 0) {
          await prisma.fixedAssetDepreciationEntry.create({
            data: {
              assetId: asset.id,
              periodLabel: 'OPENING',
              periodStart: acquisitionDate,
              periodEnd: today,
              depreciationAmount: new Prisma.Decimal(openingAccumulatedDepr),
              bookValueBefore: new Prisma.Decimal(assetValue),
              bookValueAfter: new Prisma.Decimal(bookValue),
              status: 'posted',
            },
          });
        }

        created.push(asset.id);
      } catch (err) {
        errors.push({ row: i + 1, error: String(err) });
      }
    }

    res.json({ created: created.length, errors });
  }),
);
