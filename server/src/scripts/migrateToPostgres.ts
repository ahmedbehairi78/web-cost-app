/**
 * Migrate Firestore backup JSON + SQLite warehouse into Postgres.
 *
 * Usage:
 *   npx tsx server/src/scripts/migrateToPostgres.ts [firestore-backup.json] [--sqlite path] [--users path]
 *
 * Default Firestore backup:
 *   ../backups/20260614-055130/firestore/backup_2026-06-14.json
 *
 * Default SQLite:
 *   ../backups/20260614-055130/sqlite/financial-core.sqlite  (fallback: server/data/financial-core.sqlite)
 *
 * Users: optional `users` collection in backup, --users JSON, or live Firestore Admin SDK
 * when FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_SERVICE_ACCOUNT_PATH is set.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../db.js';
import {
  importFirestoreBackupToPostgres,
  printImportReport,
} from '../migration/importFromFirestoreBackup.js';
import {
  importFirestoreUsersFromBackup,
  importFirestoreUsersFromJsonFile,
  importFirestoreUsersLive,
  printFirestoreUsersReport,
} from '../migration/importFirestoreUsers.js';
import {
  importSqliteWarehouseToPostgres,
  printSqliteImportReport,
} from '../migration/importFromSqlite.js';
import {
  openSqliteBackupReadonly,
  resolveSqliteBackupPath,
} from '../migration/openSqliteBackup.js';
import { loadFirestoreBackup } from '../migration/parseFirestoreBackup.js';
import {
  printVerificationReport,
  verifyMigrationCounts,
} from '../migration/verifyMigrationCounts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const parentRoot = path.resolve(repoRoot, '..');

function parseArgs(argv: string[]) {
  let backupPath: string | undefined;
  let sqlitePath: string | undefined;
  let usersPath: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--sqlite') {
      sqlitePath = argv[i + 1];
      i += 1;
    } else if (arg === '--users') {
      usersPath = argv[i + 1];
      i += 1;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (positional[0]) backupPath = path.resolve(positional[0]);

  return { backupPath, sqlitePath, usersPath };
}

const defaultBackupCandidates = [
  path.join(parentRoot, 'backups', '20260614-055130', 'firestore', 'backup_2026-06-14.json'),
  path.join(repoRoot, 'backups', '20260614-055130', 'firestore', 'backup_2026-06-14.json'),
];

const { backupPath: argBackup, sqlitePath, usersPath } = parseArgs(process.argv.slice(2));

const backupPath =
  argBackup ??
  defaultBackupCandidates.find((p) => fs.existsSync(p)) ??
  defaultBackupCandidates[0];

console.log(`\n[1/4] Firestore backup → Postgres`);
console.log(`Loading: ${backupPath}`);
const backup = await loadFirestoreBackup(backupPath);
const firestoreReport = await importFirestoreBackupToPostgres(backup, backupPath);
await printImportReport(firestoreReport);

console.log(`\n[2/4] SQLite warehouse → Postgres`);
const sqliteResolved = resolveSqliteBackupPath(sqlitePath);
console.log(`Loading: ${sqliteResolved}`);
const sqliteDb = openSqliteBackupReadonly(sqliteResolved);
const sqliteReport = await importSqliteWarehouseToPostgres(sqliteDb, sqliteResolved);
await printSqliteImportReport(sqliteReport);

console.log(`\n[3/4] Firestore users → Postgres (CRUD permissions)`);
let usersImported = false;

const backupUsersReport = await importFirestoreUsersFromBackup(backup, backupPath);
if (Object.keys(backupUsersReport.counts).length > 0) {
  await printFirestoreUsersReport(backupUsersReport);
  usersImported = true;
}

if (usersPath && fs.existsSync(path.resolve(usersPath))) {
  const usersFile = path.resolve(usersPath);
  console.log(`Loading users file: ${usersFile}`);
  const fileReport = await importFirestoreUsersFromJsonFile(usersFile);
  await printFirestoreUsersReport(fileReport);
  usersImported = true;
}

const liveReport = await importFirestoreUsersLive();
if (liveReport) {
  await printFirestoreUsersReport(liveReport);
  usersImported = true;
} else if (!usersImported) {
  console.log(
    'No Firestore users in backup and no Admin SDK credentials.\n' +
      '  SQLite users were imported (email-based auth works).\n' +
      '  To sync Firebase uids + CRUD permissions: export users collection or set FIREBASE_SERVICE_ACCOUNT_*',
  );
}

console.log(`\n[4/4] Verification`);
const verification = await verifyMigrationCounts(sqliteDb, firestoreReport.counts, sqliteReport.counts);
printVerificationReport(verification);

sqliteDb.close();
await prisma.$disconnect();

if (!verification.allOk) {
  process.exitCode = 1;
}
