import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireModuleWrite, requireReferenceRead } from '../middleware/auth.js';
import { withIdempotency } from '../middleware/idempotency.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { modelScalarFields } from '../prisma/dmmf.js';
import { createTransaction } from '../accounting/journal.js';
import { buildSubcontractorIpcEntries } from '../accounting/subcontractorIpcJournal.js';
import { buildServiceIpcEntries } from '../accounting/serviceIpcJournal.js';
import { isServiceIpcKind, SERVICE_IPC_TYPE, type ServiceIpcLine } from '../lib/serviceContractor.js';
import { needsServiceIpcNumber, nextServiceIpcNumberFromExisting } from '../lib/serviceIpcNumber.js';
import { syncBoqActualCostsForIpc, type IpcBoqLineInput } from '../accounting/boqActualFromSources.js';
import {
  notifyServiceIpcResolved,
  notifyServiceIpcSubmitted,
  notifySubcontractorIpcResolved,
  notifySubcontractorIpcSubmitted,
} from '../lib/notificationHooks.js';
import { roundMoney } from '../lib/money.js';
import { assertProjectAccess, priceUnpricedProjectInventory, unitCostInclVat, num } from './inventoryHelpers.js';
import {
  matchReceiptLinesToInvoiceLines,
  receiptLineTotalExVat,
} from './warehouseReceiptInvoiceLink.js';

type DbLike = Prisma.TransactionClient | typeof prisma;

type InvoiceInventoryLine = {
  materialCategoryId?: number;
  itemDescription?: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost?: number;
  boqItemId?: string;
};

/**
 * Price previously unpriced warehouse-receipt qty (do not receive again).
 * Matches each receipt line to an invoice line by material + quantity.
 */
async function applyWarehouseReceiptPricingFromInvoice(
  tx: Prisma.TransactionClient,
  params: {
    receiptId: string;
    purchaseId: string;
    transactionId: string;
    projectId: string;
    vatPct: number;
    invoiceLines: InvoiceInventoryLine[];
    supplierAccountCode: string | null;
    supplierAccountName: string | null;
    userId: string;
  },
): Promise<void> {
  const receipt = await tx.warehouseReceipt.findUnique({
    where: { id: params.receiptId },
    include: { lines: true },
  });
  if (!receipt) {
    throw new Error('استلام المخزن غير موجود');
  }
  if (receipt.status !== 'pending_approval') {
    throw new Error(`لا يمكن اعتماد استلام بحالة: ${receipt.status}`);
  }
  if (receipt.purchaseTransactionId) {
    throw new Error('هذا الاستلام مربوط بفاتورة مسبقاً');
  }
  if (receipt.projectId !== params.projectId) {
    throw new Error('مشروع الفاتورة لا يطابق مشروع الاستلام المخزني');
  }

  const matched = matchReceiptLinesToInvoiceLines(
    receipt.receiptNumber,
    receipt.lines.map((line) => ({
      id: line.id,
      materialCategoryId: Number(line.materialCategoryId),
      quantity: num(line.quantity),
    })),
    params.invoiceLines,
  );

  for (const m of matched) {
    const inventoryUnitCost = unitCostInclVat(m.unitCostExVat, params.vatPct);
    const totalCost = receiptLineTotalExVat(m.quantity, m.unitCostExVat);

    await tx.warehouseReceiptLine.update({
      where: { id: m.receiptLineId },
      data: { unitCost: m.unitCostExVat, totalCost },
    });

    await priceUnpricedProjectInventory(
      tx,
      receipt.projectId,
      m.materialCategoryId,
      m.quantity,
      inventoryUnitCost,
      { referenceType: 'purchase_invoice', referenceId: params.purchaseId },
    );
  }

  await tx.warehouseReceipt.update({
    where: { id: receipt.id },
    data: {
      status: 'approved',
      approvedBy: params.userId,
      approvedAt: new Date(),
      purchaseTransactionId: params.purchaseId,
      transactionId: params.transactionId,
      supplierAccountCode: params.supplierAccountCode,
      supplierAccountName: params.supplierAccountName,
    },
  });
}

