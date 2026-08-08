import { randomUUID } from 'node:crypto';
import session from 'express-session';
import type { SessionData } from 'express-session';
import { getSqliteCoreDb } from './core.js';
import type Database from 'better-sqlite3';

// ─── Conversion helpers ───────────────────────────────────────────────────────

function toSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}
function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => (c as string).toUpperCase());
}

const BOOL_COLS = new Set(['is_deleted', 'is_active', 'is_group']);
const JSON_COLS = new Set(['permissions', 'metadata', 'payload', 'value', 'before', 'after', 'assigned_contract_ids']);

export function rowToObj(row: Record<string, unknown>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = toCamel(k);
    if (BOOL_COLS.has(k)) {
      obj[key] = Boolean(v);
    } else if (JSON_COLS.has(k) && typeof v === 'string') {
      try {
        obj[key] = JSON.parse(v);
      } catch {
        obj[key] = v;
      }
    } else {
      obj[key] = v;
    }
  }
  return obj;
}

export function objToRow(obj: Record<string, unknown>, exclude: string[] = []): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (exclude.includes(k)) continue;
    const key = toSnake(k);
    if (v === null || v === undefined) {
      row[key] = null;
    } else if (typeof v === 'boolean') {
      row[key] = v ? 1 : 0;
    } else if (typeof v === 'object') {
      row[key] = JSON.stringify(v);
    } else {
      row[key] = v;
    }
  }
  return row;
}

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function getDb(): Database.Database {
  return getSqliteCoreDb();
}

// ─── Generic row helpers ─────────────────────────────────────────────────────

export function insertRow(table: string, data: Record<string, unknown>): void {
  const cols = Object.keys(data);
  getDb()
    .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...Object.values(data));
}

export function findById(table: string, id: string): Record<string, unknown> | undefined {
  return getDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
}

// ─── User helpers ─────────────────────────────────────────────────────────────

export type DbUser = {
  id: string;
  email: string;
  displayName: string | null;
  passwordHash: string;
  role: string;
  permissions: Record<string, boolean>;
  assignedContractIds?: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export function findUserByEmailInsensitive(email: string): DbUser | null {
  const row = getDb()
    .prepare('SELECT * FROM users WHERE lower(trim(email)) = lower(trim(?))')
    .get(email) as Record<string, unknown> | undefined;
  return row ? (rowToObj(row) as unknown as DbUser) : null;
}

export function findUserByEmail(email: string): DbUser | null {
  const row = getDb()
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email) as Record<string, unknown> | undefined;
  return row ? (rowToObj(row) as unknown as DbUser) : null;
}

export function findUserById(id: string): DbUser | null {
  const row = findById('users', id);
  return row ? (rowToObj(row) as unknown as DbUser) : null;
}

export function listActiveUsers(): DbUser[] {
  const rows = getDb()
    .prepare('SELECT * FROM users WHERE is_active = 1 ORDER BY email')
    .all() as Record<string, unknown>[];
  return rows.map((row) => rowToObj(row) as unknown as DbUser);
}

export function createUser(data: {
  id: string;
  email: string;
  displayName?: string | null;
  passwordHash: string;
  role: string;
  permissions: Record<string, boolean>;
  assignedContractIds?: string[];
}): DbUser {
  const ts = nowIso();
  insertRow('users', {
    id: data.id,
    email: data.email,
    display_name: data.displayName ?? null,
    password_hash: data.passwordHash,
    role: data.role,
    permissions: JSON.stringify(data.permissions),
    assigned_contract_ids: JSON.stringify(data.assignedContractIds ?? []),
    is_active: 1,
    created_at: ts,
    updated_at: ts,
  });
  return findUserById(data.id)!;
}

// ─── SQLite session store ─────────────────────────────────────────────────────

export class SqliteSessionStore extends session.Store {
  get(sid: string, callback: (err: unknown, session?: SessionData | null) => void): void {
    try {
      const row = getDb()
        .prepare('SELECT sess FROM sessions WHERE sid = ? AND expired_at > ?')
        .get(sid, Date.now()) as { sess: string } | undefined;
      callback(null, row ? (JSON.parse(row.sess) as SessionData) : null);
    } catch (e) {
      callback(e);
    }
  }

  set(sid: string, data: SessionData, callback?: (err?: unknown) => void): void {
    try {
      const maxAge = ((data.cookie?.maxAge as number | undefined) ?? 36000) * 1000;
      getDb()
        .prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired_at) VALUES (?, ?, ?)')
        .run(sid, JSON.stringify(data), Date.now() + maxAge);
      callback?.();
    } catch (e) {
      callback?.(e);
    }
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    try {
      getDb().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback?.();
    } catch (e) {
      callback?.(e);
    }
  }

  touch(sid: string, data: SessionData, callback?: () => void): void {
    try {
      const maxAge = ((data.cookie?.maxAge as number | undefined) ?? 36000) * 1000;
      getDb()
        .prepare('UPDATE sessions SET expired_at = ? WHERE sid = ?')
        .run(Date.now() + maxAge, sid);
    } finally {
      callback?.();
    }
  }
}
