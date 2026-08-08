import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../env.js';

type SqliteMigration = {
  id: string;
  name: string;
  appliedAt: string;
};

let sqliteDb: Database.Database | null = null;
let sqliteReady = false;

function ensureMigrationsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _sqlite_migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function resolveMigrationsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'server/sqlite/migrations'),
    path.resolve(process.cwd(), 'dist-server/sqlite/migrations'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('SQLite migrations directory not found.');
}

function applyMigrations(db: Database.Database): number {
  ensureMigrationsTable(db);
  const migrationsDir = resolveMigrationsDir();
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  let applied = 0;
  const hasMigrationStmt = db.prepare('SELECT 1 FROM _sqlite_migrations WHERE id = ?');
  const saveMigrationStmt = db.prepare(
    'INSERT INTO _sqlite_migrations (id, name, applied_at) VALUES (?, ?, datetime(\'now\'))'
  );

  for (const file of files) {
    const id = file.split('_')[0] || file;
    if (hasMigrationStmt.get(id)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      saveMigrationStmt.run(id, file);
      db.exec('COMMIT');
      applied += 1;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return applied;
}

export function initSqliteCore() {
  if (!env.sqliteCoreEnabled) return;
  if (sqliteReady) return;
  const dbPath = env.sqliteCoreDbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  sqliteDb = new Database(dbPath);
  sqliteDb.pragma('foreign_keys = ON');
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('busy_timeout = 5000');
  const applied = applyMigrations(sqliteDb);
  sqliteReady = true;
  console.log(`[sqlite-core] ready at ${dbPath} (${applied} new migrations)`);
}

export function getSqliteCoreDb(): Database.Database {
  if (!sqliteDb) {
    throw new Error('SQLite core is not initialized.');
  }
  return sqliteDb;
}

export function getSqliteCoreStatus() {
  if (!sqliteDb) {
    return { ready: false, dbPath: env.sqliteCoreDbPath, migrationsApplied: 0, tables: [] as string[] };
  }
  const migrationCount = sqliteDb
    .prepare('SELECT COUNT(*) as c FROM _sqlite_migrations')
    .get() as { c: number };
  const tables = sqliteDb
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as Array<{ name: string }>;
  return {
    ready: true,
    dbPath: env.sqliteCoreDbPath,
    migrationsApplied: migrationCount.c,
    tables: tables.map((t) => t.name),
  };
}

export function listSqliteMigrations(): SqliteMigration[] {
  if (!sqliteDb) return [];
  return sqliteDb
    .prepare(
      'SELECT id, name, applied_at as appliedAt FROM _sqlite_migrations ORDER BY id'
    )
    .all() as SqliteMigration[];
}

export function closeSqliteCore() {
  if (!sqliteDb) return;
  sqliteDb.close();
  sqliteDb = null;
  sqliteReady = false;
}
