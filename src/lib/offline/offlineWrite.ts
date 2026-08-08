/**
 * Shared helpers to wrap module API writes with offline queue behaviour.
 */
import { enqueueOrExecute, NetworkQueuedError } from './enqueueOrExecute';
import { getOfflineSessionUserId } from './syncController';
import type { SyncOpClass, SyncOpType } from './types';
import { isLocalBackend } from '../dataBackend';
import { apiClient } from '../apiClient';
import toast from 'react-hot-toast';

export { NetworkQueuedError };

function tQueued(requiresConfirm: boolean): void {
  try {
    // LanguageContext not always available from services — use dual message via document dir
    const ar = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
    toast(
      requiresConfirm
        ? (ar ? 'العملية بانتظار تأكيدك بعد عودة الشبكة' : 'Queued for confirmation when back online')
        : (ar ? 'حُفظت العملية للطابور — تُرسل عند عودة الشبكة' : 'Queued — will send when back online'),
    );
  } catch {
    /* ignore */
  }
}

export async function offlineWrite<T>(opts: {
  opType: SyncOpType;
  opClass: SyncOpClass;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  summary: string;
  /** Fallback when offline queue not applicable */
  execute: () => Promise<T>;
}): Promise<T> {
  if (!isLocalBackend) return opts.execute();
  const userId = getOfflineSessionUserId();
  if (!userId) return opts.execute();
  try {
    return await enqueueOrExecute<T>({
      userId,
      opType: opts.opType,
      opClass: opts.opClass,
      method: opts.method,
      path: opts.path,
      body: opts.body,
      summary: opts.summary,
    });
  } catch (err) {
    if (err instanceof NetworkQueuedError) {
      tQueued(err.requiresUserConfirm);
      throw err;
    }
    throw err;
  }
}

/** Convenience: POST with offline queue */
export function offlinePost<T>(
  path: string,
  body: unknown,
  meta: { opType: SyncOpType; opClass: SyncOpClass; summary: string },
): Promise<T> {
  return offlineWrite({
    ...meta,
    method: 'POST',
    path,
    body,
    execute: () => apiClient.post<T>(path, body),
  });
}

export function offlinePatch<T>(
  path: string,
  body: unknown,
  meta: { opType: SyncOpType; opClass: SyncOpClass; summary: string },
): Promise<T> {
  return offlineWrite({
    ...meta,
    method: 'PATCH',
    path,
    body,
    execute: () => apiClient.patch<T>(path, body),
  });
}

export function offlinePut<T>(
  path: string,
  body: unknown,
  meta: { opType: SyncOpType; opClass: SyncOpClass; summary: string },
): Promise<T> {
  return offlineWrite({
    ...meta,
    method: 'PUT',
    path,
    body,
    execute: () => apiClient.put<T>(path, body),
  });
}
