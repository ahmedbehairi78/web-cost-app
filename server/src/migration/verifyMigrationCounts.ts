import type Database from 'better-sqlite3';
import { prisma } from '../db.js';
import { sqliteTableCount } from './openSqliteBackup.js';
import type { ImportCounts } from './helpers.js';

type CountPair = {
  table: string;
  expected: number;
  postgres: number;
  ok: boolean;
  note?: string;
};

const WAREHOUSE_TABLES: Array<{ sqlite: string; postgres: keyof typeof prismaCountMap }> = [
  { sqlite: 'material_groups', postgres: 'materialGroup' },
  { sqlite: 'material_categories', postgres: 'materialCategory' },
  { sqlite: 'boq_item_materials', postgres: 'boqItemMaterial' },
  { sqlite: 'purchase_invoices', postgres: 'purchaseInvoice' },
  { sqlite: 'purchase_invoice_lines', postgres: 'purchaseInvoiceLine' },
  { sqlite: 'purchase_invoice_allocations', postgres: 'purchaseInvoiceAllocation' },
  { sqlite: 'project_inventory', postgres: 'projectInventory' },
  { sqlite: 'project_inventory_movements', postgres: 'projectInventoryMovement' },
  { sqlite: 'consumption_orders', postgres: 'consumptionOrder' },
  { sqlite: 'consumption_order_lines', postgres: 'consumptionOrderLine' },
  { sqlite: 'boq_actual_costs', postgres: 'boqActualCost' },
  { sqlite: 'return_orders', postgres: 'returnOrder' },
  { sqlite: 'return_order_lines', postgres: 'returnOrderLine' },
  { sqlite: 'project_inventory_transfers', postgres: 'projectInventoryTransfer' },
  { sqlite: 'project_inventory_transfer_lines', postgres: 'projectInventoryTransferLine' },
  { sqlite: 'material_on_site_extracts', postgres: 'materialOnSiteExtract' },
  { sqlite: 'users', postgres: 'user' },
];

const FIRESTORE_CORE_TABLES: Array<{ label: string; postgres: keyof typeof prismaCountMap }> = [
  { label: 'projects', postgres: 'project' },
  { label: 'contracts', postgres: 'contract' },
  { label: 'boq_items', postgres: 'boqItem' },
  { label: 'chart_of_accounts', postgres: 'chartOfAccount' },
  { label: 'suppliers', postgres: 'supplier' },
  { label: 'transactions', postgres: 'transaction' },
  { label: 'journal_entries', postgres: 'journalEntry' },
  { label: 'billing', postgres: 'billing' },
  { label: 'billing_items', postgres: 'billingItem' },
  { label: 'purchase_transactions', postgres: 'purchaseTransaction' },
  { label: 'bank_accounts', postgres: 'bankAccount' },
  { label: 'bank_movements', postgres: 'bankMovement' },
  { label: 'bank_cheques', postgres: 'bankCheque' },
  { label: 'bank_statements', postgres: 'bankStatement' },
  { label: 'bank_statement_lines', postgres: 'bankStatementLine' },
];

const prismaCountMap = {
  materialGroup: () => prisma.materialGroup.count(),
  materialCategory: () => prisma.materialCategory.count(),
  boqItemMaterial: () => prisma.boqItemMaterial.count(),
  purchaseInvoice: () => prisma.purchaseInvoice.count(),
  purchaseInvoiceLine: () => prisma.purchaseInvoiceLine.count(),
  purchaseInvoiceAllocation: () => prisma.purchaseInvoiceAllocation.count(),
  projectInventory: () => prisma.projectInventory.count(),
  projectInventoryMovement: () => prisma.projectInventoryMovement.count(),
  consumptionOrder: () => prisma.consumptionOrder.count(),
  consumptionOrderLine: () => prisma.consumptionOrderLine.count(),
  boqActualCost: () => prisma.boqActualCost.count(),
  returnOrder: () => prisma.returnOrder.count(),
  returnOrderLine: () => prisma.returnOrderLine.count(),
  projectInventoryTransfer: () => prisma.projectInventoryTransfer.count(),
  projectInventoryTransferLine: () => prisma.projectInventoryTransferLine.count(),
  materialOnSiteExtract: () => prisma.materialOnSiteExtract.count(),
  user: () => prisma.user.count(),
  project: () => prisma.project.count(),
  contract: () => prisma.contract.count(),
  boqItem: () => prisma.boqItem.count(),
  chartOfAccount: () => prisma.chartOfAccount.count(),
  supplier: () => prisma.supplier.count(),
  transaction: () => prisma.transaction.count(),
  journalEntry: () => prisma.journalEntry.count(),
  billing: () => prisma.billing.count(),
  billingItem: () => prisma.billingItem.count(),
  purchaseTransaction: () => prisma.purchaseTransaction.count(),
  bankAccount: () => prisma.bankAccount.count(),
  bankMovement: () => prisma.bankMovement.count(),
  bankCheque: () => prisma.bankCheque.count(),
  bankStatement: () => prisma.bankStatement.count(),
  bankStatementLine: () => prisma.bankStatementLine.count(),
} as const;

