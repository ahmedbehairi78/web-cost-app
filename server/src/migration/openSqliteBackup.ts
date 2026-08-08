import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const parentRoot = path.resolve(repoRoot, '..');

/** Standard backup bundle: `backups/<timestamp>/sqlite/financial-core.sqlite` (+ wal/shm). */
export const BACKUP_BUNDLE_SQLITE_CANDIDATES = [
  path.join(parentRoot, 'backups', '20260614-055130', 'sqlite', 'financial-core.sqlite'),
  path.join(parentRoot, 'backups', '20260614-055130', 'financial-core.sqlite'),
  path.join(repoRoot, 'backups', '20260614-055130', 'sqlite', 'financial-core.sqlite'),
  path.join(repoRoot, 'server', 'data', 'financial-core.sqlite'),
];

export function resolveSqliteBackupPath(explicitPath?: string): string {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`SQLite backup not found: ${resolved}`);
    }
    return resolved;
  }
  const found = BACKUP_BUNDLE_SQLITE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      `SQLite backup not found. Tried:\n${BACKUP_BUNDLE_SQLITE_CANDIDATES.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
  return found;
}

export function openSqliteBackupReadonly(explicitPath?: string): Database.Database {
  const dbPath = resolveSqliteBackupPath(explicitPath);
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

export function sqliteTableCount(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get() as { c: number };
  return row.c;
}
