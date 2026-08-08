import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db.js';
import { POSTGRES_BACKUP_COLLECTIONS } from './backupCollections.js';
import {
  bool,
  dec,
  makeCounter,
  nullIfEmpty,
  num,
  parseJsonArray,
  resetPgSequence,
  str,
  isUniqueViolation,
} from './helpers.js';
import {
  importFirestoreBackupToPostgres,
  type ImportReport,
} from './importFromFirestoreBackup.js';
import { collection, type FirestoreBackupFile, type FirestoreDoc } from './parseFirestoreBackup.js';
import { resolvePermissionsFromUserData, type UserRole } from '../permissions.js';

export type PostgresRestoreMode = 'merge' | 'replace';

export type PostgresImportReport = ImportReport & {
  mode: PostgresRestoreMode;
  collectionsProcessed: number;
  recordsProcessed: number;
};

type Db = PrismaClient;
type BumpFn = (key: string, n?: number) => void;
type SkipFn = (key: string, n?: number) => void;

const INT_ID_COLLECTIONS = new Set([
  'material_groups',
  'material_categories',
  'boq_item_materials',
  'purchase_invoices',
  'purchase_invoice_lines',
  'purchase_invoice_allocations',
  'project_inventory',
  'project_inventory_movements',
  'consumption_orders',
  'consumption_order_lines',
  'consumption_allocation_templates',
  'return_orders',
  'return_order_lines',
  'project_inventory_transfers',
  'project_inventory_transfer_lines',
  'boq_actual_costs',
  'contract_expense_order_lines',
  'contract_inventory',
  'inventory_transfers',
  'inventory_transfer_lines',
  'inventory_consumption',
  'subcontract_assignments',
  'subcontract_extracts',
  'fixed_asset_depreciation_entries',
]);

const CORE_COLLECTIONS = new Set([
  'projects',
  'contracts',
  'cost_centers',
  'suppliers',
  'chart_of_accounts',
  'boq_items',
  'transactions',
  'billing',
  'purchase_transactions',
  'bank_accounts',
  'bank_movements',
  'bank_cheques',
  'bank_statements',
  'bank_statement_lines',
]);

/** Import order for collections not handled by importFirestoreBackupToPostgres. */
const EXTENDED_IMPORT_ORDER = [
  'material_groups',
  'material_categories',
  'boq_item_materials',
  'subcontractors',
  'fixed_asset_groups',
  'leave_types',
  'attendance_rules',
  'official_holidays',
  'variation_orders',
  'variation_order_lines',
  'document_registry',
  'payroll_employees',
  'employee_cost_center_allocations',
  'employee_leave_balances',
  'settings',
  'users',
  'payroll_runs',
  'payroll_run_lines',
  'payroll_run_line_allocations',
  'attendance_imports',
  'attendance_import_lines',
  'employee_notification_outbox',
  'purchase_invoices',
  'purchase_invoice_lines',
  'purchase_invoice_allocations',
  'project_inventory',
  'project_inventory_movements',
  'consumption_orders',
  'consumption_order_lines',
  'consumption_allocation_templates',
  'return_orders',
  'return_order_lines',
  'project_inventory_transfers',
  'project_inventory_transfer_lines',
  'boq_actual_costs',
  'contract_expense_orders',
  'contract_expense_order_lines',
  'overhead_allocation_periods',
  'overhead_allocation_lines',
  'accounting_period_locks',
  'fiscal_period_closings',
  'contract_inventory',
  'inventory_transfers',
  'inventory_transfer_lines',
  'inventory_consumption',
  'subcontract_assignments',
  'subcontract_extracts',
  'material_on_site_extracts',
  'mos_certificates',
  'mos_certificate_lines',
  'fixed_assets',
  'fixed_asset_depreciation_entries',
  'custody_settlements',
  'custody_settlement_items',
  'billing_items',
  'journal_entries',
  'purchase_transaction_items',
  'audit_log',
  'notification_outbox',
  'approval_link_tokens',
  'user_notification_reads',
] as const;

