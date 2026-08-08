/**
 * Import bank_* collections from a Firestore backup JSON into Postgres.
 * Safe to re-run (upsert). Use after initial migrate when banks were skipped.
 *
 * Usage:
 *   npx tsx server/src/scripts/importBanksFromBackup.ts [firestore-backup.json]
 *
 * Railway: set DATABASE_PUBLIC_URL then run against Settings → Backup export JSON.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../db.js';
import {
  importBanksFromFirestoreDocs,
  printImportReport,
  type ImportReport,
} from '../migration/importFromFirestoreBackup.js';
import { loadFirestoreBackup } from '../migration/parseFirestoreBackup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const parentRoot = path.resolve(repoRoot, '..');

const defaultBackupCandidates = [
  path.join(parentRoot, 'backups', '20260614-055130', 'firestore', 'backup_2026-06-14.json'),
  path.join(repoRoot, 'backups', '20260614-055130', 'firestore', 'backup_2026-06-14.json'),
];

const argPath = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
const backupPath =
  argPath ??
  defaultBackupCandidates.find((p) => fs.existsSync(p)) ??
  defaultBackupCandidates[0];

console.log(`\n=== Banks import (Firestore → Postgres) ===`);
console.log(`Loading: ${backupPath}`);

const backup = await loadFirestoreBackup(backupPath);
const counts: ImportReport['counts'] = {};
const skipped: ImportReport['skipped'] = {};

const bump = (key: string, n = 1) => {
  counts[key] = (counts[key] ?? 0) + n;
};
const skip = (key: string, n = 1) => {
  skipped[key] = (skipped[key] ?? 0) + n;
};

await importBanksFromFirestoreDocs(backup, bump, skip);

await printImportReport({
  source: backupPath,
  counts,
  skipped,
  gl: { transactions: 0, balanced: 0, unbalanced: 0, unbalancedIds: [] },
});

const accountCount = await prisma.bankAccount.count();
console.log(`\nPostgres bank_accounts total: ${accountCount}`);

await prisma.$disconnect();

if (accountCount === 0 && (counts.bank_accounts ?? 0) === 0) {
  console.log(
    '\nNo bank_accounts in backup — export from Settings → Backup & Restore (cloud) or check collection name.',
  );
  process.exitCode = 1;
}
