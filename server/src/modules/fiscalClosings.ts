import { Router } from 'express';
import { requireAuth, requireReferenceRead, requireModuleWrite } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  approveBalanceSheet,
  closeIncomeStatement,
  closeIncomeStatementResidual,
  createFiscalClosing,
  IncomeCloseRequiredError,
  listFiscalClosings,
  postOpeningEntry,
  previewBalanceSheet,
  previewIncomeClose,
  previewOpening,
  reopenFiscalClosing,
} from '../accounting/fiscalPeriodClosingService.js';

export const fiscalClosingsRouter = Router();
fiscalClosingsRouter.use(requireAuth);

const viewPerm = requireReferenceRead('ledger', 'overhead', 'reports');
const adminOnly = requireModuleWrite('overhead');

fiscalClosingsRouter.get(
  '/',
  viewPerm,
  asyncHandler(async (_req, res) => {
    res.json(await listFiscalClosings());
  }),
);

fiscalClosingsRouter.post(
  '/',
  adminOnly,
  asyncHandler(async (req, res) => {
    const body = req.body as {
      label?: string;
      periodStart?: string;
      periodEnd?: string;
      openingDate?: string;
      notes?: string;
    };
    const label = String(body.label ?? '').trim();
    const periodStart = String(body.periodStart ?? '').trim().slice(0, 10);
    const periodEnd = String(body.periodEnd ?? '').trim().slice(0, 10);
    if (!label || !periodStart || !periodEnd) {
      res.status(400).json({ error: 'label, periodStart, and periodEnd are required' });
      return;
    }
    try {
      const row = await createFiscalClosing({
        label,
        periodStart,
        periodEnd,
        openingDate: body.openingDate,
        notes: body.notes,
        createdBy: req.user?.id,
      });
      res.status(201).json(row);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Unique') || msg.includes('Unique constraint')) {
        res.status(409).json({ error: 'A fiscal closing for this date range already exists' });
        return;
      }
      throw e;
    }
  }),
);

fiscalClosingsRouter.get(
  '/preview/income-close',
  viewPerm,
  asyncHandler(async (req, res) => {
    const periodStart = String(req.query.periodStart ?? '').trim().slice(0, 10);
    const periodEnd = String(req.query.periodEnd ?? '').trim().slice(0, 10);
    if (!periodStart || !periodEnd) {
      res.status(400).json({ error: 'periodStart and periodEnd are required' });
      return;
    }
    res.json(await previewIncomeClose(periodStart, periodEnd));
  }),
);

fiscalClosingsRouter.get(
  '/preview/balance-sheet',
  viewPerm,
  asyncHandler(async (req, res) => {
    const periodEnd = String(req.query.periodEnd ?? '').trim().slice(0, 10);
    if (!periodEnd) {
      res.status(400).json({ error: 'periodEnd is required' });
      return;
    }
    res.json(await previewBalanceSheet(periodEnd));
  }),
);

fiscalClosingsRouter.get(
  '/preview/opening',
  viewPerm,
  asyncHandler(async (req, res) => {
    const periodEnd = String(req.query.periodEnd ?? '').trim().slice(0, 10);
    const openingDate = String(req.query.openingDate ?? '').trim().slice(0, 10) || undefined;
    if (!periodEnd) {
      res.status(400).json({ error: 'periodEnd is required' });
      return;
    }
    res.json(await previewOpening(periodEnd, openingDate));
  }),
);

fiscalClosingsRouter.post(
  '/:id/close-income',
  adminOnly,
  asyncHandler(async (req, res) => {
    try {
      res.json(await closeIncomeStatement(String(req.params.id), req.user?.id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: msg });
    }
  }),
);

fiscalClosingsRouter.post(
  '/:id/close-income-residual',
  adminOnly,
  asyncHandler(async (req, res) => {
    try {
      res.json(await closeIncomeStatementResidual(String(req.params.id), req.user?.id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: msg });
    }
  }),
);

fiscalClosingsRouter.post(
  '/:id/approve-balance-sheet',
  adminOnly,
  asyncHandler(async (req, res) => {
    try {
      res.json(await approveBalanceSheet(String(req.params.id), req.user?.id));
    } catch (e) {
      if (e instanceof IncomeCloseRequiredError) {
        res.status(409).json({
          error: e.message,
          code: 'income_close_required',
          periodEnd: e.periodEnd,
          openAccountCount: e.openAccountCount,
          sampleCodes: e.sampleCodes,
        });
        return;
      }
      const err = e as Error & { code?: string; balanceGap?: number };
      if (err.code === 'balance_sheet_unbalanced') {
        res.status(409).json({
          error: 'الميزانية غير متوازنة (الفرق أكبر من 1 جنيه) — لا يمكن الاعتماد',
          code: err.code,
          balanceGap: err.balanceGap,
        });
        return;
      }
      res.status(400).json({ error: err.message || String(e) });
    }
  }),
);

fiscalClosingsRouter.post(
  '/:id/post-opening',
  adminOnly,
  asyncHandler(async (req, res) => {
    try {
      res.json(await postOpeningEntry(String(req.params.id), req.user?.id));
    } catch (e) {
      const err = e as Error & { code?: string; balanceGap?: number };
      if (err.code === 'balance_sheet_unbalanced') {
        res.status(409).json({
          error: 'الميزانية غير متوازنة (الفرق أكبر من 1 جنيه) — لا يمكن إنشاء القيد الافتتاحي',
          code: err.code,
          balanceGap: err.balanceGap,
        });
        return;
      }
      res.status(400).json({ error: err.message || String(e) });
    }
  }),
);

fiscalClosingsRouter.post(
  '/:id/reopen',
  adminOnly,
  asyncHandler(async (req, res) => {
    try {
      res.json(await reopenFiscalClosing(String(req.params.id), req.user?.id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: msg });
    }
  }),
);
