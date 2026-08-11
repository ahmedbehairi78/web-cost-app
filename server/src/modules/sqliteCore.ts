import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { businessTodayYmd } from '../lib/businessCalendar.js';
import type { DbClient } from './inventoryHelpers.js';
import {
  EPSILON,
  assertProjectAccess,
  toMoney,
  unitCostInclVat,
  upsertInventoryReceipt,
  upsertLegacyContractInventoryReceipt,
  upsertProjectInventoryReceipt,
} from './inventoryHelpers.js';

export const sqliteCoreRouter = Router();

sqliteCoreRouter.use(requireAuth);

function dec(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

sqliteCoreRouter.get(
  '/health',
  requirePermission('reports'),
  asyncHandler(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, backend: 'postgres' });
  }),
);

sqliteCoreRouter.get(
  '/migrations',
  requirePermission('reports'),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at
    `;
    res.json({
      ok: true,
      backend: 'postgres',
      migrations: rows.map((r) => ({
        name: r.migration_name,
        appliedAt: r.finished_at?.toISOString() ?? null,
      })),
    });
  }),
);

type AllocationInput = {
  contractId: string;
  quantity: number;
  unitCost?: number;
  totalCost?: number;
};

type PurchaseInvoiceLineInput = {
  materialCategoryId?: number;
  itemDescription?: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost?: number;
  boqItemId?: string;
  /** @deprecated legacy distributed invoices only */
  allocations?: AllocationInput[];
};

type CreatePurchaseInvoicePayload = {
  invoiceId?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  supplierName?: string;
  status?: 'draft' | 'confirmed' | 'posted';
  projectId?: string;
  vatPct?: number;
  lines: PurchaseInvoiceLineInput[];
};

function assertPositiveNumber(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
}

function assertNonNegativeNumber(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative number`);
  }
}

async function resolveMaterialLine(
  client: DbClient,
  line: PurchaseInvoiceLineInput,
  lineIndex: number,
): Promise<{ materialCategoryId: number; itemDescription: string; unit: string }> {
  if (line.materialCategoryId) {
    const cat = await client.materialCategory.findUnique({
      where: { id: line.materialCategoryId },
      select: { id: true, name: true, unit: true },
    });
    if (!cat) throw new Error(`Line ${lineIndex + 1}: material category not found`);
    return {
      materialCategoryId: cat.id,
      itemDescription: cat.name,
      unit: line.unit?.trim() || cat.unit,
    };
  }
  if (!line.itemDescription?.trim()) {
    throw new Error(`Line ${lineIndex + 1} must include materialCategoryId or itemDescription`);
  }
  if (!line.unit?.trim()) {
    throw new Error(`Line ${lineIndex + 1} must include unit`);
  }
  return {
    materialCategoryId: 0,
    itemDescription: line.itemDescription.trim(),
    unit: line.unit.trim(),
  };
}

async function postInventoryReceiptForLine(
  client: DbClient,
  params: {
    contractId: string;
    materialCategoryId: number | null;
    itemDescription: string;
    unit: string;
    quantity: number;
    inventoryUnitCost: number;
  },
): Promise<void> {
  const { contractId, materialCategoryId, itemDescription, unit, quantity, inventoryUnitCost } =
    params;
  if (quantity <= EPSILON) return;

  if (materialCategoryId) {
    await upsertInventoryReceipt(
      client,
      contractId,
      materialCategoryId,
      itemDescription,
      unit,
      quantity,
      inventoryUnitCost,
    );
    return;
  }

  await upsertLegacyContractInventoryReceipt(
    client,
    contractId,
    itemDescription,
    unit,
    quantity,
    inventoryUnitCost,
  );
}

function resolveSurplusInventoryContractId(line: PurchaseInvoiceLineInput): string | undefined {
  return line.allocations?.find((a) => a.contractId?.trim())?.contractId?.trim();
}

