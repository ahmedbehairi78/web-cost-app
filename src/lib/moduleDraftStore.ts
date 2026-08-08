const STORAGE_PREFIX = 'erp-module-draft:';

function storageKey(userKey: string, moduleId: string): string {
  return `${STORAGE_PREFIX}${userKey}:${moduleId}`;
}

export function readModuleDraft<T>(userKey: string, moduleId: string): T | null {
  if (!userKey || typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey(userKey, moduleId));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeModuleDraft(userKey: string, moduleId: string, data: unknown): void {
  if (!userKey || typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(storageKey(userKey, moduleId), JSON.stringify(data));
  } catch {
    /* quota or private mode — ignore */
  }
}

export function clearModuleDraft(userKey: string, moduleId: string): void {
  if (!userKey || typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(storageKey(userKey, moduleId));
  } catch {
    /* ignore */
  }
}

export function listModuleDraftIds(userKey: string): string[] {
  if (!userKey || typeof sessionStorage === 'undefined') return [];
  const prefix = storageKey(userKey, '');
  const ids: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key?.startsWith(prefix)) {
      ids.push(key.slice(prefix.length));
    }
  }
  return ids;
}
