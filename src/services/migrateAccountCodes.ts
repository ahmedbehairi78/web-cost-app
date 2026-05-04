import {
  collection, getDocs, writeBatch, doc, query, where, serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import { JournalEntry, invalidateCoaCache } from './accountingService';
import { CHART_OF_ACCOUNTS_SEED } from '../data/chartOfAccountsSeed';

/**
 * One-time migration: corrects transaction entries that used old account codes
 * (12xxxxxx-based) before the COA seed was aligned with accountingService.ts.
 *
 * Old codes → New codes:
 *   12101001 → 11101001  BANK
 *   12201001 → 11201001  RECEIVABLES
 *   12202001 → 11202001  RETENTION_GUARANTEE
 *   12301001 → 11301001  ADVANCE_TO_SUPPLIERS
 *   12302001 → 11302001  ADVANCE_TO_SUBCONTRACTORS
 *   12401001 → 11401001  VAT_INPUT
 *   12401002 → 11401002  WHT_RECEIVABLE
 *   12402001 → 11402001  SOCIAL_INSURANCE_RECEIVABLE
 *   12403001 → 11403001  MANPOWER_LEVY_RECEIVABLE
 *   21401002 → 21402001  WHT_PAYABLE
 */
const CODE_MAP: Record<string, string> = {
  '12101001': '11101001',
  '12201001': '11201001',
  '12202001': '11202001',
  '12301001': '11301001',
  '12302001': '11302001',
  '12401001': '11401001',
  '12401002': '11401002',
  '12402001': '11402001',
  '12403001': '11403001',
  '21401002': '21402001',
};

const OLD_CODES = new Set(Object.keys(CODE_MAP));

export interface MigrationResult {
  scanned: number;
  updated: number;
  skipped: number;
}

export interface PatchCoaResult {
  checked: number;
  added: number;
}

export interface DeduplicateCoaResult {
  scanned: number;
  removed: number;
}

/**
 * Scans all non-deleted transactions and rewrites any entries that contain
 * old account codes. Uses batched writes (≤ 400 ops per batch).
 */
export async function migrateAccountCodes(): Promise<MigrationResult> {
  const q = query(collection(db, 'transactions'), where('isDeleted', '==', false));
  const snap = await getDocs(q);

  let updated = 0;
  let skipped = 0;

  const BATCH_SIZE = 400;
  const docs = snap.docs;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    let batchHasWrites = false;

    const chunk = docs.slice(i, i + BATCH_SIZE);
    for (const txDoc of chunk) {
      const data = txDoc.data();
      const entries: JournalEntry[] = data.entries || [];
      const needsMigration = entries.some(e => OLD_CODES.has(e.accountCode));

      if (!needsMigration) {
        skipped++;
        continue;
      }

      const newEntries = entries.map(e => ({
        ...e,
        accountCode: CODE_MAP[e.accountCode] ?? e.accountCode,
      }));

      batch.update(doc(db, 'transactions', txDoc.id), { entries: newEntries });
      updated++;
      batchHasWrites = true;
    }

    if (batchHasWrites) {
      await batch.commit();
    }
  }

  return { scanned: docs.length, updated, skipped };
}

/**
 * Adds any accounts from CHART_OF_ACCOUNTS_SEED that are missing from the
 * Firestore chart_of_accounts collection. Never modifies existing documents.
 *
 * Run this once after upgrading to the new AccountCodes enum (11xxxxxx assets).
 * Also run after changing the seed file to ensure Firestore stays in sync.
 */
export async function patchMissingCoaAccounts(): Promise<PatchCoaResult> {
  // Fetch current COA codes from Firestore
  const existing = await getDocs(collection(db, 'chart_of_accounts'));
  const existingCodes = new Set(
    existing.docs.map(d => d.data().accountCode as string).filter(Boolean)
  );

  // Determine which seed accounts are missing
  const missing = CHART_OF_ACCOUNTS_SEED.filter(a => !existingCodes.has(a.accountCode));

  if (missing.length === 0) {
    return { checked: CHART_OF_ACCOUNTS_SEED.length, added: 0 };
  }

  const BATCH_SIZE = 400;
  const colRef = collection(db, 'chart_of_accounts');

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = missing.slice(i, i + BATCH_SIZE);
    chunk.forEach(account => {
      batch.set(doc(colRef), { ...account, createdAt: serverTimestamp() });
    });
    await batch.commit();
  }

  // Force COA cache refresh so new accounts are immediately usable
  invalidateCoaCache();

  return { checked: CHART_OF_ACCOUNTS_SEED.length, added: missing.length };
}

/**
 * Removes duplicate chart_of_accounts documents that share the same accountCode.
 *
 * When multiple docs share a code, the one whose accountName matches the seed is kept.
 * If none match the seed, the first document encountered is kept.
 * Duplicates cause wrong names to appear in balance sheet / trial balance because
 * Map construction overwrites with the last occurrence.
 */
export async function deduplicateCoaAccounts(): Promise<DeduplicateCoaResult> {
  const snap = await getDocs(collection(db, 'chart_of_accounts'));

  // Build seed name lookup for tie-breaking
  const seedNameByCode = new Map<string, string>(
    CHART_OF_ACCOUNTS_SEED.map(a => [a.accountCode, a.accountName])
  );

  // Group all docs by accountCode
  const byCode = new Map<string, typeof snap.docs>();
  for (const d of snap.docs) {
    const code = d.data().accountCode as string;
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code)!.push(d);
  }

  // Collect doc IDs to delete
  const toDelete: string[] = [];
  for (const [code, docs] of byCode) {
    if (docs.length <= 1) continue;

    const seedName = seedNameByCode.get(code);
    // Prefer the doc whose name matches the seed; fall back to first doc
    const keepIdx = seedName
      ? docs.findIndex(d => d.data().accountName === seedName)
      : 0;
    const keepAt = keepIdx === -1 ? 0 : keepIdx;

    docs.forEach((d, i) => { if (i !== keepAt) toDelete.push(d.id); });
  }

  if (toDelete.length === 0) {
    return { scanned: snap.size, removed: 0 };
  }

  // Delete in batches of 400
  const BATCH_SIZE = 400;
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    toDelete.slice(i, i + BATCH_SIZE).forEach(id =>
      batch.delete(doc(collection(db, 'chart_of_accounts'), id))
    );
    await batch.commit();
  }

  invalidateCoaCache();
  return { scanned: snap.size, removed: toDelete.length };
}
