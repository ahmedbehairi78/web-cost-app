/** Compare backup-bundle SQLite vs live server/data SQLite row counts. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { resolveSqliteBackupPath } from '../migration/openSqliteBackup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const livePath = path.join(repoRoot, 'server/data/financial-core.sqlite');
const backupPath = resolveSqliteBackupPath();

const tables = [
  'chart_of_accounts',
  'gl_transactions',
  'gl_entries',
  'users',
  'material_groups',
  'consumption_orders',
  'project_inventory_transfers',
];

function counts(db: Database.Database) {
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
    (r) => r.name,
  );
  const out: Record<string, number | string> = {};
  for (const t of tables) {
    out[t] = names.includes(t) ? (db.prepare(`SELECT COUNT(*) as c FROM "${t}"`).get() as { c: number }).c : '—';
  }
  return out;
}

const backupDb = new Database(backupPath, { readonly: true });
const liveDb = new Database(livePath, { readonly: true });

console.log('\n=== SQLite: backup bundle vs live server/data ===\n');
console.log('Backup:', backupPath);
console.log('Live:  ', livePath);
console.log('\ntable                          backup  live');
for (const t of tables) {
  const b = counts(backupDb)[t];
  const l = counts(liveDb)[t];
  const mark = b !== l ? '  ← differs' : '';
  console.log(`${t.padEnd(30)} ${String(b).padStart(6)}  ${String(l).padStart(6)}${mark}`);
}

backupDb.close();
liveDb.close();