async function postProjectInventoryReceiptForLine(
  client: DbClient,
  params: {
    projectId: string;
    invoiceId: string;
    materialCategoryId: number;
    itemDescription: string;
    unit: string;
    quantity: number;
    inventoryUnitCost: number;
  },
): Promise<void> {
  const { projectId, invoiceId, materialCategoryId, itemDescription, unit, quantity, inventoryUnitCost } =
    params;
  if (quantity <= EPSILON || !materialCategoryId) return;
  await upsertProjectInventoryReceipt(
    client,
    projectId,
    materialCategoryId,
    itemDescription,
    unit,
    quantity,
    inventoryUnitCost,
    { referenceType: 'purchase_invoice', referenceId: invoiceId },
  );
}

async function processLegacyDistributedLine(
  client: DbClient,
  line: PurchaseInvoiceLineInput,
  lineIndex: number,
  lineId: number,
  applyInventory: boolean,
  vatPct: number,
): Promise<{
  lineTotal: number;
  lineAllocTotal: number;
  surplusQty: number;
  materialCategoryId: number | null;
  itemDescription: string;
  quantity: number;
  inventoryUnitCost: number;
}> {
  const resolved = await resolveMaterialLine(client, line, lineIndex);
  assertPositiveNumber(line.quantity, `Line ${lineIndex + 1} quantity`);
  assertNonNegativeNumber(line.unitCost, `Line ${lineIndex + 1} unitCost`);

  const lineTotal = toMoney(
    typeof line.totalCost === 'number' ? line.totalCost : line.quantity * line.unitCost,
  );
  if (Math.abs(lineTotal - toMoney(line.quantity * line.unitCost)) > EPSILON) {
    throw new Error(`Line ${lineIndex + 1} totalCost must equal quantity * unitCost`);
  }

  if (!Array.isArray(line.allocations)) {
    throw new Error(`Line ${lineIndex + 1} allocations are required for legacy invoices`);
  }

  const sumQty = toMoney(line.allocations.reduce((s, a) => s + Number(a.quantity || 0), 0));
  if (sumQty - toMoney(line.quantity) > EPSILON) {
    throw new Error(`Line ${lineIndex + 1} allocations quantity exceeds line quantity`);
  }

  const surplusQty = toMoney(line.quantity - sumQty);
  const surplusContractId = resolveSurplusInventoryContractId(line);
  if (surplusQty > EPSILON && !surplusContractId) {
    throw new Error(
      `Line ${lineIndex + 1}: select a contract on the allocation row to receive surplus inventory`,
    );
  }

  const materialCategoryId = resolved.materialCategoryId > 0 ? resolved.materialCategoryId : null;
  const inventoryUnitCost = unitCostInclVat(line.unitCost, vatPct);

  let lineAllocTotal = 0;
  for (const [allocationIndex, allocation] of line.allocations.entries()) {
    const allocQty = Number(allocation.quantity || 0);
    if (allocQty <= EPSILON) continue;

    if (!allocation.contractId) {
      throw new Error(
        `Line ${lineIndex + 1} allocation ${allocationIndex + 1} must include contractId`,
      );
    }

    const allocUnitCost =
      typeof allocation.unitCost === 'number' ? allocation.unitCost : line.unitCost;
    const allocTotal = toMoney(
      typeof allocation.totalCost === 'number' ? allocation.totalCost : allocQty * allocUnitCost,
    );

    await client.purchaseInvoiceAllocation.create({
      data: {
        lineId,
        contractId: allocation.contractId,
        quantity: dec(allocQty),
        unitCost: dec(allocUnitCost),
        totalCost: dec(allocTotal),
      },
    });
    lineAllocTotal = toMoney(lineAllocTotal + allocTotal);

    if (applyInventory) {
      await postInventoryReceiptForLine(client, {
        contractId: allocation.contractId,
        materialCategoryId,
        itemDescription: resolved.itemDescription,
        unit: resolved.unit,
        quantity: allocQty,
        inventoryUnitCost,
      });
    }
  }

  if (applyInventory && surplusQty > EPSILON && surplusContractId) {
    await postInventoryReceiptForLine(client, {
      contractId: surplusContractId,
      materialCategoryId,
      itemDescription: resolved.itemDescription,
      unit: resolved.unit,
      quantity: surplusQty,
      inventoryUnitCost,
    });
  }

  if (lineAllocTotal - lineTotal > EPSILON) {
    throw new Error(`Line ${lineIndex + 1} allocations total exceeds line total`);
  }

  return {
    lineTotal,
    lineAllocTotal,
    surplusQty,
    materialCategoryId,
    itemDescription: resolved.itemDescription,
    quantity: line.quantity,
    inventoryUnitCost,
  };
}