const PRISMA_DELEGATE: Record<string, keyof Db> = {
  material_groups: 'materialGroup',
  material_categories: 'materialCategory',
  boq_item_materials: 'boqItemMaterial',
  purchase_invoices: 'purchaseInvoice',
  purchase_invoice_lines: 'purchaseInvoiceLine',
  purchase_invoice_allocations: 'purchaseInvoiceAllocation',
  project_inventory: 'projectInventory',
  project_inventory_movements: 'projectInventoryMovement',
  consumption_orders: 'consumptionOrder',
  consumption_order_lines: 'consumptionOrderLine',
  consumption_allocation_templates: 'consumptionAllocationTemplate',
  return_orders: 'returnOrder',
  return_order_lines: 'returnOrderLine',
  project_inventory_transfers: 'projectInventoryTransfer',
  project_inventory_transfer_lines: 'projectInventoryTransferLine',
  boq_actual_costs: 'boqActualCost',
  contract_expense_orders: 'contractExpenseOrder',
  contract_expense_order_lines: 'contractExpenseOrderLine',
  overhead_allocation_periods: 'overheadAllocationPeriod',
  overhead_allocation_lines: 'overheadAllocationLine',
  accounting_period_locks: 'accountingPeriodLock',
  fiscal_period_closings: 'fiscalPeriodClosing',
  contract_inventory: 'contractInventory',
  inventory_transfers: 'inventoryTransfer',
  inventory_transfer_lines: 'inventoryTransferLine',
  inventory_consumption: 'inventoryConsumption',
  subcontractors: 'subcontractor',
  subcontract_assignments: 'subcontractAssignment',
  subcontract_extracts: 'subcontractExtract',
  material_on_site_extracts: 'materialOnSiteExtract',
  mos_certificates: 'mosCertificate',
  mos_certificate_lines: 'mosCertificateLine',
  document_registry: 'documentRegistry',
  variation_orders: 'variationOrder',
  variation_order_lines: 'variationOrderLine',
  fixed_asset_groups: 'fixedAssetGroup',
  fixed_assets: 'fixedAsset',
  fixed_asset_depreciation_entries: 'fixedAssetDepreciationEntry',
  payroll_employees: 'payrollEmployee',
  payroll_runs: 'payrollRun',
  payroll_run_lines: 'payrollRunLine',
  employee_cost_center_allocations: 'employeeCostCenterAllocation',
  payroll_run_line_allocations: 'payrollRunLineAllocation',
  employee_notification_outbox: 'employeeNotificationOutbox',
  attendance_rules: 'attendanceRule',
  attendance_imports: 'attendanceImport',
  attendance_import_lines: 'attendanceImportLine',
  leave_types: 'leaveType',
  official_holidays: 'officialHoliday',
  employee_leave_balances: 'employeeLeaveBalance',
  custody_settlements: 'custodySettlement',
  custody_settlement_items: 'custodySettlementItem',
  purchase_requests: 'purchaseRequest',
  billing_items: 'billingItem',
  journal_entries: 'journalEntry',
  purchase_transaction_items: 'purchaseTransactionItem',
  audit_log: 'auditLog',
  notification_outbox: 'notificationOutbox',
  approval_link_tokens: 'approvalLinkToken',
  user_notification_reads: 'userNotificationRead',
};

const NESTED_OMIT = new Set(['entries', 'items', 'invoiceLines', 'distributedLines']);

async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(randomUUID(), 4);
}

function normalizeRole(role: unknown): UserRole {
  const r = str(role);
  if (r === 'admin' || r === 'projects_manager' || r === 'project_accountant' || r === 'user') {
    return r;
  }
  return 'user';
}

function docPayload(doc: FirestoreDoc): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === '_id' || NESTED_OMIT.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function resolveId(doc: FirestoreDoc, collectionKey: string): string | number | null {
  if (INT_ID_COLLECTIONS.has(collectionKey)) {
    const id = num(doc._id ?? doc.id);
    return id > 0 ? id : null;
  }
  const id = str(doc._id ?? doc.id);
  return id || null;
}

