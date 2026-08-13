import type Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import {
  bool,
  dec,
  makeCounter,
  nullIfEmpty,
  num,
  parseJsonArray,
  resetPgSequence,
  str,
  type ImportCounts,
} from './helpers.js';
import { resolvePermissionsFromUserData } from '../permissions.js';

export type SqliteImportReport = {
  source: string;
  counts: ImportCounts;
  skipped: ImportCounts;
};

async function projectExists(id: string): Promise<boolean> {
  if (!id) return false;
  const row = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  return Boolean(row);
}

async function contractExists(id: string): Promise<boolean> {
  if (!id) return false;
  const row = await prisma.contract.findUnique({ where: { id }, select: { id: true } });
  return Boolean(row);
}

async function boqItemExists(id: string): Promise<boolean> {
  if (!id) return false;
  const row = await prisma.boqItem.findUnique({ where: { id }, select: { id: true } });
  return Boolean(row);
}

async function transactionExists(id: string | null): Promise<boolean> {
  if (!id) return true;
  const row = await prisma.transaction.findUnique({ where: { id }, select: { id: true } });
  return Boolean(row);
}

async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(randomUUID(), 4);
}

export async function importSqliteWarehouseToPostgres(
  db: Database.Database,
  sourceLabel: string,
): Promise<SqliteImportReport> {
  const { counts, skipped, bump, skip } = makeCounter();

  // ── material_groups ───────────────────────────────────────────────────────
  const groups = db.prepare('SELECT * FROM material_groups ORDER BY id').all() as Record<string, unknown>[];
  for (const row of groups) {
    const id = num(row.id);
    if (!id) continue;
    await prisma.materialGroup.upsert({
      where: { id },
      create: { id, code: str(row.code), name: str(row.name) || str(row.code), nameEn: str(row.name_en) || str(row.nameEn) || null },
      update: { code: str(row.code), name: str(row.name) || str(row.code), nameEn: str(row.name_en) || str(row.nameEn) || null },
    });
    bump('material_groups');
  }
  if (groups.length > 0) await resetPgSequence('material_groups');

  // ── material_categories ───────────────────────────────────────────────────
  const categories = db
    .prepare('SELECT * FROM material_categories ORDER BY id')
    .all() as Record<string, unknown>[];
  for (const row of categories) {
    const id = num(row.id);
    const groupId = num(row.group_id);
    if (!id || !groupId) {
      skip('material_categories_bad_row');
      continue;
    }
    await prisma.materialCategory.upsert({
      where: { id },
      create: {
        id,
        groupId,
        code: str(row.code),
        name: str(row.name) || str(row.code),
        unit: str(row.unit) || 'EA',
      },
      update: {
        groupId,
        code: str(row.code),
        name: str(row.name) || str(row.code),
        unit: str(row.unit) || 'EA',
      },
    });
    bump('material_categories');
  }
  if (categories.length > 0) await resetPgSequence('material_categories');

  // ── boq_item_materials ────────────────────────────────────────────────────
  const boqMaterials = db
    .prepare('SELECT * FROM boq_item_materials ORDER BY id')
    .all() as Record<string, unknown>[];
  for (const row of boqMaterials) {
    const id = num(row.id);
    const boqItemId = str(row.boq_item_id);
    const materialCategoryId = num(row.material_category_id);
    if (!id || !boqItemId || !materialCategoryId) {
      skip('boq_item_materials_bad_row');
      continue;
    }
    if (!(await boqItemExists(boqItemId))) {
      skip('boq_item_materials_missing_boq');
      continue;
    }
    await prisma.boqItemMaterial.upsert({
      where: { id },
      create: { id, boqItemId, materialCategoryId },
      update: { boqItemId, materialCategoryId },
    });
    bump('boq_item_materials');
  }
  if (boqMaterials.length > 0) await resetPgSequence('boq_item_materials');

  // ── purchase_invoices + lines + allocations ───────────────────────────────
  const invoices = db
    .prepare('SELECT * FROM purchase_invoices ORDER BY id')
    .all() as Record<string, unknown>[];
  for (const row of invoices) {
    const id = num(row.id);
    const invoiceId = str(row.invoice_id);
    if (!id || !invoiceId) {
      skip('purchase_invoices_bad_row');
      continue;
    }
    const projectId = nullIfEmpty(row.project_id);
    if (projectId && !(await projectExists(projectId))) {
      skip('purchase_invoices_missing_project');
      continue;
    }
    await prisma.purchaseInvoice.upsert({
      where: { id },
      create: {
        id,
        invoiceId,
        invoiceNumber: nullIfEmpty(row.invoice_number),
        invoiceDate: str(row.invoice_date) || '2000-01-01',
        supplierName: nullIfEmpty(row.supplier_name),
        status: str(row.status) || 'draft',
        notes: nullIfEmpty(row.notes),
        vatPct: dec(row.vat_pct),
        projectId,
      },
      update: {
        status: str(row.status) || 'draft',
        projectId,
      },
    });
    bump('purchase_invoices');
  }
  if (invoices.length > 0) await resetPgSequence('purchase_invoices');

  const invoiceLines = db
    .prepare('SELECT * FROM purchase_invoice_lines ORDER BY id')
    .all() as Record<string, unknown>[];
  for (const row of invoiceLines) {
    const id = num(row.id);
    const invoiceId = str(row.invoice_id);
    if (!id || !invoiceId) {
      skip('purchase_invoice_lines_bad_row');
      continue;
    }
    const materialCategoryId = row.material_category_id != null ? num(row.material_category_id) : null;
    await prisma.purchaseInvoiceLine.upsert({
      where: { id },
      create: {
        id,
        invoiceId,
        itemDescription: str(row.item_description) || '—',
        unit: str(row.unit) || 'EA',
        quantity: dec(row.quantity),
        unitCost: dec(row.unit_cost),
        totalCost: dec(row.total_cost),
        boqItemId: nullIfEmpty(row.boq_item_id),
        materialCategoryId: materialCategoryId || null,
      },
      update: {
        quantity: dec(row.quantity),
        unitCost: dec(row.unit_cost),
        totalCost: dec(row.total_cost),
      },
    });
    bump('purchase_invoice_lines');
  }
  if (invoiceLines.length > 0) await resetPgSequence('purchase_invoice_lines');

  const allocations = db
    .prepare('SELECT * FROM purchase_invoice_allocations ORDER BY id')
    .all() as Record<string, unknown>[];
  for (const row of allocations) {
    const id = num(row.id);
    const lineId = num(row.line_id);
    const contractId = str(row.contract_id);
    if (!id || !lineId || !contractId) {
      skip('purchase_invoice_allocations_bad_row');
      continue;
    }
    if (!(await contractExists(contractId))) {
      skip('purchase_invoice_allocations_missing_contract');
      continue;
    }
    await prisma.purchaseInvoiceAllocation.upsert({
      where: { id },
      create: {
        id,
        lineId,
        contractId,
        quantity: dec(row.quantity),
        unitCost: dec(row.unit_cost),
        totalCost: dec(row.total_cost),
      },
      update: {
        quantity: dec(row.quantity),
        unitCost: dec(row.unit_cost),
        totalCost: dec(row.total_cost),
      },
    });
    bump('purchase_invoice_allocations');
  }
  if (allocations.length > 0) await resetPgSequence('purchase_invoice_allocations');

  // ── project_inventory ─────────────────────────────────────────────────────
  const inventoryRows = db
    .prepare('SELECT * FROM project_inventory ORDER BY id')
    .all() as Record<string, unknown>[];
  for (const row of inventoryRows) {
    const id = num(row.id);
    const projectId = str(row.project_id);
    const materialCategoryId = num(row.material_category_id);
    if (!id || !projectId || !materialCategoryId) {
      skip('project_inventory_bad_row');
      continue;
    }
    if (!(await projectExists(projectId))) {
      skip('project_inventory_missing_project');
      continue;
    }
    await prisma.projectInventory.upsert({
      where: { id },
      create: {
        id,
        projectId,
        materialCategoryId,
        itemDescription: nullIfEmpty(row.item_description),
        unit: str(row.unit) || 'EA',
        quantityIn: dec(row.quantity_in),
        quantityIssued: dec(row.quantity_issued),
        quantityReturned: dec(row.quantity_returned),
        quantityReserved: dec(row.quantity_reserved),
        avgUnitCost: dec(row.avg_unit_cost),
        quantityBalance: dec(row.quantity_balance),
      },
      update: {
        quantityIn: dec(row.quantity_in),
        quantityIssued: dec(row.quantity_issued),
        quantityReturned: dec(row.quantity_returned),
        quantityReserved: dec(row.quantity_reserved),
        avgUnitCost: dec(row.avg_unit_cost),
        quantityBalance: dec(row.quantity_balance),
      },
    });
    bump('project_inventory');
  }
  if (inventoryRows.length > 0) await resetPgSequence('project_inventory');

  // ── project_inventory_movements ───────────────────────────────────────────
  const movements = db
    .prepare('SELECT * FROM project_inventory_movements ORDER BY id')
    .all() as Record<string, unknown>[];
  for (const row of movements) {
    const id = num(row.id);
    const projectId = str(row.project_id);
    const materialCategoryId = num(row.material_category_id);
    if (!id || !projectId || !materialCategoryId) {
      skip('project_inventory_movements_bad_row');
      continue;
    }
    await prisma.projectInventoryMovement.upsert({
      where: { id },
      create: {
        id,
        projectId,
        materialCategoryId,
        movementType: str(row.movement_type) || 'unknown',
        quantity: dec(row.quantity),
        unitCost: row.unit_cost != null ? dec(row.unit_cost) : null,
        referenceType: nullIfEmpty(row.reference_type),
        referenceId: nullIfEmpty(row.reference_id),
        notes: nullIfEmpty(row.notes),
      },
      update: {
        quantity: dec(row.quantity),
        movementType: str(row.movement_type) || 'unknown',
      },
    });
    bump('project_inventory_movements');
  }
  if (movements.length > 0) await resetPgSequence('project_inventory_movements');

  // ── consumption_orders + lines ──────────────────────────────────────────────
  const consumptionOrders = db
    .prepare('SELECT * FROM consumption_orders ORDER BY id')
    .all() as Record<string, unknown>[];
  for (const row of consumptionOrders) {
    const id = num(row.id);
    const contractId = str(row.contract_id);
    const orderNumber = str(row.order_number);
    if (!id || !contractId || !orderNumber) {
      skip('consumption_orders_bad_row');
      continue;
    }
    if (!(await contractExists(contractId))) {
      skip('consumption_orders_missing_contract');
      continue;
    }
    const projectId = nullIfEmpty(row.project_id);
    if (projectId && !(await projectExists(projectId))) {
      skip('consumption_orders_missing_project');
      continue;
    }
    await prisma.consumptionOrder.upsert({
      where: { id },
      create: {
        id,
        orderNumber,
        contractId,
        projectId,
        orderDate: str(row.order_date) || '2000-01-01',
        recordedBy: str(row.recorded_by) || 'migration',
        status: str(row.status) || 'draft',
        expenseAccountCode: nullIfEmpty(row.expense_account_code),
        expenseAccountName: nullIfEmpty(row.expense_account_name),
        notes: nullIfEmpty(row.notes),
      },
      update: {
        status: str(row.status) || 'draft',
        expenseAccountCode: nullIfEmpty(row.expense_account_code),
        expenseAccountName: nullIfEmpty(row.expense_account_name),
      },
    });
    bump('consumption_orders');
  }
  if (consumptionOrders.length > 0) await resetPgSequence('consumption_orders');

  const consumptionLines = db
    .prepare('SELECT * FROM consumption_order_lines ORDER BY id')
    .all() as Record<string, unknown>[];
  for (const row of consumptionLines) {
    const id = num(row.id);
    const orderId = num(row.order_id);
    const boqItemId = str(row.boq_item_id);
    const materialCategoryId = num(row.material_category_id);
    if (!id || !orderId || !boqItemId || !materialCategoryId) {
      skip('consumption_order_lines_bad_row');
      continue;
    }
    await prisma.consumptionOrderLine.upsert({
      where: { id },
      create: {
        id,
        orderId,
        boqItemId,
        materialCategoryId,
        quantity: dec(row.quantity),
        unitCost: dec(row.unit_cost),
        totalCost: dec(row.total_cost),
      },
      update: {
        quantity: dec(row.quantity),
        unitCost: dec(row.unit_cost),
        totalCost: dec(row.total_cost),
      },
    });
    bump('consumption_order_lines');
  }
  if (consumptionLines.length > 0) await resetPgSequence('consumption_order_lines');

  // ── boq_actual_costs ──────────────────────────────────────────────────────
  const actualCosts = db
    .prepare('SELECT * FROM boq_actual_costs ORDER BY id')
    .all() as Record<string, unknown>[];
  for (const row of actualCosts) {
    const id = num(row.id);
    const boqItemId = str(row.boq_item_id);
    const contractId = str(row.contract_id);
    if (!id || !boqItemId || !contractId) {
      skip('boq_actual_costs_bad_row');
      continue;
    }
    const consumptionOrderId = row.consumption_order_id != null ? num(row.consumption_order_id) : null;
    await prisma.boqActualCost.upsert({
      where: { id },
      create: {
        id,
        boqItemId,
        contractId,
        materialCategoryId: row.material_category_id != null ? num(row.material_category_id) : null,
        consumptionOrderId,
        quantity: dec(row.quantity),
        unitCost: dec(row.unit_cost),
        totalCost: dec(row.total_cost),
        costElement: str(row.cost_element) || 'materials',
      },
      update: {
        quantity: dec(row.quantity),
        unitCost: dec(row.unit_cost),
        totalCost: dec(row.total_cost),
      },
    });
    bump('boq_actual_costs');
  }
  if (actualCosts.length > 0) await resetPgSequence('boq_actual_costs');

  // ── return_orders + lines ─────────────────────────────────────────────────
  const returnOrders = db
    .prepare('SELECT * FROM return_orders ORDER BY id')
    .all() as Record<string, unknown>[];
  for (const row of returnOrders) {
    const id = num(row.id);
    const returnNumber = str(row.return_number);
    const projectId = str(row.project_id);
    const contractId = str(row.contract_id);
    if (!id || !returnNumber || !projectId || !contractId) {
      skip('return_orders_bad_row');
      continue;
    }
    if (!(await projectExists(projectId)) || !(await contractExists(contractId))) {
      skip('return_orders_missing_refs');
      continue;
    }
    await prisma.returnOrder.upsert({
      where: { id },
      create: {
        id,
        returnNumber,
        projectId,
        contractId,
        returnDate: str(row.return_date) || '2000-01-01',
        recordedBy: str(row.recorded_by) || 'migration',
        status: str(row.status) || 'draft',
        notes: nullIfEmpty(row.notes),
      },
      update: { status: str(row.status) || 'draft' },
    });
    bump('return_orders');
  }
  if (returnOrders.length > 0) await resetPgSequence('return_orders');

  const returnLines = db
    .prepare('SELECT * FROM return_order_lines ORDER BY id')
    .all() as Record<string, unknown>[];
  for (const row of returnLines) {
    const id = num(row.id);
    const returnOrderId = num(row.return_order_id);
    const consumptionOrderLineId = num(row.consumption_order_line_id);
    const materialCategoryId = num(row.material_category_id);
    const boqItemId = str(row.boq_item_id);
    if (!id || !returnOrderId || !consumptionOrderLineId || !materialCategoryId || !boqItemId) {
      skip('return_order_lines_bad_row');
      continue;
    }
    await prisma.returnOrderLine.upsert({
      where: { id },
      create: {
        id,
        returnOrderId,
        consumptionOrderLineId,
        materialCategoryId,
        boqItemId,
        quantity: dec(row.quantity),
        unitCost: dec(row.unit_cost),
        totalCost: dec(row.total_cost),
        reason: nullIfEmpty(row.reason),
      },
      update: {
        quantity: dec(row.quantity),
        unitCost: dec(row.unit_cost),
        totalCost: dec(row.total_cost),
      },
    });
    bump('return_order_lines');
  }
  if (returnLines.length > 0) await resetPgSequence('return_order_lines');

  // ── project_inventory_transfers + lines ───────────────────────────────────
  const transfers = db
    .prepare('SELECT * FROM project_inventory_transfers ORDER BY id')
    .all() as Record<string, unknown>[];
  for (const row of transfers) {
    const id = num(row.id);
    const transferNumber = str(row.transfer_number);
    const fromProjectId = str(row.from_project_id);
    const toProjectId = str(row.to_project_id);
    if (!id || !transferNumber || !fromProjectId || !toProjectId) {
      skip('project_inventory_transfers_bad_row');
      continue;
    }
    if (!(await projectExists(fromProjectId)) || !(await projectExists(toProjectId))) {
      skip('project_inventory_transfers_missing_project');
      continue;
    }
    const transactionId = nullIfEmpty(row.transaction_id);
    const resolvedTxId =
      transactionId && (await transactionExists(transactionId)) ? transactionId : null;
    if (transactionId && !resolvedTxId) skip('project_inventory_transfers_missing_tx');
    await prisma.projectInventoryTransfer.upsert({
      where: { id },
      create: {
        id,
        transferNumber,
        transferDate: str(row.transfer_date) || '2000-01-01',
        fromProjectId,
        toProjectId,
        status: str(row.status) || 'pending',
        createdBy: str(row.created_by) || 'migration',
        approvedByB: nullIfEmpty(row.approved_by_b),
        approvedByProjects: nullIfEmpty(row.approved_by_projects),
        rejectionReason: nullIfEmpty(row.rejection_reason),
        notes: nullIfEmpty(row.notes),
        transactionId: resolvedTxId,
      },
      update: {
        status: str(row.status) || 'pending',
        transactionId: resolvedTxId,
      },
    });
    bump('project_inventory_transfers');
  }
  if (transfers.length > 0) await resetPgSequence('project_inventory_transfers');

  const transferLines = db
    .prepare('SELECT * FROM project_inventory_transfer_lines ORDER BY id')
    .all() as Record<string, unknown>[];
  for (const row of transferLines) {
    const id = num(row.id);
    const transferId = num(row.transfer_id);
    const projectInventoryId = num(row.project_inventory_id);
    const materialCategoryId = num(row.material_category_id);
    if (!id || !transferId || !projectInventoryId || !materialCategoryId) {
      skip('project_inventory_transfer_lines_bad_row');
      continue;
    }
    await prisma.projectInventoryTransferLine.upsert({
      where: { id },
      create: {
        id,
        transferId,
        projectInventoryId,
        materialCategoryId,
        quantity: dec(row.quantity),
        unitCost: dec(row.unit_cost),
        totalCost: dec(row.total_cost),
      },
      update: {
        quantity: dec(row.quantity),
        unitCost: dec(row.unit_cost),
        totalCost: dec(row.total_cost),
      },
    });
    bump('project_inventory_transfer_lines');
  }
  if (transferLines.length > 0) await resetPgSequence('project_inventory_transfer_lines');

  // ── material_on_site_extracts (MOS) ───────────────────────────────────────
  let mosRows: Record<string, unknown>[] = [];
  try {
    mosRows = db
      .prepare('SELECT * FROM material_on_site_extracts ORDER BY created_at')
      .all() as Record<string, unknown>[];
  } catch {
    skip('material_on_site_table_missing');
  }
  for (const row of mosRows) {
    const id = str(row.id);
    const contractId = str(row.contract_id);
    const boqItemId = str(row.boq_item_id);
    if (!id || !contractId || !boqItemId) {
      skip('material_on_site_bad_row');
      continue;
    }
    if (!(await contractExists(contractId)) || !(await boqItemExists(boqItemId))) {
      skip('material_on_site_missing_refs');
      continue;
    }
    const transactionId = nullIfEmpty(row.transaction_id);
    await prisma.materialOnSiteExtract.upsert({
      where: { id },
      create: {
        id,
        firestoreId: nullIfEmpty(row.firestore_id),
        contractId,
        boqItemId,
        suppliedQuantity: dec(row.supplied_quantity),
        onSitePercentage: dec(row.on_site_percentage),
        equivalentQuantity: dec(row.equivalent_quantity),
        unitPrice: dec(row.unit_price),
        claimedAmount: dec(row.claimed_amount),
        deliveryNoteRef: nullIfEmpty(row.delivery_note_ref),
        extractNumber: nullIfEmpty(row.extract_number),
        extractDate: nullIfEmpty(row.extract_date),
        notes: nullIfEmpty(row.notes),
        status: str(row.status) || 'draft',
        transactionId: transactionId && (await transactionExists(transactionId)) ? transactionId : null,
        createdBy: nullIfEmpty(row.created_by),
      },
      update: {
        status: str(row.status) || 'draft',
        transactionId: transactionId && (await transactionExists(transactionId)) ? transactionId : null,
      },
    });
    bump('material_on_site_extracts');
  }

  // ── users (SQLite baseline — Firestore pass may override by email) ────────
  const sqliteUsers = db.prepare('SELECT * FROM users ORDER BY email').all() as Record<string, unknown>[];
  for (const row of sqliteUsers) {
    const id = str(row.id);
    const email = str(row.email).toLowerCase();
    if (!id || !email) {
      skip('users_bad_row');
      continue;
    }
    let permissionsRaw: unknown = row.permissions;
    if (typeof permissionsRaw === 'string') {
      try {
        permissionsRaw = JSON.parse(permissionsRaw);
      } catch {
        permissionsRaw = {};
      }
    }
    const role = str(row.role) || 'user';
    const permissions = resolvePermissionsFromUserData({ role, permissions: permissionsRaw });
    const assignedContractIds = parseJsonArray(row.assigned_contract_ids);
    const passwordHash = str(row.password_hash) || (await unusablePasswordHash());

    await prisma.user.upsert({
      where: { email },
      create: {
        id,
        email,
        displayName: nullIfEmpty(row.display_name),
        passwordHash,
        role,
        permissions,
        assignedContractIds,
        isActive: bool(row.is_active, true),
      },
      update: {
        displayName: nullIfEmpty(row.display_name),
        passwordHash,
        role,
        permissions,
        assignedContractIds,
        isActive: bool(row.is_active, true),
      },
    });
    bump('users');
  }

  return { source: sourceLabel, counts, skipped };
}

export async function printSqliteImportReport(report: SqliteImportReport): Promise<void> {
  console.log('\n=== SQLite → Postgres import report ===');
  console.log(`Source: ${report.source}`);
  console.log('\nImported row counts:');
  for (const [k, v] of Object.entries(report.counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${k}: ${v}`);
  }
  if (Object.keys(report.skipped).length > 0) {
    console.log('\nSkipped:');
    for (const [k, v] of Object.entries(report.skipped)) {
      console.log(`  ${k}: ${v}`);
    }
  }
}