/** Postgres may contain extra rows after backfill-gl or live dev — only fail when rows are missing. */
function countOk(expected: number, postgres: number, allowExtra = true): { ok: boolean; note?: string } {
  if (postgres < expected) return { ok: false, note: 'missing rows' };
  if (allowExtra && postgres > expected) {
    return { ok: true, note: `+${postgres - expected} extra (backfill / dev usage)` };
  }
  return { ok: true };
}

export async function verifyMigrationCounts(
  sqliteDb: Database.Database,
  firestoreCounts?: ImportCounts,
  sqliteImportedCounts?: ImportCounts,
): Promise<{ warehouse: CountPair[]; core: CountPair[]; allOk: boolean; hasWarnings: boolean }> {
  const warehouse: CountPair[] = [];
  for (const { sqlite, postgres } of WAREHOUSE_TABLES) {
    let sqliteCount = 0;
    try {
      sqliteCount = sqliteTableCount(sqliteDb, sqlite);
    } catch {
      sqliteCount = 0;
    }
    const imported = sqliteImportedCounts?.[sqlite];
    const expected = typeof imported === 'number' ? imported : sqliteCount;
    const pgCount = await prismaCountMap[postgres]();
    const { ok, note } = countOk(expected, pgCount);
    warehouse.push({
      table: sqlite,
      expected,
      postgres: pgCount,
      ok,
      note,
    });
  }

  const core: CountPair[] = [];
  for (const { label, postgres } of FIRESTORE_CORE_TABLES) {
    const expected = firestoreCounts?.[label] ?? null;
    const pgCount = await prismaCountMap[postgres]();
    let ok = true;
    let note: string | undefined;
    if (expected != null) {
      if (label === 'chart_of_accounts') {
        ({ ok, note } = countOk(expected, pgCount));
      } else if (label === 'transactions' || label === 'journal_entries') {
        ({ ok, note } = countOk(expected, pgCount));
      } else {
        ({ ok, note } = countOk(expected, pgCount, false));
      }
    }
    core.push({
      table: label,
      expected: expected ?? -1,
      postgres: pgCount,
      ok,
      note,
    });
  }

  const allOk = warehouse.every((r) => r.ok) && core.every((r) => r.ok || r.expected === -1);
  const hasWarnings = [...warehouse, ...core].some((r) => r.note?.startsWith('+'));

  return { warehouse, core, allOk, hasWarnings };
}

export function printVerificationReport(
  report: Awaited<ReturnType<typeof verifyMigrationCounts>>,
): void {
  console.log('\n=== Migration verification (SQLite / Firestore expected vs Postgres) ===');
  console.log('\nWarehouse / SQLite tables:');
  console.log('  table                              expect  postgres  ok');
  for (const row of report.warehouse) {
    const mark = row.ok ? (row.note ? '⚠' : '✓') : '✗';
    const expect = String(row.expected).padStart(6);
    const note = row.note ? `  (${row.note})` : '';
    console.log(
      `  ${row.table.padEnd(34)} ${expect}  ${String(row.postgres).padStart(8)}  ${mark}${note}`,
    );
  }
  console.log('\nFirestore core (imported counts vs Postgres):');
  console.log('  table                              expect  postgres  ok');
  for (const row of report.core) {
    const mark = row.ok ? (row.note ? '⚠' : '✓') : '✗';
    const expect = row.expected >= 0 ? String(row.expected).padStart(6) : '—'.padStart(6);
    const note = row.note ? `  (${row.note})` : '';
    console.log(
      `  ${row.table.padEnd(34)} ${expect}  ${String(row.postgres).padStart(8)}  ${mark}${note}`,
    );
  }
  if (report.allOk && report.hasWarnings) {
    console.log(
      '\nOverall: PASS (with warnings — Postgres has extra rows beyond this import; normal after backfill-gl or dev usage)',
    );
  } else {
    console.log(`\nOverall: ${report.allOk ? 'PASS' : 'MISMATCH — review failed rows above'}`);
  }
}
