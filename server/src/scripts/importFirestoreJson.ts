/**
 * @deprecated Use `migrateToPostgres.ts` with Settings backup JSON.
 * Still supports legacy `migration-data/*.json` per-collection folder layout.
 */
import path from 'node:path';
import { prisma } from '../db.js';
import {
  importFirestoreBackupToPostgres,
  printImportReport,
} from '../migration/importFromFirestoreBackup.js';
import { loadFirestoreBackup } from '../migration/parseFirestoreBackup.js';

const importDir = process.argv[2] || 'migration-data';
const backup = await loadFirestoreBackup(path.resolve(importDir));
const report = await importFirestoreBackupToPostgres(backup, importDir);
await printImportReport(report);
await prisma.$disconnect();
