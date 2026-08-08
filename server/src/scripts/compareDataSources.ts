/**
 * Compare COA / GL counts: Firestore backup + SQLite vs Postgres.
 *   npx tsx server/src/scripts/compareDataSources.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSqliteBackupReadonly, resolveSqliteBackupPath } from '../migration/openSqliteBackup.js';
import { prisma } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const parentRoot = path.resolve(repoRoot, '..');

const backupPath = path.join(
  parentRoot,
  'backups',
  '20260614-055130',
  'firestore',
  'backup_2026-06-14.json',
);
const sqlitePath = resolveSqliteBackupPath();

function loadBackup() {
  const raw = JSON.parse(fs.readFileSync(backupPath, 'utf8')) as {
    collections?: Record<string, unknown[]>;
  };
  return raw.collections ?? (raw as Record<string, unknown[]>);
}

const cols = loadBackup();

const fsTx = (cols.transactions ?? []) as Array<{ isDeleted?: boolean; date?: string }>;
const fsCoa = (cols.chart_of_accounts ?? []) as unknown[];

const pgCounts = {
  chartOfAccounts: await prisma.chartOfAccount.count(),
  chartOfAccountsActive: await prisma.chartOfAccount.count({ where: { status: 'active' } }),
  transactions: await prisma.transaction.count({ where: { isDeleted: false } }),
  transactionsAll: await prisma.transaction.count(),
  journalEntries: await prisma.journalEntry.count(),
  projects: await prisma.project.count({ where: { isDeleted: false } }),
};

const fsCounts = {
  chart_of_accounts: fsCoa.length,
  transactions: fsTx.filter((t) => !t.isDeleted).length,
  transactionsAll: fsTx.length,
  projects: ((cols.projects ?? []) as Array<{ isDeleted?: boolean }>).filter((p) => !p.isDeleted).length,
};

let sqCounts: Record<string, number | string> = {};
if (fs.existsSync(sqlitePath)) {
  const db = openSqliteBackupReadonly(sqlitePath);
  const tableNames = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
    (r) => r.name,
  );
  sqCounts = {
    chart_of_accounts: tableNames.includes('chart_of_accounts')
      ? (db.prepare('SELECT COUNT(*) as c FROM chart_of_accounts').get() as { c: number }).c
      : '—',
    gl_transactions: tableNames.includes('gl_transactions')
      ? (db.prepare('SELECT COUNT(*) as c FROM gl_transactions WHERE is_deleted=0').get() as { c: number }).c
      : '—',
    gl_entries: tableNames.includes('gl_entries')
      ? (db.prepare('SELECT COUNT(*) as c FROM gl_entries').get() as { c: number }).c
      : '—',
  };
  db.close();
}

// Fiscal year breakdown
const fsByYear: Record<string, number> = {};
for (const t of fsTx.filter((x) => !x.isDeleted)) {
  const y = String(t.date ?? '').slice(0, 4) || 'unknown';
  fsByYear[y] = (fsByYear[y] ?? 0) + 1;
}

const pgTxRows = await prisma.transaction.findMany({
  where: { isDeleted: false },
  select: { date: true },
});
const pgByYear: Record<string, number> = {};
for (const t of pgTxRows) {
  const y = String(t.date ?? '').slice(0, 4) || 'unknown';
  pgByYear[y] = (pgByYear[y] ?? 0) + 1;
}

console.log('\n=== Data source comparison ===\n');
console.log('Firestore backup:', backupPath);
console.log('SQLite:', sqlitePath);
console.log('\nCounts:');
console.table([
  { source: 'Firestore backup', coa: fsCounts.chart_of_accounts, gl_tx: fsCounts.transactions, projects: fsCounts.projects },
  { source: 'SQLite', coa: sqCounts.chart_of_accounts ?? '—', gl_tx: sqCounts.gl_transactions ?? '—', projects: '—' },
  { source: 'Postgres', coa: pgCounts.chartOfAccounts, gl_tx: pgCounts.transactions, projects: pgCounts.projects },
]);

console.log('\nGL transactions by fiscal year:');
console.log('Firestore:', fsByYear);
console.log('Postgres: ', pgByYear);

console.log('\nPostgres detail:');
console.log('  COA active:', pgCounts.chartOfAccountsActive);
console.log('  GL entries:', pgCounts.journalEntries);
console.log('  GL tx (incl deleted):', pgCounts.transactionsAll);

const sampleCoa = await prisma.chartOfAccount.findMany({
  where: { accountCode: { in: ['1', '11', '12101001'] } },
  select: { accountCode: true, parentCode: true, accountName: true },
});
console.log('\nCOA sample (root check):', sampleCoa);
const emptyParent = await prisma.chartOfAccount.count({ where: { parentCode: '' } });
console.log('COA with parentCode=""', emptyParent);

await prisma.$disconnect();
