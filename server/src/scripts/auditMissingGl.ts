/**
 * Audit: operational docs vs GL transactions in Firestore backup + Postgres.
 *   npx tsx server/src/scripts/auditMissingGl.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { prisma } from '../db.js';
import { resolveSqliteBackupPath } from '../migration/openSqliteBackup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const parentRoot = path.resolve(__dirname, '../../../..');

const backupPath = path.join(
  parentRoot,
  'backups',
  '20260614-055130',
  'firestore',
  'backup_2026-06-14.json',
);
const raw = JSON.parse(fs.readFileSync(backupPath, 'utf8')) as {
  collections: Record<string, Array<Record<string, unknown> & { _id?: string }>>;
};
const cols = raw.collections;

type Doc = Record<string, unknown> & { _id?: string };

function col(name: string): Doc[] {
  return cols[name] ?? [];
}

function notDeleted(d: Doc): boolean {
  return d.isDeleted !== true;
}

const transactions = col('transactions').filter(notDeleted);
const billing = col('billing').filter(notDeleted);
const purchases = col('purchase_transactions').filter(notDeleted);
const bankCheques = col('bank_cheques').filter(notDeleted);
const bankMovements = col('bank_movements').filter(notDeleted);

const txById = new Map(transactions.map((t) => [String(t._id), t]));
const txByRef = new Map(
  transactions.map((t) => [String(t.reference ?? '').trim(), t]).filter(([r]) => r),
);

function missingTx(label: string, docs: Doc[], getTxId: (d: Doc) => string | undefined, getStatus?: (d: Doc) => boolean) {
  const gaps: Array<{ id: string; ref: string; status: string; detail: string }> = [];
  for (const d of docs) {
    if (getStatus && !getStatus(d)) continue;
    const id = String(d._id ?? '');
    const txId = getTxId(d);
    const status = String(d.status ?? '');
    const ref = String(d.billingNumber ?? d.reference ?? d.invoiceNumber ?? d.chequeNumber ?? id).slice(0, 40);
    if (!txId || !txById.has(txId)) {
      gaps.push({
        id,
        ref,
        status,
        detail: txId ? `transactionId=${txId} NOT IN BACKUP` : 'no transactionId',
      });
    }
  }
  console.log(`\n── ${label}: ${gaps.length} missing GL of ${docs.length} docs ──`);
  for (const g of gaps.slice(0, 20)) {
    console.log(`  ${g.ref} | status=${g.status} | ${g.detail}`);
  }
  if (gaps.length > 20) console.log(`  ... +${gaps.length - 20} more`);
  return gaps.length;
}

console.log('\n=== GL audit — Firestore backup ===');
console.log('Backup:', backupPath);
console.log(`transactions in backup: ${transactions.length}`);
console.log('References:', transactions.map((t) => String(t.reference ?? '')).join(', '));

const ipcStatuses = new Set(['submitted', 'approved', 'paid', 'review']);
missingTx(
  'IPC / Billing (non-draft, expects GL)',
  billing,
  (d) => (d.transactionId ? String(d.transactionId) : undefined),
  (d) => ipcStatuses.has(String(d.status ?? '')) && String(d.status) !== 'draft',
);

missingTx(
  'Purchase invoices (non-draft)',
  purchases,
  (d) => (d.transactionId ? String(d.transactionId) : undefined),
  (d) => String(d.status ?? '') !== 'draft' && String(d.type ?? 'invoice') === 'invoice',
);

missingTx(
  'Subcontractor IPC (purchase type=ipc)',
  purchases,
  (d) => (d.transactionId ? String(d.transactionId) : undefined),
  (d) => String(d.type ?? '') === 'ipc' && String(d.status ?? '') !== 'draft',
);

// Cheques: ISS/CLR references CH-RECEIVED-* / CH-ISSUED-*
const postedCheques = bankCheques.filter(
  (c) => ['cleared', 'deposited', 'issued', 'received'].includes(String(c.status ?? '').toLowerCase()) || c.status,
);
console.log(`\n── Bank cheques: ${bankCheques.length} total ──`);
for (const c of bankCheques.slice(0, 15)) {
  const id = String(c._id ?? '');
  const issRef = `CH-RECEIVED-${id}-ISS`;
  const clrRef = `CH-RECEIVED-${id}-CLR`;
  const hasIss = txByRef.has(issRef) || transactions.some((t) => String(t.reference).includes(id));
  console.log(
    `  ${c.chequeNumber ?? id} status=${c.status} ISS=${txByRef.has(issRef) ? 'yes' : 'no'} CLR=${txByRef.has(clrRef) ? 'yes' : 'no'}`,
  );
}

// SQLite warehouse movements
const sqlitePath = resolveSqliteBackupPath();
const db = new Database(sqlitePath, { readonly: true });
const movements = db
  .prepare('SELECT movement_type, reference_type, reference_id, COUNT(*) as c FROM project_inventory_movements GROUP BY movement_type, reference_type')
  .all() as Array<{ movement_type: string; reference_type: string | null; reference_id: string | null; c: number }>;

console.log('\n── SQLite inventory movements (backup) ──');
for (const m of movements) {
  console.log(`  ${m.movement_type} / ${m.reference_type ?? '—'}: ${m.c}`);
}

const consumptionOrders = db
  .prepare("SELECT order_number, status FROM consumption_orders WHERE status='confirmed'")
  .all() as Array<{ order_number: string; status: string }>;
console.log(`\n── Confirmed consumption orders: ${consumptionOrders.length} ──`);
let conMissing = 0;
for (const o of consumptionOrders) {
  const ref = o.order_number.startsWith('CON-') ? o.order_number : `CON-${o.order_number}`;
  if (!txByRef.has(ref) && !transactions.some((t) => String(t.reference) === ref)) {
    conMissing += 1;
    if (conMissing <= 10) console.log(`  MISSING GL: ${ref}`);
  }
}
console.log(`  Missing GL for consumption: ${conMissing} / ${consumptionOrders.length}`);

const returns = db
  .prepare("SELECT return_number, status FROM return_orders WHERE status='confirmed'")
  .all() as Array<{ return_number: string; status: string }>;
let retMissing = 0;
for (const o of returns) {
  const ref = o.return_number;
  if (!txByRef.has(ref) && !transactions.some((t) => String(t.reference) === ref)) {
    retMissing += 1;
    console.log(`  MISSING GL: ${ref}`);
  }
}

// Postgres cross-check
const pgTx = await prisma.transaction.findMany({
  where: { isDeleted: false },
  select: { reference: true, description: true },
  orderBy: { date: 'desc' },
});
console.log(`\n=== Postgres GL: ${pgTx.length} transactions ===`);
for (const t of pgTx) {
  console.log(`  ${t.reference} | ${String(t.description ?? '').slice(0, 50)}`);
}

db.close();
await prisma.$disconnect();
