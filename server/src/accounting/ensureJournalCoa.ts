import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Prisma } from '@prisma/client';
import { nowIso } from '../sqlite/appDb.js';

type JournalLine = { accountCode: string; accountName?: string };

function inferCoaType(code: string): string {
  if (code.startsWith('1')) return 'asset';
  if (code.startsWith('2')) return 'liability';
  if (code.startsWith('3')) return 'equity';
  if (code.startsWith('4')) return 'revenue';
  if (code.startsWith('5')) return 'expense';
  return 'asset';
}

/** Auto-register journal line accounts in SQLite COA (no separate COA API permission needed). */
export function ensureJournalCoaAccounts(db: Database.Database, entries: JournalLine[]): void {
  const ts = nowIso();
  const existsStmt = db.prepare('SELECT id FROM chart_of_accounts WHERE account_code = ?');
  const insertStmt = db.prepare(`
    INSERT INTO chart_of_accounts
      (id, account_code, account_name, parent_code, type, is_group, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?)
  `);
  const updateNameStmt = db.prepare(`
    UPDATE chart_of_accounts SET account_name = ?, updated_at = ? WHERE account_code = ?
  `);

  for (const entry of entries) {
    const code = String(entry.accountCode || '').trim();
    if (!code) continue;
    const name = String(entry.accountName || code).trim() || code;
    const existing = existsStmt.get(code) as { id: string } | undefined;
    if (existing) {
      updateNameStmt.run(name, ts, code);
      continue;
    }
    insertStmt.run(
      randomUUID(),
      code,
      name,
      code.length >= 5 ? code.slice(0, 5) : code,
      inferCoaType(code),
      ts,
      ts,
    );
  }
}

/** Postgres/Prisma variant — auto-registers journal line accounts in the COA. */
export async function ensureJournalCoaAccountsPg(
  tx: Prisma.TransactionClient,
  entries: JournalLine[],
): Promise<void> {
  for (const entry of entries) {
    const code = String(entry.accountCode || '').trim();
    if (!code) continue;
    const name = String(entry.accountName || code).trim() || code;
    await tx.chartOfAccount.upsert({
      where: { accountCode: code },
      update: { accountName: name },
      create: {
        id: randomUUID(),
        accountCode: code,
        accountName: name,
        parentCode: code.length >= 5 ? code.slice(0, 5) : code,
        type: inferCoaType(code),
        isGroup: false,
        status: 'active',
      },
    });
  }
}