async function wipeBackupTables(db: Db): Promise<void> {
  const tables = POSTGRES_BACKUP_COLLECTIONS.map((t) => `"${t}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

async function importSettings(db: Db, backup: FirestoreBackupFile, bump: BumpFn, skip: SkipFn): Promise<void> {
  for (const doc of collection(backup, 'settings')) {
    const key = str(doc.key ?? doc._id);
    if (!key) {
      skip('settings_no_key');
      continue;
    }
    const { _id: _i, key: _k, updatedAt: _u, value, ...rest } = doc;
    void _i;
    void _k;
    void _u;
    const settingValue = value !== undefined ? value : rest;
    await db.setting.upsert({
      where: { key },
      create: {
        id: randomUUID(),
        key,
        value: settingValue as Prisma.InputJsonValue,
      },
      update: {
        value: settingValue as Prisma.InputJsonValue,
      },
    });
    bump('settings');
  }
}

async function importUsers(
  db: Db,
  backup: FirestoreBackupFile,
  bump: BumpFn,
  skip: SkipFn,
  options?: { replaceMode?: boolean },
): Promise<void> {
  for (const doc of collection(backup, 'users')) {
    const id = str(doc._id);
    const email = str(doc.email).toLowerCase();
    if (!id || !email) {
      skip('users_missing_id_or_email');
      continue;
    }
    const existingById = await db.user.findUnique({ where: { id } });
    const existingByEmail = await db.user.findUnique({ where: { email } });
    const targetId = existingById?.id ?? existingByEmail?.id ?? id;
    const backupPasswordHash = str(doc.passwordHash) || str(doc.password_hash);
    const passwordHash =
      options?.replaceMode && backupPasswordHash
        ? backupPasswordHash
        : existingById?.passwordHash ??
          existingByEmail?.passwordHash ??
          (backupPasswordHash || (await unusablePasswordHash()));
    const role = normalizeRole(doc.role);
    const permissions = resolvePermissionsFromUserData({ role, permissions: doc.permissions });
    const assignedContractIds = parseJsonArray(doc.assignedContractIds);
    const userData = {
      email,
      displayName: nullIfEmpty(doc.displayName),
      role,
      permissions,
      assignedContractIds,
      phoneE164: nullIfEmpty(doc.phoneE164),
      whatsappOptIn: bool(doc.whatsappOptIn),
      preferredLanguage: str(doc.preferredLanguage) || 'ar',
      whatsappNotifyTypes: (doc.whatsappNotifyTypes ?? []) as Prisma.InputJsonValue,
      isActive: doc.isActive !== false,
    };
    try {
      await db.user.upsert({
        where: { id: targetId },
        create: { id: targetId, passwordHash, ...userData },
        update: {
          ...userData,
          ...(options?.replaceMode && backupPasswordHash ? { passwordHash: backupPasswordHash } : {}),
        },
      });
      bump('users');
    } catch (e) {
      if (isUniqueViolation(e)) skip('users_unique');
      else throw e;
    }
  }
}

async function importCustodySettlements(
  db: Db,
  backup: FirestoreBackupFile,
  bump: BumpFn,
  skip: SkipFn,
): Promise<void> {
  for (const doc of collection(backup, 'custody_settlements')) {
    const id = str(doc._id);
    const projectId = str(doc.projectId);
    if (!id || !projectId) {
      skip('custody_settlements_missing_refs');
      continue;
    }
    const data = docPayload(doc);
    const settlementNumber = str(data.settlementNumber) || id;
    try {
      const byId = await db.custodySettlement.findUnique({ where: { id } });
      const byNumber = await db.custodySettlement.findUnique({ where: { settlementNumber } });
      const targetId = byId?.id ?? byNumber?.id ?? id;
      const rowData = {
        projectId,
        settlementNumber,
        custodyAccountCode: str(data.custodyAccountCode) || '12102001',
        custodyAccountName: nullIfEmpty(data.custodyAccountName),
        date: str(data.date) || '2000-01-01',
        description: nullIfEmpty(data.description),
        totalAmount: dec(data.totalAmount),
        status: str(data.status) || 'draft',
        transactionIds: (data.transactionIds ?? []) as Prisma.InputJsonValue,
        createdBy: nullIfEmpty(data.createdBy),
        approvedBy: nullIfEmpty(data.approvedBy),
        isDeleted: bool(data.isDeleted),
      };
      if (byId || byNumber) {
        await db.custodySettlement.update({ where: { id: targetId }, data: rowData });
      } else {
        await db.custodySettlement.create({ data: { id: targetId, ...rowData } });
      }
      bump('custody_settlements');
    } catch (e) {
      if (isUniqueViolation(e)) skip('custody_settlements_unique');
      else throw e;
    }
  }
}

async function importGenericCollection(
  db: Db,
  backup: FirestoreBackupFile,
  collectionKey: string,
  bump: BumpFn,
  skip: SkipFn,
): Promise<void> {
  const delegateKey = PRISMA_DELEGATE[collectionKey];
  if (!delegateKey) return;

  const docs = collection(backup, collectionKey);
  if (docs.length === 0) return;

  const delegate = db[delegateKey] as unknown as {
    upsert: (args: { where: { id: string | number }; create: unknown; update: unknown }) => Promise<unknown>;
  };

  let knownTransactionIds: Set<string> | null = null;
  let knownCostCenterIds: Set<string> | null = null;
  if (collectionKey === 'journal_entries') {
    const [txRows, ccRows] = await Promise.all([
      db.transaction.findMany({ select: { id: true } }),
      db.costCenter.findMany({ select: { id: true } }),
    ]);
    knownTransactionIds = new Set(txRows.map((r) => r.id));
    knownCostCenterIds = new Set(ccRows.map((r) => r.id));
  }

  for (const doc of docs) {
    const id = resolveId(doc, collectionKey);
    if (id == null) {
      skip(`${collectionKey}_no_id`);
      continue;
    }
    const raw = docPayload(doc);
    // Prisma UpdateInput rejects `id`; strip it from create/update payloads.
    const { id: _payloadId, ...data } = raw as Record<string, unknown> & { id?: unknown };
    void _payloadId;
    if (collectionKey === 'journal_entries' && knownTransactionIds && knownCostCenterIds) {
      const txId = str(data.transactionId);
      if (!txId || !knownTransactionIds.has(txId)) {
        skip('journal_entries_missing_transaction');
        continue;
      }
      const ccId = str(data.costCenterId);
      if (ccId && !knownCostCenterIds.has(ccId)) {
        data.costCenterId = null;
      }
    }
    try {
      await delegate.upsert({
        where: { id: id as string & number },
        create: { id, ...data },
        update: data,
      });
      bump(collectionKey);
    } catch (e) {
      if (isUniqueViolation(e)) skip(`${collectionKey}_unique`);
      else skip(`${collectionKey}_upsert_error`);
    }
  }

  if (INT_ID_COLLECTIONS.has(collectionKey)) {
    await resetPgSequence(collectionKey);
  }
}

function mergeReports(base: ImportReport, extraCounts: Record<string, number>, extraSkipped: Record<string, number>): ImportReport {
  const counts = { ...base.counts };
  const skipped = { ...base.skipped };
  for (const [k, v] of Object.entries(extraCounts)) {
    counts[k] = (counts[k] ?? 0) + v;
  }
  for (const [k, v] of Object.entries(extraSkipped)) {
    skipped[k] = (skipped[k] ?? 0) + v;
  }
  return { ...base, counts, skipped };
}

function summarizeReport(report: ImportReport): { collectionsProcessed: number; recordsProcessed: number } {
  const keys = new Set([...Object.keys(report.counts), ...Object.keys(report.skipped)]);
  const recordsProcessed = Object.values(report.counts).reduce((a, b) => a + b, 0);
  return { collectionsProcessed: keys.size, recordsProcessed };
}

export async function importPostgresBackup(
  backup: FirestoreBackupFile,
  options: { mode?: PostgresRestoreMode; targetDb?: Db; skipCollections?: readonly string[] } = {},
): Promise<PostgresImportReport> {
  const db = options.targetDb ?? prisma;
  const mode = options.mode ?? 'merge';
  const skipColl = new Set(options.skipCollections ?? []);

  if (!backup.collections || typeof backup.collections !== 'object') {
    throw new Error('Invalid backup file: missing collections');
  }

  if (mode === 'replace') {
    await wipeBackupTables(db);
  }

  const coreReport = await importFirestoreBackupToPostgres(backup, `postgres-backup-${mode}`, {
    targetDb: db,
    skipCollections: options.skipCollections,
  });

  const { counts, skipped, bump, skip } = makeCounter();

  for (const collectionKey of EXTENDED_IMPORT_ORDER) {
    if (CORE_COLLECTIONS.has(collectionKey)) continue;
    if (skipColl.has(collectionKey)) continue;
    const docs = collection(backup, collectionKey);
    if (docs.length === 0) continue;

    if (collectionKey === 'settings') {
      await importSettings(db, backup, bump, skip);
      continue;
    }
    if (collectionKey === 'users') {
      await importUsers(db, backup, bump, skip, { replaceMode: mode === 'replace' });
      continue;
    }
    if (collectionKey === 'custody_settlements') {
      await importCustodySettlements(db, backup, bump, skip);
      continue;
    }
    await importGenericCollection(db, backup, collectionKey, bump, skip);
  }

  const merged = mergeReports(coreReport, counts, skipped);
  const summary = summarizeReport(merged);

  return {
    ...merged,
    mode,
    collectionsProcessed: summary.collectionsProcessed,
    recordsProcessed: summary.recordsProcessed,
  };
}