async function processProjectWarehouseLine(
  client: DbClient,
  projectId: string,
  invoiceId: string,
  line: PurchaseInvoiceLineInput,
  lineIndex: number,
  applyInventory: boolean,
  vatPct: number,
): Promise<{
  lineTotal: number;
  materialCategoryId: number | null;
  itemDescription: string;
  quantity: number;
  inventoryUnitCost: number;
}> {
  const resolved = await resolveMaterialLine(client, line, lineIndex);
  if (!resolved.materialCategoryId) {
    throw new Error(`Line ${lineIndex + 1}: materialCategoryId is required for project warehouse`);
  }

  assertPositiveNumber(line.quantity, `Line ${lineIndex + 1} quantity`);
  assertNonNegativeNumber(line.unitCost, `Line ${lineIndex + 1} unitCost`);

  const lineTotal = toMoney(
    typeof line.totalCost === 'number' ? line.totalCost : line.quantity * line.unitCost,
  );
  if (Math.abs(lineTotal - toMoney(line.quantity * line.unitCost)) > EPSILON) {
    throw new Error(`Line ${lineIndex + 1} totalCost must equal quantity * unitCost`);
  }

  const inventoryUnitCost = unitCostInclVat(line.unitCost, vatPct);

  if (applyInventory) {
    await postProjectInventoryReceiptForLine(client, {
      projectId,
      invoiceId,
      materialCategoryId: resolved.materialCategoryId,
      itemDescription: resolved.itemDescription,
      unit: resolved.unit,
      quantity: line.quantity,
      inventoryUnitCost,
    });
  }

  return {
    lineTotal,
    materialCategoryId: resolved.materialCategoryId,
    itemDescription: resolved.itemDescription,
    quantity: line.quantity,
    inventoryUnitCost,
  };
}

/**
 * Apply confirmed project-warehouse stock for a purchase invoice (used by atomic post-invoice).
 * Upserts purchase_invoices header + lines and posts weighted-avg receipts.
 */
export async function applyConfirmedProjectWarehouseInvoice(
  client: DbClient,
  params: {
    invoiceId: string;
    invoiceNumber?: string;
    invoiceDate: string;
    supplierName?: string | null;
    projectId: string;
    vatPct: number;
    lines: PurchaseInvoiceLineInput[];
  },
): Promise<void> {
  const { invoiceId, projectId, vatPct, lines } = params;
  if (!projectId?.trim()) throw new Error('projectId is required');
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('At least one invoice line is required');
  }

  await client.purchaseInvoice.upsert({
    where: { invoiceId },
    create: {
      invoiceId,
      invoiceNumber: params.invoiceNumber ?? invoiceId,
      invoiceDate: params.invoiceDate,
      supplierName: params.supplierName ?? null,
      status: 'confirmed',
      vatPct: dec(vatPct),
      projectId,
    },
    update: {
      invoiceNumber: params.invoiceNumber ?? invoiceId,
      invoiceDate: params.invoiceDate,
      supplierName: params.supplierName ?? null,
      status: 'confirmed',
      vatPct: dec(vatPct),
      projectId,
    },
  });

  // Re-posting the same invoiceId must not duplicate lines / stock.
  const existingLines = await client.purchaseInvoiceLine.count({ where: { invoiceId } });
  if (existingLines > 0) return;

  for (const [lineIndex, line] of lines.entries()) {
    const processed = await processProjectWarehouseLine(
      client,
      projectId,
      invoiceId,
      line,
      lineIndex,
      true,
      vatPct,
    );
    await client.purchaseInvoiceLine.create({
      data: {
        invoiceId,
        materialCategoryId: processed.materialCategoryId,
        itemDescription: processed.itemDescription,
        unit: line.unit?.trim() || 'EA',
        quantity: dec(processed.quantity),
        unitCost: dec(line.unitCost),
        totalCost: dec(processed.lineTotal),
        boqItemId: line.boqItemId ?? null,
      },
    });
  }
}

