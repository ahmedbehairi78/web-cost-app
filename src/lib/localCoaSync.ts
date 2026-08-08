import { collection, getDocs, query, where } from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import { db } from '../firebase';
import { ApiError, apiClient } from './apiClient';
import { isLocalBackend } from './dataBackend';
import { chartOfAccountsApi } from '../services/local/modulesApi';
import type { JournalEntry } from '../services/accountingService';

export type CoaSyncPayload = {
  id: string;
  accountCode: string;
  accountName: string;
  accountNameEn?: string;
  parentCode: string;
  type: string;
  isGroup: boolean;
  status: 'active' | 'disabled';
  statementType?: string;
  supplierId?: string;
};

let bootstrapPromise: Promise<{ synced: number; updated: number }> | null = null;

const BATCH_SYNC_PATHS = ['/gl/coa/sync-batch', '/chart-of-accounts/sync-batch'] as const;
const ENSURE_MISSING_PATHS = ['/gl/coa/ensure-missing', '/chart-of-accounts/ensure-missing'] as const;

function mapFirestoreCoaRow(id: string, data: Record<string, unknown>): CoaSyncPayload | null {
  const accountCode = String(data.accountCode || '').trim();
  if (!accountCode) return null;
  return {
    id,
    accountCode,
    accountName: String(data.accountName || accountCode),
    accountNameEn: data.accountNameEn ? String(data.accountNameEn) : undefined,
    parentCode: String(data.parentCode || accountCode.slice(0, 5)),
    type: String(data.type || 'asset'),
    isGroup: data.isGroup === true,
    status: data.status === 'disabled' ? 'disabled' : 'active',
    statementType: data.statementType ? String(data.statementType) : undefined,
    supplierId: data.supplierId ? String(data.supplierId) : undefined,
  };
}

function isFirestorePermissionError(error: unknown): boolean {
  return error instanceof FirebaseError && error.code === 'permission-denied';
}

function isUniqueCoaError(error: unknown): boolean {
  return error instanceof ApiError && /UNIQUE constraint failed/i.test(error.message);
}

function isBatchUnavailableError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 404 || error.status === 405) return true;
  if (error.status === 403) return true;
  return false;
}

async function upsertCoaAccountSequential(account: CoaSyncPayload): Promise<'created' | 'exists' | 'skipped'> {
  try {
    await chartOfAccountsApi.create({
      id: account.id,
      accountCode: account.accountCode,
      accountName: account.accountName,
      accountNameEn: account.accountNameEn,
      parentCode: account.parentCode,
      type: account.type,
      isGroup: account.isGroup,
      status: account.status,
      statementType: account.statementType,
      supplierId: account.supplierId,
    });
    return 'created';
  } catch (error) {
    if (isUniqueCoaError(error)) return 'exists';
    if (error instanceof ApiError && error.status === 403) return 'skipped';
    throw error;
  }
}

async function syncCoaAccountsBatch(accounts: CoaSyncPayload[]): Promise<{ synced: number; updated: number } | null> {
  for (const path of BATCH_SYNC_PATHS) {
    try {
      return await apiClient.post<{ synced: number; updated: number }>(path, { accounts });
    } catch (error) {
      if (isBatchUnavailableError(error)) continue;
      throw error;
    }
  }
  return null;
}

async function syncCoaAccountsSequential(accounts: CoaSyncPayload[]): Promise<{ synced: number; updated: number }> {
  let synced = 0;
  let updated = 0;
  for (const account of accounts) {
    const result = await upsertCoaAccountSequential(account);
    if (result === 'created') synced += 1;
    else if (result === 'exists') updated += 1;
  }
  return { synced, updated };
}

async function syncCoaAccounts(accounts: CoaSyncPayload[]): Promise<{ synced: number; updated: number }> {
  if (accounts.length === 0) return { synced: 0, updated: 0 };
  const batch = await syncCoaAccountsBatch(accounts);
  if (batch) return batch;
  return syncCoaAccountsSequential(accounts);
}

async function ensureMissingCoa(data: {
  codes?: string[];
  extras?: Array<{ accountCode: string; accountName?: string }>;
}): Promise<void> {
  for (const path of ENSURE_MISSING_PATHS) {
    try {
      await apiClient.post(path, data);
      return;
    } catch (error) {
      if (isBatchUnavailableError(error)) continue;
      throw error;
    }
  }
  if (data.extras?.length) {
    for (const extra of data.extras) {
      await upsertCoaAccountSequential({
        id: extra.accountCode,
        accountCode: extra.accountCode,
        accountName: extra.accountName || extra.accountCode,
        parentCode: extra.accountCode.slice(0, 5),
        type: extra.accountCode.startsWith('5') ? 'expense' : 'asset',
        isGroup: false,
        status: 'active',
      });
    }
  }
}

