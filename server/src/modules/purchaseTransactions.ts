import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { requireAuth, requireModuleWrite, requireReferenceRead, requireRole } from '../middleware/auth.js';
import { withIdempotency } from '../middleware/idempotency.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { modelScalarFields } from '../prisma/dmmf.js';
import { createTransaction } from '../accounting/journal.js';
import { buildSubcontractorIpcEntries } from '../accounting/subcontractorIpcJournal.js';
import { syncBoqActualCostsForIpc, type IpcBoqLineInput } from '../accounting/boqActualFromSources.js';
import { notifySubcontractorIpcResolved, notifySubcontractorIpcSubmitted } from '../lib/notificationHooks.js';
import { roundMoney } from '../lib/money.js';

type IpcPayloadMeta = {
  items?: unknown[];
  whtPct?: number;
  execGuaranteePct?: number;
  expenseAccountId?: string;
};

function pickFields(body: Record<string, unknown>, exclude: string[]): Record<string, unknown> {
  const allowed = modelScalarFields('purchaseTransaction');
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (exclude.includes(k)) continue;
    if (allowed && !allowed.has(k)) continue;
    data[k] = v;
  }
  return data;
}

function parseLinePayload(raw: unknown): IpcPayloadMeta {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.items)) {
    return {
      items: obj.items,
      whtPct: obj.whtPct != null ? Number(obj.whtPct) : undefined,
      execGuaranteePct: obj.execGuaranteePct != null ? Number(obj.execGuaranteePct) : undefined,
      expenseAccountId: obj.expenseAccountId != null ? String(obj.expenseAccountId) : undefined,
    };
  }
  if (Array.isArray(raw)) return { items: raw };
  return {};
}

function serializePurchaseRow(row: {
  items: { payload: unknown }[];
  type?: string;
  [key: string]: unknown;
}) {
  const base = serialize(row) as Record<string, unknown>;
  const parsed = parseLinePayload(row.items[0]?.payload);
  const lines = parsed.items ?? [];
  const txType = String(row.type ?? base.type ?? '');
  return {
    ...base,
    items: txType === 'ipc' ? lines : [],
    ...(txType === 'invoice' ? { invoiceLines: lines } : {}),
    whtPct: parsed.whtPct,
    execGuaranteePct: parsed.execGuaranteePct,
    expenseAccountId: parsed.expenseAccountId,
  };
}

async function upsertLinePayload(
  purchaseTransactionId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const items = body.items;
  const invoiceLines = body.invoiceLines;
  const distributedLines = body.distributedLines;
  const lineSource = Array.isArray(items)
    ? items
    : Array.isArray(invoiceLines)
      ? invoiceLines
      : Array.isArray(distributedLines)
        ? distributedLines
        : null;

  if (!lineSource || lineSource.length === 0) {
    await prisma.purchaseTransactionItem.deleteMany({ where: { purchaseTransactionId } });
    return;
  }

  const payload: IpcPayloadMeta = {
    items: lineSource,
    ...(body.whtPct != null ? { whtPct: Number(body.whtPct) } : {}),
    ...(body.execGuaranteePct != null ? { execGuaranteePct: Number(body.execGuaranteePct) } : {}),
    ...(body.expenseAccountId != null ? { expenseAccountId: String(body.expenseAccountId) } : {}),
  };

  await prisma.purchaseTransactionItem.deleteMany({ where: { purchaseTransactionId } });
  await prisma.purchaseTransactionItem.create({
    data: {
      id: randomUUID(),
      purchaseTransactionId,
      payload: payload as object,
    },
  });
}

const readMw = requireReferenceRead('costs');
const writeMw = requireModuleWrite('costs');

export const purchaseTransactionsRouter = Router();

purchaseTransactionsRouter.use(requireAuth);
purchaseTransactionsRouter.use(withIdempotency());

purchaseTransactionsRouter.use((req, res, next) => {
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

purchaseTransactionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const where: Record<string, unknown> = { isDeleted: false };
    if (req.query.projectId) where.projectId = String(req.query.projectId);
    if (req.query.contractId) where.contractId = String(req.query.contractId);
    const rows = await prisma.purchaseTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
    res.json(rows.map(serializePurchaseRow));
  }),
);

purchaseTransactionsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await prisma.purchaseTransaction.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(serializePurchaseRow(row));
  }),
);

purchaseTransactionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = pickFields(body, ['createdAt', 'updatedAt', 'items', 'invoiceLines', 'distributedLines', 'whtPct', 'execGuaranteePct']);
    data.id = String(body.id || randomUUID());
    const created = await prisma.purchaseTransaction.create({ data: data as never });
    await upsertLinePayload(String(created.id), body);
    const full = await prisma.purchaseTransaction.findUnique({
      where: { id: created.id },
      include: { items: true },
    });
    if (
      full?.type === 'ipc'
      && full.status === 'submitted'
      && !full.transactionId
    ) {
      notifySubcontractorIpcSubmitted({
        id: full.id,
        referenceNumber: full.referenceNumber,
        contractId: full.contractId,
        supplierName: full.supplierName,
      });
    }
    res.status(201).json(serializePurchaseRow(full!));
  }),
);

purchaseTransactionsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = pickFields(body, ['id', 'createdAt', 'updatedAt', 'items', 'invoiceLines', 'distributedLines', 'whtPct', 'execGuaranteePct']);
    const updated = await prisma.purchaseTransaction.update({
      where: { id: req.params.id },
      data: data as never,
    });
    await upsertLinePayload(req.params.id, body);
    const full = await prisma.purchaseTransaction.findUnique({
      where: { id: updated.id },
      include: { items: true },
    });
    if (
      full?.type === 'ipc'
      && full.status === 'submitted'
      && !full.transactionId
    ) {
      notifySubcontractorIpcSubmitted({
        id: full.id,
        referenceNumber: full.referenceNumber,
        contractId: full.contractId,
        supplierName: full.supplierName,
      });
    }
    res.json(serializePurchaseRow(full!));
  }),
);

purchaseTransactionsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await prisma.purchaseTransaction.update({
      where: { id: req.params.id },
      data: { isDeleted: true },
    });
    notifySubcontractorIpcResolved(req.params.id);
    res.json({ id: req.params.id });
  }),
);

purchaseTransactionsRouter.post(
  '/:id/approve',
  requireRole('admin', 'projects_manager'),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const row = await prisma.purchaseTransaction.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!row || row.isDeleted) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (row.type !== 'ipc') {
      res.status(400).json({ error: 'Not a subcontractor IPC' });
      return;
    }
    if (row.transactionId) {
      res.status(400).json({ error: 'Journal already posted' });
      return;
    }
    if (row.status !== 'submitted' && row.status !== 'draft') {
      res.status(400).json({ error: `Cannot approve status: ${row.status}` });
      return;
    }

    let supplierAccountCode: string | undefined;
    if (row.supplierAccountId) {
      const coa = await prisma.chartOfAccount.findUnique({
        where: { id: row.supplierAccountId },
        select: { accountCode: true },
      });
      supplierAccountCode = coa?.accountCode ?? undefined;
    }

    const worksValue = roundMoney(Number(row.amount));
    const vatAmount = roundMoney(Number(row.vatAmount));
    const netPayable = roundMoney(Number(row.totalAmount));
    const entries = buildSubcontractorIpcEntries({
      worksValue,
      vatAmount,
      netPayable,
      execGuarantee: roundMoney(Number(row.execGuaranteeAmount)),
      whtAmount: roundMoney(Number(row.whtAmount)),
      labourInsurance: roundMoney(Number(row.labourInsuranceAmount)),
      manpowerLevy: roundMoney(Number(row.manpowerLevyAmount)),
      advancePaymentRecovery: roundMoney(Number(row.advancePaymentRecovery)),
      supplierName: row.supplierName,
      supplierAccountCode,
    });

    const costCenterId = row.contractId ?? undefined;
    const tx = await createTransaction(
      {
        date: row.date,
        description: row.description || `مستخلص مقاول - ${row.supplierName}`,
        ...(row.projectId ? { projectId: row.projectId } : {}),
        ...(costCenterId ? { costCenterId } : {}),
        entries,
      },
      user.id,
    );

    // Report-only: allocate period works (currentQty×rate) to BOQ — GL unchanged above.
    const ipcItems = (serializePurchaseRow(row).items ?? []) as IpcBoqLineInput[];
    await syncBoqActualCostsForIpc({
      purchaseTransactionId: row.id,
      contractId: row.contractId,
      date: row.date,
      items: ipcItems,
    });

    const updated = await prisma.purchaseTransaction.update({
      where: { id: row.id },
      data: {
        status: 'approved',
        transactionId: tx.id,
      },
      include: { items: true },
    });

    notifySubcontractorIpcResolved(row.id);
    res.json(serializePurchaseRow(updated));
  }),
);