type IpcPayloadMeta = {
  items?: unknown[];
  vatPct?: number;
  whtPct?: number;
  execGuaranteePct?: number;
  labourInsurancePct?: number;
  manpowerLevyPct?: number;
  expenseAccountId?: string;
  serviceKind?: string;
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

function optionalPct(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseLinePayload(raw: unknown): IpcPayloadMeta {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.items)) {
    return {
      items: obj.items,
      vatPct: optionalPct(obj.vatPct),
      whtPct: optionalPct(obj.whtPct),
      execGuaranteePct: optionalPct(obj.execGuaranteePct),
      labourInsurancePct: optionalPct(obj.labourInsurancePct),
      manpowerLevyPct: optionalPct(obj.manpowerLevyPct),
      expenseAccountId: obj.expenseAccountId != null ? String(obj.expenseAccountId) : undefined,
      serviceKind: obj.serviceKind != null ? String(obj.serviceKind) : undefined,
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
    items: txType === 'ipc' || txType === SERVICE_IPC_TYPE ? lines : [],
    ...(txType === 'invoice' ? { invoiceLines: lines } : {}),
    vatPct: parsed.vatPct,
    whtPct: parsed.whtPct,
    execGuaranteePct: parsed.execGuaranteePct,
    labourInsurancePct: parsed.labourInsurancePct,
    manpowerLevyPct: parsed.manpowerLevyPct,
    expenseAccountId: parsed.expenseAccountId ?? base.expenseAccountId,
    ...(parsed.serviceKind ? { serviceKind: parsed.serviceKind } : {}),
  };
}

const SERVICE_IPC_NUMBER_SELECT = {
  referenceNumber: true,
  supplierName: true,
  supplierAccountId: true,
  supplierId: true,
  date: true,
} as const;

async function nextServiceIpcNumber(
  target: { supplierName?: string | null; supplierAccountId?: string | null; supplierId?: string | null; date?: string | null },
  client: DbLike = prisma,
): Promise<string> {
  const rows = await client.purchaseTransaction.findMany({
    where: { type: SERVICE_IPC_TYPE },
    select: SERVICE_IPC_NUMBER_SELECT,
  });
  return nextServiceIpcNumberFromExisting(rows, {
    supplierName: String(target.supplierName || 'مورد'),
    supplierAccountId: target.supplierAccountId,
    supplierId: target.supplierId,
    date: target.date,
  });
}

async function upsertLinePayload(
  purchaseTransactionId: string,
  body: Record<string, unknown>,
  client: DbLike = prisma,
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
    await client.purchaseTransactionItem.deleteMany({ where: { purchaseTransactionId } });
    return;
  }

  const payload: IpcPayloadMeta = {
    items: lineSource,
    ...(body.vatPct != null ? { vatPct: Number(body.vatPct) } : {}),
    ...(body.whtPct != null ? { whtPct: Number(body.whtPct) } : {}),
    ...(body.execGuaranteePct != null ? { execGuaranteePct: Number(body.execGuaranteePct) } : {}),
    ...(body.labourInsurancePct != null ? { labourInsurancePct: Number(body.labourInsurancePct) } : {}),
    ...(body.manpowerLevyPct != null ? { manpowerLevyPct: Number(body.manpowerLevyPct) } : {}),
    ...(body.expenseAccountId != null ? { expenseAccountId: String(body.expenseAccountId) } : {}),
    ...(body.serviceKind != null ? { serviceKind: String(body.serviceKind) } : {}),
  };

  await client.purchaseTransactionItem.deleteMany({ where: { purchaseTransactionId } });
  await client.purchaseTransactionItem.create({
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
    (req.method === 'POST' && (path === '/' || path === '' || path === '/post-invoice')) ||
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
    const missing = rows.filter((r) => needsServiceIpcNumber(r.type, r.referenceNumber));
    if (missing.length > 0) {
      let peers = rows
        .filter((r) => r.type === SERVICE_IPC_TYPE)
        .map((r) => ({
          referenceNumber: r.referenceNumber,
          supplierName: r.supplierName,
          supplierAccountId: r.supplierAccountId,
          supplierId: r.supplierId,
          date: r.date,
        }));
      for (const row of missing) {
        const assigned = nextServiceIpcNumberFromExisting(peers, {
          supplierName: row.supplierName || 'مورد',
          supplierAccountId: row.supplierAccountId,
          supplierId: row.supplierId,
          date: row.date,
        });
        await prisma.purchaseTransaction.update({
          where: { id: row.id },
          data: { referenceNumber: assigned },
        });
        row.referenceNumber = assigned;
        peers = peers.concat([{
          referenceNumber: assigned,
          supplierName: row.supplierName,
          supplierAccountId: row.supplierAccountId,
          supplierId: row.supplierId,
          date: row.date,
        }]);
      }
    }
    res.json(rows.map(serializePurchaseRow));
  }),
);

