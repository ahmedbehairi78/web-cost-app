import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth, requireReferenceRead, requireModuleWrite } from '../middleware/auth.js';
import { withIdempotency } from '../middleware/idempotency.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  createTransaction,
  getTransactionById,
  getTransactionByReference,
  hasActiveReversalFor,
  type TransactionInput,
} from '../accounting/journal.js';
import { ensureMissingCoaAccounts, type CoaExtraAccount } from '../accounting/ensureCoaSeed.js';
import { syncBatchCoaAccounts, type CoaSyncRow } from '../accounting/syncCoaBatch.js';
import { journalDateKey, journalDateQueryUpperBound } from '../lib/journalDate.js';
import { businessTodayYmd, resolveBusinessTimeZone } from '../lib/businessCalendar.js';
import { env } from '../env.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { assertTransactionPeriodUnlocked } from '../accounting/periodLock.js';
import { queryContractorCashPayments } from '../lib/contractorCashPayments.js';

/** Ledger module OR operational modules that post journals (Actual Costs, Purchases, Billing, Banks). */
const glReadPerm = requireReferenceRead('ledger', 'costs', 'billing', 'reports', 'inventory', 'subcontractor', 'banks');
const glWritePerm = requireModuleWrite('ledger', 'costs', 'billing', 'inventory', 'subcontractor', 'banks');

export const glRouter = Router();

glRouter.use(requireAuth);
glRouter.use(withIdempotency());

/** Trusted calendar “today” for journal posting (business TZ — not the client device). */
glRouter.get(
  '/business-today',
  glReadPerm,
  asyncHandler(async (_req, res) => {
    const timeZone = resolveBusinessTimeZone(env.businessTimezone);
    res.json({ date: businessTodayYmd(timeZone), timeZone });
  }),
);

/**
 * المسدد for service / subcontractor IPC:
 * cash Dr on contractor leaf (bank transfer, cheque ISS, cash/custody 121…) for given cost centers.
 */
glRouter.get(
  '/contractor-cash-payments',
  glReadPerm,
  asyncHandler(async (req, res) => {
    const accountCode = String(req.query.accountCode ?? '').trim();
    const costCenterIds = String(req.query.costCenterIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const projectIds = String(req.query.projectIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!accountCode) {
      res.status(400).json({ error: 'accountCode is required' });
      return;
    }
    if (costCenterIds.length === 0) {
      res.status(400).json({ error: 'costCenterIds is required' });
      return;
    }
    res.json(
      await queryContractorCashPayments(accountCode, costCenterIds, {
        projectIds: projectIds.length > 0 ? projectIds : undefined,
      }),
    );
  }),
);

/** COA mirror for journal posting — same permission gate as POST /transactions (costs, banks, …). */
glRouter.post(
  '/coa/sync-batch',
  glWritePerm,
  asyncHandler(async (req, res) => {
    const body = req.body as { accounts?: unknown };
    const accounts = Array.isArray(body.accounts)
      ? (body.accounts as CoaSyncRow[]).filter((a) => a && typeof a.accountCode === 'string' && typeof a.id === 'string')
      : [];
    res.json(await syncBatchCoaAccounts(accounts));
  }),
);

glRouter.post(
  '/coa/ensure-missing',
  glWritePerm,
  asyncHandler(async (req, res) => {
    const body = req.body as { codes?: unknown; extras?: unknown };
    const codes = Array.isArray(body.codes) ? body.codes.map(String).filter(Boolean) : undefined;
    const extras = Array.isArray(body.extras)
      ? (body.extras as CoaExtraAccount[]).filter((e) => e && typeof e.accountCode === 'string')
      : undefined;
    res.json(await ensureMissingCoaAccounts({ codes, extras }));
  }),
);

glRouter.get(
  '/transactions/by-reference',
  glReadPerm,
  asyncHandler(async (req, res) => {
    const reference = String(req.query.reference ?? '').trim();
    if (!reference) {
      res.status(400).json({ error: 'reference is required' });
      return;
    }
    try {
      const tx = await getTransactionByReference(reference);
      if (!tx) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.json(tx);
    } catch (e) {
      res.status(409).json({ error: e instanceof Error ? e.message : 'Lookup failed' });
    }
  }),
);

glRouter.get(
  '/transactions/has-reversal',
  glReadPerm,
  asyncHandler(async (req, res) => {
    const reversesReference = String(req.query.reversesReference ?? '').trim();
    res.json({ exists: await hasActiveReversalFor(reversesReference) });
  }),
);

glRouter.get(
  '/transactions/:id',
  glReadPerm,
  asyncHandler(async (req, res) => {
    const tx = await getTransactionById(req.params.id);
    if (!tx) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(tx);
  }),
);

glRouter.get(
  '/transactions',
  glReadPerm,
  asyncHandler(async (req, res) => {
    const yearRaw = req.query.year;
    const dateFrom = String(req.query.dateFrom ?? '').trim();
    const dateTo = String(req.query.dateTo ?? '').trim();
    const projectIdsRaw = String(req.query.projectIds ?? '').trim();
    const accountFrom = String(req.query.accountFrom ?? '').trim();
    const accountTo = String(req.query.accountTo ?? '').trim();
    const take = Math.min(Number(req.query.limit || 500), 5000);

    const where: Prisma.TransactionWhereInput = { isDeleted: false };

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = dateFrom.trim().slice(0, 10);
      if (dateTo) where.date.lte = journalDateQueryUpperBound(dateTo);
    } else if (yearRaw !== undefined && yearRaw !== '') {
      const year = Number(yearRaw);
      where.date = { gte: `${year}-01-01`, lte: `${year}-12-31` };
    }

    if (projectIdsRaw) {
      const projectIds = projectIdsRaw.split(',').map((s) => s.trim()).filter(Boolean);
      if (projectIds.length > 0) {
        const contractRows = await prisma.contract.findMany({
          where: { projectId: { in: projectIds }, isDeleted: false },
          select: { id: true },
        });
        const contractIds = contractRows.map((c) => c.id);
        where.OR = [
          { projectId: { in: projectIds } },
          ...(contractIds.length > 0 ? [{ costCenterId: { in: contractIds } }] : []),
        ];
      }
    }

    if (accountFrom || accountTo) {
      where.entries = {
        some: {
          accountCode: {
            ...(accountFrom ? { gte: accountFrom } : {}),
            ...(accountTo ? { lte: accountTo } : {}),
          },
        },
      };
    }

    const rows = await prisma.transaction.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { date: 'desc' }],
      take,
      include: { entries: { orderBy: { lineNo: 'asc' } } },
    });

    const payload = (serialize(rows) as Record<string, unknown>[]).map((row) => ({
      ...row,
      date: journalDateKey(row.date),
    }));

    res.json(payload);
  }),
);

glRouter.post(
  '/transactions',
  glWritePerm,
  asyncHandler(async (req, res) => {
    const tx = await createTransaction(req.body as TransactionInput, req.user?.id);
    res.status(201).json(tx);
  }),
);

glRouter.delete(
  '/transactions/:id',
  glWritePerm,
  asyncHandler(async (req, res) => {
    await assertTransactionPeriodUnlocked(prisma, req.params.id, req.user?.id);
    await prisma.transaction.update({
      where: { id: req.params.id },
      data: { isDeleted: true },
    });
    res.json({ id: req.params.id });
  }),
);