async function bootstrapLocalCoaFromSqlite(): Promise<{ synced: number; updated: number }> {
  let rows = (await chartOfAccountsApi.list()) as CoaSyncPayload[];
  if (rows.length === 0) {
    try {
      await ensureMissingCoa({});
      rows = (await chartOfAccountsApi.list()) as CoaSyncPayload[];
    } catch {
      // GL journal post auto-registers accounts server-side.
    }
  }
  return { synced: rows.length, updated: 0 };
}

async function tryEnrichCoaFromFirestore(): Promise<{ synced: number; updated: number } | null> {
  try {
    const snap = await getDocs(collection(db, 'chart_of_accounts'));
    const accounts = snap.docs
      .map((d) => mapFirestoreCoaRow(d.id, d.data() as Record<string, unknown>))
      .filter((row): row is CoaSyncPayload => Boolean(row));
    if (accounts.length === 0) return null;
    return await syncCoaAccounts(accounts);
  } catch (error) {
    if (isFirestorePermissionError(error)) return null;
    throw error;
  }
}

/** Local COA bootstrap: SQLite first; optional Firestore enrich when rules allow. */
export async function bootstrapLocalCoaFromFirestore(): Promise<{ synced: number; updated: number }> {
  if (!isLocalBackend) return { synced: 0, updated: 0 };
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const sqlite = await bootstrapLocalCoaFromSqlite();
    try {
      const enriched = await tryEnrichCoaFromFirestore();
      return enriched ?? sqlite;
    } catch (error) {
      if (isFirestorePermissionError(error)) return sqlite;
      console.warn('Local COA Firestore enrich skipped:', error);
      return sqlite;
    }
  })().catch((err) => {
    bootstrapPromise = null;
    throw err;
  });

  return bootstrapPromise;
}

/** Sync specific account codes used in a journal (safety net after bootstrap). */
export async function syncCoaCodesFromFirestore(
  accountCodes: string[],
  entryHints?: JournalEntry[],
): Promise<void> {
  if (!isLocalBackend) return;
  const codes = [...new Set(accountCodes.map(String).filter(Boolean))];
  if (codes.length === 0) return;

  const byCode = new Map<string, CoaSyncPayload>();
  try {
    for (let i = 0; i < codes.length; i += 10) {
      const chunk = codes.slice(i, i + 10);
      const snap = await getDocs(
        query(collection(db, 'chart_of_accounts'), where('accountCode', 'in', chunk)),
      );
      for (const d of snap.docs) {
        const row = mapFirestoreCoaRow(d.id, d.data() as Record<string, unknown>);
        if (row && !row.isGroup) byCode.set(row.accountCode, row);
      }
    }
  } catch (error) {
    if (!isFirestorePermissionError(error)) throw error;
  }

  const fromFirestore = [...byCode.values()];
  if (fromFirestore.length > 0) {
    await syncCoaAccounts(fromFirestore);
  }

  const stillMissing = codes.filter((code) => !byCode.has(code));
  if (stillMissing.length > 0) {
    await ensureMissingCoa({
      extras: stillMissing.map((code) => {
        const hint = entryHints?.find((e) => e.accountCode === code);
        return {
          accountCode: code,
          accountName: hint?.accountName?.trim() || code,
        };
      }),
    });
  }
}

/** Ensure SQLite COA contains every leaf account needed for this journal. */
export async function ensureCoaForJournalEntries(entries: JournalEntry[]): Promise<void> {
  if (!isLocalBackend) return;
  try {
    await bootstrapLocalCoaFromFirestore();
  } catch (error) {
    console.warn('COA bootstrap skipped:', error);
  }
  const codes = entries
    .map((e) => String(e.accountCode || '').trim())
    .filter(Boolean);
  if (codes.length === 0) return;
  try {
    await syncCoaCodesFromFirestore(codes, entries);
  } catch (error) {
    console.warn('COA per-code sync skipped:', error);
  }
}

export function resetLocalCoaBootstrap(): void {
  bootstrapPromise = null;
}
