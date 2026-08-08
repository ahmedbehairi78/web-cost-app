import fs from 'node:fs/promises';
import path from 'node:path';

export type FirestoreDoc = Record<string, unknown> & { _id: string };

export type FirestoreBackupFile = {
  exportedAt?: string;
  version?: number;
  /** Present on exports from `buildPostgresBackup` (normalized child tables). */
  source?: 'postgres' | string;
  collections: Record<string, FirestoreDoc[]>;
};

/** Recursively restore Firestore Timestamp tags from Settings backup JSON. */
export function deserialiseFirestoreValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(deserialiseFirestoreValue);
  if (v !== null && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (obj._fsTimestamp === true && typeof obj.s === 'number') {
      return new Date(obj.s * 1000 + Math.floor((obj.ns as number) / 1_000_000));
    }
    return Object.fromEntries(
      Object.entries(obj).map(([k, val]) => [k, deserialiseFirestoreValue(val)]),
    );
  }
  return v;
}

export function docId(doc: Record<string, unknown>): string {
  return String(doc._id ?? doc.id ?? '');
}

export async function loadFirestoreBackup(filePath: string): Promise<FirestoreBackupFile> {
  const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>;

  if (raw.collections && typeof raw.collections === 'object') {
    const collections: Record<string, FirestoreDoc[]> = {};
    for (const [name, docs] of Object.entries(raw.collections as Record<string, unknown[]>)) {
      collections[name] = (docs ?? []).map((d) => {
        const doc = deserialiseFirestoreValue(d) as Record<string, unknown>;
        const id = docId(doc);
        const { _id: _ignored, ...rest } = doc;
        return { _id: id, ...rest };
      });
    }
    return {
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : undefined,
      version: typeof raw.version === 'number' ? raw.version : undefined,
      collections,
    };
  }

  // Legacy per-collection JSON folder (migration-data/*.json)
  const dir = filePath.endsWith('.json') ? path.dirname(filePath) : filePath;
  const collections: Record<string, FirestoreDoc[]> = {};
  const names = [
    'projects',
    'contracts',
    'boq_items',
    'billing',
    'purchase_transactions',
    'suppliers',
    'chart_of_accounts',
    'transactions',
    'bank_accounts',
    'bank_movements',
    'bank_cheques',
    'bank_statements',
    'bank_statement_lines',
  ];
  for (const name of names) {
    try {
      const rows = JSON.parse(await fs.readFile(path.join(dir, `${name}.json`), 'utf8')) as Record<
        string,
        unknown
      >[];
      collections[name] = rows.map((row) => {
        const id = docId(row);
        return { _id: id, ...row };
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return { collections };
}

export function collection(backup: FirestoreBackupFile, name: string): FirestoreDoc[] {
  return backup.collections[name] ?? [];
}

/** Postgres v3 backups store journal/billing/purchase lines in separate collections. */
export function usesNormalizedChildTables(backup: FirestoreBackupFile): boolean {
  if (backup.source === 'postgres') return true;
  if (backup.version === 3) return true;
  return collection(backup, 'journal_entries').length > 0;
}
