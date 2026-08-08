import { idbDelete, idbGet, idbGetAllByUserId, idbPut } from './idb';
import type { OutboxStatus, SyncOpClass, SyncOpType, SyncOutboxItem } from './types';
import { OFFLINE_CHANGED_EVENT } from './types';

function emitChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OFFLINE_CHANGED_EVENT));
}

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `ob_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export interface EnqueueOutboxInput {
  userId: string;
  opType: SyncOpType;
  opClass: SyncOpClass;
  method: SyncOutboxItem['method'];
  path: string;
  body?: unknown;
  summary: string;
  idempotencyKey?: string;
  requiresUserConfirm?: boolean;
}

export async function enqueueOutbox(input: EnqueueOutboxInput): Promise<SyncOutboxItem> {
  const now = new Date().toISOString();
  const requiresUserConfirm = input.requiresUserConfirm ?? input.opClass === 'confirm_required';
  const item: SyncOutboxItem = {
    id: newId(),
    userId: input.userId,
    opType: input.opType,
    opClass: input.opClass,
    method: input.method,
    path: input.path,
    body: input.body,
    idempotencyKey: input.idempotencyKey ?? createIdempotencyKey(),
    summary: input.summary,
    status: requiresUserConfirm ? 'awaiting_confirm' : 'queued',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    requiresUserConfirm,
  };
  await idbPut('sync_outbox', { ...item });
  emitChanged();
  return item;
}

export async function listOutbox(userId: string): Promise<SyncOutboxItem[]> {
  if (!userId) return [];
  const rows = await idbGetAllByUserId<SyncOutboxItem>('sync_outbox', userId);
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getOutboxItem(id: string): Promise<SyncOutboxItem | null> {
  return idbGet<SyncOutboxItem>('sync_outbox', id);
}

export async function updateOutboxItem(
  id: string,
  patch: Partial<Pick<SyncOutboxItem, 'status' | 'attempts' | 'lastError' | 'updatedAt'>>,
): Promise<SyncOutboxItem | null> {
  const existing = await getOutboxItem(id);
  if (!existing) return null;
  const next: SyncOutboxItem = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await idbPut('sync_outbox', { ...next });
  emitChanged();
  return next;
}

export async function removeOutboxItem(id: string): Promise<void> {
  await idbDelete('sync_outbox', id);
  emitChanged();
}

export async function countOutboxByStatus(
  userId: string,
  statuses: OutboxStatus[],
): Promise<number> {
  const all = await listOutbox(userId);
  return all.filter((i) => statuses.includes(i.status)).length;
}

export async function listAutoFlushable(userId: string): Promise<SyncOutboxItem[]> {
  const all = await listOutbox(userId);
  return all.filter(
    (i) => !i.requiresUserConfirm && (i.status === 'queued' || i.status === 'failed'),
  );
}

export async function listAwaitingConfirm(userId: string): Promise<SyncOutboxItem[]> {
  const all = await listOutbox(userId);
  return all.filter((i) => i.requiresUserConfirm && i.status === 'awaiting_confirm');
}

/** True when outbox has pending work for idle-logout gate. */
export async function hasPendingOfflineWork(userId: string): Promise<boolean> {
  if (!userId) return false;
  const items = await listOutbox(userId);
  return items.some((i) =>
    i.status === 'queued'
    || i.status === 'failed'
    || i.status === 'awaiting_confirm'
    || i.status === 'syncing',
  );
}
