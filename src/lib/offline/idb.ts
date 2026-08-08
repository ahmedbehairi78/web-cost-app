/** Minimal IndexedDB helpers with in-memory fallback (tests / private mode). */

const DB_NAME = 'web_cost_offline_v1';
const DB_VERSION = 1;

type StoreName = 'form_drafts' | 'sync_outbox';

interface MemoryDb {
  form_drafts: Map<string, unknown>;
  sync_outbox: Map<string, unknown>;
}

const memory: MemoryDb = {
  form_drafts: new Map(),
  sync_outbox: new Map(),
};

let useMemory = typeof indexedDB === 'undefined';

function openDb(): Promise<IDBDatabase> {
  if (useMemory) {
    return Promise.reject(new Error('memory'));
  }
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => {
        useMemory = true;
        reject(req.error ?? new Error('idb open failed'));
      };
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('form_drafts')) {
          const store = db.createObjectStore('form_drafts', { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
        }
        if (!db.objectStoreNames.contains('sync_outbox')) {
          const store = db.createObjectStore('sync_outbox', { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
    } catch {
      useMemory = true;
      reject(new Error('idb unavailable'));
    }
  });
}

async function withStore<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req = fn(store);
      tx.oncomplete = () => {
        if (req) resolve(req.result as T);
        else resolve(undefined);
      };
      tx.onerror = () => reject(tx.error);
      if (req) {
        req.onerror = () => reject(req.error);
      }
    });
  } catch {
    return undefined;
  }
}

export async function idbPut(storeName: StoreName, value: { id: string } & Record<string, unknown>): Promise<void> {
  if (useMemory) {
    memory[storeName].set(value.id, value);
    return;
  }
  try {
    await withStore(storeName, 'readwrite', (store) => {
      store.put(value);
    });
  } catch {
    useMemory = true;
    memory[storeName].set(value.id, value);
  }
}

export async function idbGet<T>(storeName: StoreName, id: string): Promise<T | null> {
  if (useMemory) {
    return (memory[storeName].get(id) as T) ?? null;
  }
  try {
    const result = await withStore<T>(storeName, 'readonly', (store) => store.get(id));
    return result ?? null;
  } catch {
    useMemory = true;
    return (memory[storeName].get(id) as T) ?? null;
  }
}

export async function idbDelete(storeName: StoreName, id: string): Promise<void> {
  if (useMemory) {
    memory[storeName].delete(id);
    return;
  }
  try {
    await withStore(storeName, 'readwrite', (store) => {
      store.delete(id);
    });
  } catch {
    useMemory = true;
    memory[storeName].delete(id);
  }
}

export async function idbGetAllByUserId<T extends { userId: string }>(
  storeName: StoreName,
  userId: string,
): Promise<T[]> {
  if (useMemory) {
    return [...memory[storeName].values()].filter(
      (v) => (v as T).userId === userId,
    ) as T[];
  }
  try {
    const db = await openDb();
    return await new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index('userId');
      const req = index.getAll(userId);
      req.onsuccess = () => resolve((req.result as T[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    useMemory = true;
    return [...memory[storeName].values()].filter(
      (v) => (v as T).userId === userId,
    ) as T[];
  }
}

/** Test helper — clear stores and force memory backend. */
export function __resetOfflineMemoryForTests(): void {
  memory.form_drafts.clear();
  memory.sync_outbox.clear();
  useMemory = true;
}
