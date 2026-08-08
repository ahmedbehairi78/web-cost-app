import { apiRequest, ApiError } from '../apiClient';
import { isBrowserOnline, isNetworkError, subscribeOnlineStatus } from './networkStatus';
import {
  listAutoFlushable,
  listAwaitingConfirm,
  removeOutboxItem,
  updateOutboxItem,
  getOutboxItem,
} from './syncOutbox';
import { OFFLINE_CHANGED_EVENT, OFFLINE_OPEN_PENDING_EVENT, type SyncOutboxItem } from './types';

let flushInProgress = false;
let currentUserId: string | null = null;
let flushPausedForAuth = false;

const OFFLINE_UID_KEY = 'web_cost_offline_uid';

export function getOfflineSessionUserId(): string | null {
  if (currentUserId) return currentUserId;
  try {
    return sessionStorage.getItem(OFFLINE_UID_KEY);
  } catch {
    return null;
  }
}

export function setOfflineSyncUserId(userId: string | null): void {
  currentUserId = userId;
  flushPausedForAuth = false;
  try {
    if (userId) sessionStorage.setItem(OFFLINE_UID_KEY, userId);
    else sessionStorage.removeItem(OFFLINE_UID_KEY);
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OFFLINE_CHANGED_EVENT));
  }
}

export function isOfflineFlushPausedForAuth(): boolean {
  return flushPausedForAuth;
}

export function requestOpenPendingSyncPanel(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OFFLINE_OPEN_PENDING_EVENT));
}

async function flushOne(item: SyncOutboxItem): Promise<void> {
  await updateOutboxItem(item.id, {
    status: 'syncing',
    attempts: item.attempts + 1,
  });
  try {
    await apiRequest(item.path, {
      method: item.method,
      body: item.body !== undefined ? JSON.stringify(item.body) : undefined,
      headers: {
        'Idempotency-Key': item.idempotencyKey,
      },
    });
    await removeOutboxItem(item.id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      flushPausedForAuth = true;
      await updateOutboxItem(item.id, {
        status: item.requiresUserConfirm ? 'awaiting_confirm' : 'queued',
        lastError: 'Authentication required',
      });
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    await updateOutboxItem(item.id, {
      status: item.requiresUserConfirm ? 'awaiting_confirm' : 'failed',
      lastError: message,
    });
    if (!isNetworkError(err) && !(err instanceof ApiError)) {
      /* business error — leave failed */
    }
  }
}

/** Auto-flush safe_save items only. */
export async function flushSafeOutbox(userId?: string | null): Promise<{ flushed: number; failed: number }> {
  const uid = userId ?? currentUserId;
  if (!uid || flushInProgress || flushPausedForAuth || !isBrowserOnline()) {
    return { flushed: 0, failed: 0 };
  }
  flushInProgress = true;
  let flushed = 0;
  let failed = 0;
  try {
    const items = await listAutoFlushable(uid);
    for (const item of items) {
      if (flushPausedForAuth) break;
      const before = item.attempts;
      await flushOne(item);
      const still = await listAutoFlushable(uid);
      if (!still.find((x) => x.id === item.id)) flushed += 1;
      else failed += 1;
      void before;
    }
  } finally {
    flushInProgress = false;
  }
  return { flushed, failed };
}

/** User-confirmed flush of a single awaiting_confirm item. */
export async function confirmAndFlushOutboxItem(itemId: string): Promise<void> {
  const item = await getOutboxItem(itemId);
  if (!item) throw new Error('Outbox item not found');
  if (!isBrowserOnline()) throw new Error('Still offline');
  flushPausedForAuth = false;
  await flushOne({ ...item, requiresUserConfirm: true, status: 'awaiting_confirm' });
  const left = await getOutboxItem(itemId);
  if (left) {
    throw new Error(left.lastError || 'Sync failed');
  }
}

export async function discardOutboxItem(itemId: string): Promise<void> {
  await removeOutboxItem(itemId);
}

/** Start listening for online + outbox changes; returns cleanup. */
export function startOfflineSyncController(userId: string): () => void {
  setOfflineSyncUserId(userId);
  const tryFlush = () => {
    void flushSafeOutbox(userId).then(async (r) => {
      if (r.flushed > 0 || r.failed > 0) {
        const pending = await listAwaitingConfirm(userId);
        if (pending.length > 0 && isBrowserOnline()) {
          requestOpenPendingSyncPanel();
        }
      } else {
        const pending = await listAwaitingConfirm(userId);
        if (pending.length > 0 && isBrowserOnline()) {
          requestOpenPendingSyncPanel();
        }
      }
    });
  };

  const unsubOnline = subscribeOnlineStatus((online) => {
    if (online) tryFlush();
  });

  const onChanged = () => {
    if (isBrowserOnline()) tryFlush();
  };
  window.addEventListener(OFFLINE_CHANGED_EVENT, onChanged);

  // Initial pass
  tryFlush();

  return () => {
    unsubOnline();
    window.removeEventListener(OFFLINE_CHANGED_EVENT, onChanged);
    if (currentUserId === userId) setOfflineSyncUserId(null);
  };
}
