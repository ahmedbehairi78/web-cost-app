import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { requireAuth, requireModuleWrite, requireReferenceRead } from '../middleware/auth.js';
import { withIdempotency } from '../middleware/idempotency.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { modelScalarFields } from '../prisma/dmmf.js';
import { postCustodySettlementJournals, type CustodySettlementLine } from '../accounting/custodySettlementJournal.js';
import { syncBoqActualCostsForCustody } from '../accounting/boqActualFromSources.js';
import { notifyCustodySettlementResolved, notifyCustodySettlementSubmitted } from '../lib/notificationHooks.js';
import { hasModuleWrite, normalizeUserPermissions } from '../permissions.js';
import { roundMoney } from '../lib/money.js';
import { getAccessibleProjectIds } from './inventoryHelpers.js';

function pickFields(body: Record<string, unknown>, exclude: string[]): Record<string, unknown> {
  const allowed = modelScalarFields('custodySettlement');
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (exclude.includes(k)) continue;
    if (allowed && !allowed.has(k)) continue;
    data[k] = v;
  }
  return data;
}

function parseItems(raw: unknown): CustodySettlementLine[] {
  if (!Array.isArray(raw)) return [];
  const out: CustodySettlementLine[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    out.push({
      id: o.id != null ? String(o.id) : undefined,
      contractId: o.contractId != null ? String(o.contractId) : '',
      accountCode: String(o.accountCode ?? '').trim(),
      accountName: o.accountName != null ? String(o.accountName) : undefined,
      amount: Number(o.amount) || 0,
      description: o.description != null ? String(o.description) : undefined,
      ...(o.boqItemId != null && String(o.boqItemId).trim()
        ? { boqItemId: String(o.boqItemId).trim() }
        : {}),
    });
  }
  return out;
}

function serializeRow(row: {
  items: { payload: unknown }[];
  [key: string]: unknown;
}) {
  const base = serialize(row) as Record<string, unknown>;
  const payload = row.items[0]?.payload;
  const items = Array.isArray(payload) ? payload : parseItems(payload);
  const txIds = Array.isArray(base.transactionIds) ? base.transactionIds : [];
  return { ...base, items, transactionIds: txIds };
}

async function nextSettlementNumber(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { projectCode: true },
  });
  const code = (project?.projectCode || 'PRJ').replace(/[^A-Za-z0-9-]/g, '').slice(0, 20);
  const prefix = `SET-${code}-`;
  const latest = await prisma.custodySettlement.findFirst({
    where: { projectId, settlementNumber: { startsWith: prefix }, isDeleted: false },
    orderBy: { settlementNumber: 'desc' },
    select: { settlementNumber: true },
  });
  let seq = 1;
  if (latest?.settlementNumber) {
    const m = latest.settlementNumber.match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

async function upsertItems(custodySettlementId: string, items: CustodySettlementLine[]): Promise<void> {
  await prisma.custodySettlementItem.deleteMany({ where: { custodySettlementId } });
  if (items.length === 0) return;
  await prisma.custodySettlementItem.create({
    data: {
      id: randomUUID(),
      custodySettlementId,
      payload: items as object,
    },
  });
}

function computeTotal(items: CustodySettlementLine[]): number {
  return roundMoney(items.reduce((s, i) => s + (Number(i.amount) || 0), 0));
}

function canApproveCustodySettlement(user: NonNullable<Request['user']>): boolean {
  return hasModuleWrite(normalizeUserPermissions(user.permissions), 'ledger');
}

function requireLedgerApprover(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (!canApproveCustodySettlement(req.user)) {
    res.status(403).json({ error: 'Accounting manager approval required' });
    return;
  }
  next();
}

const readMw = requireReferenceRead('costs');
const writeMw = requireModuleWrite('costs');

export const custodySettlementsRouter = Router();

custodySettlementsRouter.use(requireAuth);
custodySettlementsRouter.use(withIdempotency());

custodySettlementsRouter.use((req, res, next) => {
  if (req.method === 'GET') return readMw(req, res, next);
  if (req.method === 'POST' && req.path.endsWith('/approve')) return next();
  const path = req.path || '/';
  const isWrite =
    (req.method === 'POST' && (path === '/' || path === '')) ||
    (req.method === 'PUT' && path !== '/' && path !== '') ||
    (req.method === 'DELETE' && path !== '/' && path !== '');
  if (!isWrite) return next();
  return writeMw(req, res, next);
});

custodySettlementsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const accessible = await getAccessibleProjectIds(prisma, user);
    const where: Record<string, unknown> = { isDeleted: false };
    if (req.query.projectId) where.projectId = String(req.query.projectId);
    if (accessible !== null) {
      where.projectId = req.query.projectId
        ? String(req.query.projectId)
        : { in: accessible };
    }
    const rows = await prisma.custodySettlement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
    res.json(rows.map(serializeRow));
  }),
);

custodySettlementsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await prisma.custodySettlement.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!row || row.isDeleted) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(serializeRow(row));
  }),
);

custodySettlementsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const items = parseItems(body.items);
    const projectId = String(body.projectId || '').trim();
    if (!projectId) {
      res.status(400).json({ error: 'projectId is required' });
      return;
    }
    const data = pickFields(body, [
      'createdAt',
      'updatedAt',
      'items',
      'settlementNumber',
      'transactionIds',
    ]);
    data.id = String(body.id || randomUUID());
    data.projectId = projectId;
    data.settlementNumber = await nextSettlementNumber(projectId);
    data.totalAmount = computeTotal(items);
    data.createdBy = user.id;
    data.transactionIds = [];
    if (!data.status) data.status = 'draft';

    const created = await prisma.custodySettlement.create({ data: data as never });
    await upsertItems(String(created.id), items);
    const full = await prisma.custodySettlement.findUnique({
      where: { id: created.id },
      include: { items: true },
    });
    if (full?.status === 'submitted') {
      notifyCustodySettlementSubmitted({
        id: full.id,
        settlementNumber: full.settlementNumber,
        projectId: full.projectId,
      });
    }
    res.status(201).json(serializeRow(full!));
  }),
);

custodySettlementsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const existing = await prisma.custodySettlement.findUnique({
      where: { id: req.params.id },
    });
    if (!existing || existing.isDeleted) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (existing.status === 'approved') {
      res.status(400).json({ error: 'Approved settlements cannot be edited' });
      return;
    }
    const items = parseItems(body.items);
    const data = pickFields(body, [
      'id',
      'createdAt',
      'updatedAt',
      'items',
      'settlementNumber',
      'transactionIds',
      'createdBy',
      'approvedBy',
    ]);
    if (items.length > 0) data.totalAmount = computeTotal(items);

    const updated = await prisma.custodySettlement.update({
      where: { id: req.params.id },
      data: data as never,
    });
    if (Array.isArray(body.items)) {
      await upsertItems(req.params.id, items);
    }
    const full = await prisma.custodySettlement.findUnique({
      where: { id: updated.id },
      include: { items: true },
    });
    if (
      full?.status === 'submitted'
      && (!existing.transactionIds || (Array.isArray(existing.transactionIds) && (existing.transactionIds as unknown[]).length === 0))
    ) {
      notifyCustodySettlementSubmitted({
        id: full.id,
        settlementNumber: full.settlementNumber,
        projectId: full.projectId,
      });
    }
    res.json(serializeRow(full!));
  }),
);

custodySettlementsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.custodySettlement.findUnique({
      where: { id: req.params.id },
    });
    if (!existing || existing.isDeleted) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (existing.status === 'approved') {
      res.status(400).json({ error: 'Approved settlements cannot be deleted' });
      return;
    }
    await prisma.custodySettlement.update({
      where: { id: req.params.id },
      data: { isDeleted: true },
    });
    notifyCustodySettlementResolved(req.params.id);
    res.json({ id: req.params.id });
  }),
);

custodySettlementsRouter.post(
  '/:id/approve',
  requireLedgerApprover,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const row = await prisma.custodySettlement.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!row || row.isDeleted) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const existingTxIds = Array.isArray(row.transactionIds) ? (row.transactionIds as string[]) : [];
    if (existingTxIds.length > 0) {
      res.status(400).json({ error: 'Journal already posted' });
      return;
    }
    if (row.status !== 'submitted' && row.status !== 'draft') {
      res.status(400).json({ error: `Cannot approve status: ${row.status}` });
      return;
    }

    const items = serializeRow(row).items as CustodySettlementLine[];
    const updated = await prisma.$transaction(async (tx) => {
      const transactionIds = await postCustodySettlementJournals({
        settlementNumber: row.settlementNumber,
        projectId: row.projectId,
        custodyAccountCode: row.custodyAccountCode,
        custodyAccountName: row.custodyAccountName || row.custodyAccountCode,
        date: row.date,
        description: row.description || `تسوية عهدة ${row.settlementNumber}`,
        items,
        userId: user.id,
        client: tx,
      });

      return tx.custodySettlement.update({
        where: { id: row.id },
        data: {
          status: 'approved',
          approvedBy: user.id,
          transactionIds,
        },
        include: { items: true },
      });
    });

    // Report-only: optional BOQ allocation (does not alter GL above).
    await syncBoqActualCostsForCustody({
      custodySettlementId: row.id,
      date: row.date,
      items,
    });

    notifyCustodySettlementResolved(row.id);
    res.json(serializeRow(updated));
  }),
);