/**
 * Atomic purchase invoice post: GL journal + purchase_transactions row + optional warehouse stock.
 * Prevents orphan journals when the client was offline between glApi.create and purchase create.
 */
purchaseTransactionsRouter.post(
  '/post-invoice',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const body = (req.body ?? {}) as {
      warehouseReceiptId?: string;
      purchase?: Record<string, unknown>;
      journal?: {
        date?: string;
        description?: string;
        reference?: string;
        projectId?: string;
        costCenterId?: string;
        entries?: Array<{
          accountCode: string;
          accountName?: string;
          debit?: number;
          credit?: number;
          costCenterId?: string;
        }>;
      };
      inventory?: {
        projectId?: string;
        vatPct?: number;
        invoiceNumber?: string;
        lines?: Array<{
          materialCategoryId?: number;
          itemDescription?: string;
          unit: string;
          quantity: number;
          unitCost: number;
          totalCost?: number;
          boqItemId?: string;
        }>;
      };
    };

    const purchaseBody = body.purchase ?? {};
    const journal = body.journal ?? {};
    const entries = Array.isArray(journal.entries) ? journal.entries : [];
    if (entries.length === 0) {
      res.status(400).json({ error: 'journal.entries required' });
      return;
    }
    if (String(purchaseBody.type || 'invoice') !== 'invoice') {
      res.status(400).json({ error: 'post-invoice is for type=invoice only' });
      return;
    }

    const warehouseReceiptId =
      body.warehouseReceiptId != null && String(body.warehouseReceiptId).trim()
        ? String(body.warehouseReceiptId).trim()
        : '';

    /** WR-linked invoices must use a unique journal reference (receipt number) — never reuse INV-{supplierRef}. */
    let journalReference =
      journal.reference != null && String(journal.reference).trim()
        ? String(journal.reference).trim()
        : '';
    if (warehouseReceiptId) {
      const receiptForRef = await prisma.warehouseReceipt.findUnique({
        where: { id: warehouseReceiptId },
        select: { receiptNumber: true, status: true, purchaseTransactionId: true },
      });
      if (!receiptForRef) {
        res.status(404).json({ error: 'استلام المخزن غير موجود' });
        return;
      }
      if (receiptForRef.status !== 'pending_approval' && !receiptForRef.purchaseTransactionId) {
        res.status(400).json({
          error: `لا يمكن اعتماد استلام بحالة: ${receiptForRef.status}`,
        });
        return;
      }
      journalReference = `INV-${receiptForRef.receiptNumber}`;
    }

    const { applyConfirmedProjectWarehouseInvoice } = await import('./sqliteCore.js');

    const result = await prisma.$transaction(async (tx) => {
      const glTx = await createTransaction(
        {
          date: String(journal.date || purchaseBody.date || ''),
          description: String(journal.description || purchaseBody.description || 'فاتورة مشتريات'),
          ...(journalReference ? { reference: journalReference } : {}),
          ...(journal.projectId ? { projectId: String(journal.projectId) } : {}),
          ...(journal.costCenterId ? { costCenterId: String(journal.costCenterId) } : {}),
          entries: entries.map((e) => ({
            accountCode: String(e.accountCode),
            accountName: e.accountName != null ? String(e.accountName) : undefined,
            debit: Number(e.debit ?? 0),
            credit: Number(e.credit ?? 0),
            ...(e.costCenterId ? { costCenterId: String(e.costCenterId) } : {}),
          })),
        },
        user.id,
        tx,
      );

      // If this journal was already linked to a purchase (retry / orphan repair), return it.
      const existingLinked = await tx.purchaseTransaction.findFirst({
        where: { transactionId: glTx.id, isDeleted: false },
        include: { items: true },
      });
      if (existingLinked) {
        if (warehouseReceiptId) {
          const alreadyLinkedReceipt = await tx.warehouseReceipt.findFirst({
            where: {
              id: warehouseReceiptId,
              purchaseTransactionId: existingLinked.id,
            },
            select: { id: true },
          });
          if (alreadyLinkedReceipt) {
            return { purchase: existingLinked, transactionId: glTx.id, reused: true as const };
          }
          throw new Error(
            `مرجع القيد «${journalReference || glTx.id}» مرتبط بفاتورة أخرى. أعد المحاولة أو راجع دفتر اليومية.`,
          );
        }
        return { purchase: existingLinked, transactionId: glTx.id, reused: true as const };
      }

      const data = pickFields(purchaseBody, [
        'createdAt',
        'updatedAt',
        'items',
        'invoiceLines',
        'distributedLines',
        'whtPct',
        'execGuaranteePct',
      ]);
      data.id = String(purchaseBody.id || randomUUID());
      data.type = 'invoice';
      data.transactionId = glTx.id;
      data.status = String(purchaseBody.status || 'pending');
      data.isDeleted = false;
      // Ensure WR-linked invoices store the project for filters / audit.
      if (warehouseReceiptId && body.inventory?.projectId && !data.projectId) {
        data.projectId = String(body.inventory.projectId);
      }

      const created = await tx.purchaseTransaction.create({ data: data as never });
      await upsertLinePayload(String(created.id), purchaseBody, tx);

      const inv = body.inventory;
      if (inv?.projectId && Array.isArray(inv.lines) && inv.lines.length > 0) {
        await assertProjectAccess(tx, user, String(inv.projectId));

        if (warehouseReceiptId) {
          let supplierAccountCode: string | null = null;
          let supplierAccountName: string | null =
            purchaseBody.supplierName != null ? String(purchaseBody.supplierName) : null;
          const supplierAccountId =
            purchaseBody.supplierAccountId != null
              ? String(purchaseBody.supplierAccountId).trim()
              : '';
          if (supplierAccountId) {
            const coa = await tx.chartOfAccount.findUnique({ where: { id: supplierAccountId } });
            if (coa) {
              supplierAccountCode = coa.accountCode;
              supplierAccountName =
                supplierAccountName || coa.accountName || coa.accountCode;
            }
          }
          if (!supplierAccountCode) {
            const creditLeaf = entries.find(
              (e) => Number(e.credit ?? 0) > 0 && String(e.accountCode || '').trim().length === 8,
            );
            if (creditLeaf) {
              supplierAccountCode = String(creditLeaf.accountCode).trim();
              supplierAccountName =
                supplierAccountName
                || (creditLeaf.accountName != null ? String(creditLeaf.accountName) : null)
                || supplierAccountCode;
            }
          }

          await applyWarehouseReceiptPricingFromInvoice(tx, {
            receiptId: warehouseReceiptId,
            purchaseId: String(created.id),
            transactionId: glTx.id,
            projectId: String(inv.projectId),
            vatPct: Number(inv.vatPct ?? 0),
            invoiceLines: inv.lines,
            supplierAccountCode,
            supplierAccountName,
            userId: user.id,
          });
        } else {
          await applyConfirmedProjectWarehouseInvoice(tx, {
            invoiceId: String(created.id),
            invoiceNumber: inv.invoiceNumber ?? String(purchaseBody.referenceNumber || created.id),
            invoiceDate: String(purchaseBody.date || journal.date || ''),
            supplierName: purchaseBody.supplierName != null ? String(purchaseBody.supplierName) : null,
            projectId: String(inv.projectId),
            vatPct: Number(inv.vatPct ?? 0),
            lines: inv.lines,
          });
        }
      } else if (warehouseReceiptId) {
        throw new Error('ربط استلام مخزني يتطلب بنود مخزون (inventory.lines) ومشروع');
      }

      const full = await tx.purchaseTransaction.findUnique({
        where: { id: created.id },
        include: { items: true },
      });
      return { purchase: full!, transactionId: glTx.id, reused: false as const };
    });

    res.status(201).json({
      ...serializePurchaseRow(result.purchase),
      transactionId: result.transactionId,
      reusedExisting: result.reused,
      ...(journalReference ? { journalReference } : {}),
    });
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
    const data = pickFields(body, [
      'createdAt',
      'updatedAt',
      'items',
      'invoiceLines',
      'distributedLines',
      'vatPct',
      'whtPct',
      'execGuaranteePct',
      'labourInsurancePct',
      'manpowerLevyPct',
    ]);
    data.id = String(body.id || randomUUID());
    if (needsServiceIpcNumber(data.type ?? body.type, data.referenceNumber)) {
      data.referenceNumber = await nextServiceIpcNumber({
        supplierName: data.supplierName != null ? String(data.supplierName) : '',
        supplierAccountId: data.supplierAccountId != null ? String(data.supplierAccountId) : null,
        supplierId: data.supplierId != null ? String(data.supplierId) : null,
        date: data.date != null ? String(data.date) : '',
      });
    }
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
    if (
      full?.type === SERVICE_IPC_TYPE
      && full.status === 'submitted'
      && !full.transactionId
    ) {
      const serialized = serializePurchaseRow(full);
      const lineItems = (serialized.items ?? []) as ServiceIpcLine[];
      const itemContracts = lineItems.map((i) => String(i.contractId ?? '').trim()).filter(Boolean);
      const itemProjects = lineItems.map((i) => String(i.projectId ?? '').trim()).filter(Boolean);
      const uniqueContracts = [...new Set(itemContracts)];
      const uniqueProjects = [...new Set(itemProjects.concat(full.projectId ? [full.projectId] : []))];
      notifyServiceIpcSubmitted({
        id: full.id,
        referenceNumber: full.referenceNumber,
        contractId: uniqueContracts.length === 1 ? uniqueContracts[0] : null,
        projectId: uniqueProjects.length === 1 ? uniqueProjects[0] : null,
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
    const data = pickFields(body, [
      'id',
      'createdAt',
      'updatedAt',
      'items',
      'invoiceLines',
      'distributedLines',
      'vatPct',
      'whtPct',
      'execGuaranteePct',
      'labourInsurancePct',
      'manpowerLevyPct',
    ]);
    const existing = await prisma.purchaseTransaction.findUnique({
      where: { id: req.params.id },
      select: {
        type: true,
        referenceNumber: true,
        supplierName: true,
        supplierAccountId: true,
        supplierId: true,
        date: true,
      },
    });
    const nextType = data.type ?? existing?.type;
    const nextRef = data.referenceNumber !== undefined ? data.referenceNumber : existing?.referenceNumber;
    if (needsServiceIpcNumber(nextType, nextRef)) {
      data.referenceNumber = await nextServiceIpcNumber({
        supplierName: data.supplierName != null ? String(data.supplierName) : existing?.supplierName,
        supplierAccountId: data.supplierAccountId != null ? String(data.supplierAccountId) : existing?.supplierAccountId,
        supplierId: data.supplierId != null ? String(data.supplierId) : existing?.supplierId,
        date: data.date != null ? String(data.date) : existing?.date,
      });
    }
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
    if (
      full?.type === SERVICE_IPC_TYPE
      && full.status === 'submitted'
      && !full.transactionId
    ) {
      const serialized = serializePurchaseRow(full);
      const lineItems = (serialized.items ?? []) as ServiceIpcLine[];
      const itemContracts = lineItems.map((i) => String(i.contractId ?? '').trim()).filter(Boolean);
      const itemProjects = lineItems.map((i) => String(i.projectId ?? '').trim()).filter(Boolean);
      const uniqueContracts = [...new Set(itemContracts)];
      const uniqueProjects = [...new Set(itemProjects.concat(full.projectId ? [full.projectId] : []))];
      notifyServiceIpcSubmitted({
        id: full.id,
        referenceNumber: full.referenceNumber,
        contractId: uniqueContracts.length === 1 ? uniqueContracts[0] : null,
        projectId: uniqueProjects.length === 1 ? uniqueProjects[0] : null,
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
    notifyServiceIpcResolved(req.params.id);
    res.json({ id: req.params.id });
  }),
);

purchaseTransactionsRouter.post(
  '/:id/approve',
  requireModuleWrite('costs_ipc'),
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
    if (row.type !== 'ipc' && row.type !== SERVICE_IPC_TYPE) {
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

    const serialized = serializePurchaseRow(row);
    const worksValue = roundMoney(Number(row.amount));
    const vatAmount = roundMoney(Number(row.vatAmount));
    const netPayable = roundMoney(Number(row.totalAmount));
    const deductionParams = {
      vatAmount,
      execGuarantee: roundMoney(Number(row.execGuaranteeAmount)),
      whtAmount: roundMoney(Number(row.whtAmount)),
      labourInsurance: roundMoney(Number(row.labourInsuranceAmount)),
      manpowerLevy: roundMoney(Number(row.manpowerLevyAmount)),
      advancePaymentRecovery: roundMoney(Number(row.advancePaymentRecovery)),
      supplierName: row.supplierName,
      supplierAccountCode,
    };

    const isService = row.type === SERVICE_IPC_TYPE;
    const serviceKindRaw = (serialized as { serviceKind?: string }).serviceKind;

    let entries;
    if (isService) {
      if (!isServiceIpcKind(serviceKindRaw)) {
        res.status(400).json({ error: 'Invalid service kind' });
        return;
      }
      entries = buildServiceIpcEntries({
        serviceKind: serviceKindRaw,
        lines: (serialized.items ?? []) as ServiceIpcLine[],
        ...deductionParams,
      });
    } else {
      entries = buildSubcontractorIpcEntries({
        worksValue,
        netPayable,
        ...deductionParams,
      });
    }

    if (isService && entries.filter((e) => e.debit > 0).length === 0) {
      res.status(400).json({ error: 'Service IPC has no period amounts' });
      return;
    }

    const costCenterId = isService ? undefined : (row.contractId ?? undefined);
    const uniqueProjects = isService
      ? [...new Set((serialized.items ?? []).map((i) => String((i as ServiceIpcLine).projectId || '').trim()).filter(Boolean))]
      : [];
    const journalProjectId = isService
      ? (uniqueProjects.length === 1 ? uniqueProjects[0] : undefined)
      : (row.projectId ?? undefined);

    const updated = await prisma.$transaction(async (tx) => {
      const glTx = await createTransaction(
        {
          date: row.date,
          description: row.description || (isService ? `مستخلص خدمة - ${row.supplierName}` : `مستخلص مقاول - ${row.supplierName}`),
          ...(journalProjectId ? { projectId: journalProjectId } : {}),
          ...(costCenterId ? { costCenterId } : {}),
          entries,
        },
        user.id,
        tx,
      );

      const referenceNumber = needsServiceIpcNumber(row.type, row.referenceNumber)
        ? await nextServiceIpcNumber(row, tx)
        : undefined;

      return tx.purchaseTransaction.update({
        where: { id: row.id },
        data: {
          status: 'approved',
          transactionId: glTx.id,
          ...(referenceNumber ? { referenceNumber } : {}),
        },
        include: { items: true },
      });
    });

    if (!isService) {
      const ipcItems = (serialized.items ?? []) as IpcBoqLineInput[];
      await syncBoqActualCostsForIpc({
        purchaseTransactionId: row.id,
        contractId: row.contractId,
        date: row.date,
        items: ipcItems,
      });
    }

    notifySubcontractorIpcResolved(row.id);
    notifyServiceIpcResolved(row.id);
    res.json(serializePurchaseRow(updated));
  }),
);