sqliteCoreRouter.post(
  '/purchase-invoices/distributed',
  requirePermission('costs'),
  asyncHandler(async (req, res) => {
    const body = req.body as CreatePurchaseInvoicePayload;
    const lines = Array.isArray(body?.lines) ? body.lines : [];
    if (lines.length === 0) {
      res.status(400).json({ error: 'At least one invoice line is required' });
      return;
    }

    const invoiceId = String(body.invoiceId || body.invoiceNumber || `INV-${Date.now()}`);
    const invoiceDate = String(body.invoiceDate || businessTodayYmd());
    const status = body.status ?? 'confirmed';
    if (!['draft', 'confirmed', 'posted'].includes(status)) {
      res.status(400).json({ error: 'Invalid invoice status' });
      return;
    }

    const projectId = String(body.projectId || '').trim();
    const hasLegacyAllocations = lines.some(
      (line) => Array.isArray(line.allocations) && line.allocations.length > 0,
    );
    if (!projectId && !hasLegacyAllocations) {
      res.status(400).json({ error: 'projectId is required' });
      return;
    }

    const vatPct = Number(body.vatPct ?? 0);
    const useProjectWarehouse = Boolean(projectId);

    const result = await prisma.$transaction(async (tx) => {
      if (projectId) {
        await assertProjectAccess(tx, req.user, projectId);
      }

      await tx.purchaseInvoice.upsert({
        where: { invoiceId },
        create: {
          invoiceId,
          invoiceNumber: body.invoiceNumber ?? invoiceId,
          invoiceDate,
          supplierName: body.supplierName ?? null,
          status,
          vatPct: dec(vatPct),
          projectId: projectId || null,
        },
        update: {
          invoiceNumber: body.invoiceNumber ?? invoiceId,
          invoiceDate,
          supplierName: body.supplierName ?? null,
          status,
          vatPct: dec(vatPct),
          projectId: projectId || null,
        },
      });

      let invoiceTotal = 0;
      let allocationTotal = 0;
      let surplusQtyTotal = 0;
      const lineResults: Array<Record<string, unknown>> = [];
      const applyInventory = status === 'confirmed' || status === 'posted';

      for (const [lineIndex, line] of lines.entries()) {
        if (useProjectWarehouse) {
          const processed = await processProjectWarehouseLine(
            tx,
            projectId,
            invoiceId,
            line,
            lineIndex,
            applyInventory,
            vatPct,
          );
          const createdLine = await tx.purchaseInvoiceLine.create({
            data: {
              invoiceId,
              materialCategoryId: processed.materialCategoryId,
              itemDescription: processed.itemDescription,
              unit: line.unit?.trim() || 'EA',
              quantity: dec(processed.quantity),
              unitCost: dec(line.unitCost),
              totalCost: dec(processed.lineTotal),
              boqItemId: line.boqItemId ?? null,
            },
          });

          invoiceTotal = toMoney(invoiceTotal + processed.lineTotal);
          lineResults.push({
            lineId: createdLine.id,
            materialCategoryId: processed.materialCategoryId,
            itemDescription: processed.itemDescription,
            quantity: processed.quantity,
            totalCost: processed.lineTotal,
            inventoryUnitCost: processed.inventoryUnitCost,
          });
          continue;
        }

        const resolved = await resolveMaterialLine(tx, line, lineIndex);
        const lineTotalPreview = toMoney(
          typeof line.totalCost === 'number' ? line.totalCost : line.quantity * line.unitCost,
        );
        const createdLine = await tx.purchaseInvoiceLine.create({
          data: {
            invoiceId,
            materialCategoryId: resolved.materialCategoryId > 0 ? resolved.materialCategoryId : null,
            itemDescription: resolved.itemDescription,
            unit: resolved.unit,
            quantity: dec(line.quantity),
            unitCost: dec(line.unitCost),
            totalCost: dec(lineTotalPreview),
            boqItemId: line.boqItemId ?? null,
          },
        });

        const processed = await processLegacyDistributedLine(
          tx,
          line,
          lineIndex,
          createdLine.id,
          applyInventory,
          vatPct,
        );

        invoiceTotal = toMoney(invoiceTotal + processed.lineTotal);
        allocationTotal = toMoney(allocationTotal + processed.lineAllocTotal);
        surplusQtyTotal = toMoney(surplusQtyTotal + processed.surplusQty);
        lineResults.push({
          lineId: createdLine.id,
          materialCategoryId: processed.materialCategoryId,
          itemDescription: processed.itemDescription,
          quantity: processed.quantity,
          totalCost: processed.lineTotal,
          allocationTotalCost: processed.lineAllocTotal,
          surplusQuantity: processed.surplusQty,
          inventoryUnitCost: processed.inventoryUnitCost,
        });
      }

      return {
        invoiceId,
        invoiceDate,
        status,
        vatPct,
        projectId: projectId || null,
        lineCount: lineResults.length,
        invoiceTotal,
        allocationTotal: useProjectWarehouse ? null : allocationTotal,
        surplusQtyTotal: useProjectWarehouse ? null : surplusQtyTotal,
        inventoryUpdated: applyInventory,
        warehouse: useProjectWarehouse ? 'project' : 'contract_legacy',
        lines: lineResults,
      };
    });

    res.status(201).json(serialize({ ok: true, ...result }));
  }),
);

sqliteCoreRouter.post(
  '/purchase-invoices/:invoiceId/confirm',
  requirePermission('costs'),
  asyncHandler(async (req, res) => {
    const { invoiceId } = req.params;

    const result = await prisma.$transaction(async (tx) => {
      const header = await tx.purchaseInvoice.findUnique({ where: { invoiceId } });
      if (!header) throw new Error('Invoice not found');
      if (header.status !== 'draft') throw new Error(`Cannot confirm from status: ${header.status}`);

      const vatPct = Number(header.vatPct);
      const projectId = String(header.projectId || '').trim();

      const lines = await tx.purchaseInvoiceLine.findMany({ where: { invoiceId } });

      if (projectId) {
        await assertProjectAccess(tx, req.user, projectId);
        for (const line of lines) {
          if (!line.materialCategoryId) {
            throw new Error(`Line ${line.id}: material category required`);
          }
          const inventoryUnitCost = unitCostInclVat(Number(line.unitCost), vatPct);
          await postProjectInventoryReceiptForLine(tx, {
            projectId,
            invoiceId,
            materialCategoryId: line.materialCategoryId,
            itemDescription: line.itemDescription,
            unit: line.unit,
            quantity: Number(line.quantity),
            inventoryUnitCost,
          });
        }
      } else {
        for (const line of lines) {
          const inventoryUnitCost = unitCostInclVat(Number(line.unitCost), vatPct);
          const allocations = await tx.purchaseInvoiceAllocation.findMany({
            where: { lineId: line.id },
          });

          let sumAllocQty = 0;
          for (const alloc of allocations) {
            const allocQty = Number(alloc.quantity);
            if (allocQty <= EPSILON) continue;
            sumAllocQty = toMoney(sumAllocQty + allocQty);
            await postInventoryReceiptForLine(tx, {
              contractId: alloc.contractId,
              materialCategoryId: line.materialCategoryId,
              itemDescription: line.itemDescription,
              unit: line.unit,
              quantity: allocQty,
              inventoryUnitCost,
            });
          }

          const surplusQty = toMoney(Number(line.quantity) - sumAllocQty);
          const surplusContractId = allocations.find((a) => a.contractId?.trim())?.contractId?.trim();
          if (surplusQty > EPSILON) {
            if (!surplusContractId) {
              throw new Error(`Line ${line.id}: allocation contract required for surplus inventory`);
            }
            await postInventoryReceiptForLine(tx, {
              contractId: surplusContractId,
              materialCategoryId: line.materialCategoryId,
              itemDescription: line.itemDescription,
              unit: line.unit,
              quantity: surplusQty,
              inventoryUnitCost,
            });
          }
        }
      }

      await tx.purchaseInvoice.update({
        where: { invoiceId },
        data: { status: 'confirmed' },
      });

      return { invoiceId, status: 'confirmed', projectId: projectId || null };
    });

    res.json(serialize({ ok: true, ...result }));
  }),
);
