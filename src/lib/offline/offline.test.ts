import { describe, it, expect, beforeEach } from 'vitest';
import { __resetOfflineMemoryForTests } from './idb';
import { isNetworkError } from './networkStatus';
import { NetworkError } from './NetworkError';
import { ApiError } from '../apiClient';
import {
  enqueueOutbox,
  listOutbox,
  listAutoFlushable,
  listAwaitingConfirm,
  updateOutboxItem,
  removeOutboxItem,
  createIdempotencyKey,
} from './syncOutbox';
import { saveFormDraft, loadFormDraft, clearFormDraft, countFormDrafts } from './formDraftStore';

describe('offline networkStatus', () => {
  it('detects NetworkError and TypeError', () => {
    expect(isNetworkError(new NetworkError())).toBe(true);
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new ApiError('nope', 400))).toBe(false);
    expect(isNetworkError(new Error('validation failed'))).toBe(false);
  });
});

describe('offline formDraftStore', () => {
  beforeEach(() => {
    __resetOfflineMemoryForTests();
  });

  it('saves loads and clears drafts per user', async () => {
    await saveFormDraft('u1', 'invoice:new', { amount: 10 });
    const loaded = await loadFormDraft<{ amount: number }>('u1', 'invoice:new');
    expect(loaded?.payload.amount).toBe(10);
    expect(await countFormDrafts('u1')).toBe(1);
    expect(await countFormDrafts('u2')).toBe(0);
    await clearFormDraft('u1', 'invoice:new');
    expect(await loadFormDraft('u1', 'invoice:new')).toBeNull();
  });
});

describe('offline syncOutbox', () => {
  beforeEach(() => {
    __resetOfflineMemoryForTests();
  });

  it('enqueues safe saves for auto flush', async () => {
    const item = await enqueueOutbox({
      userId: 'u1',
      opType: 'purchase_request.create',
      opClass: 'safe_save',
      method: 'POST',
      path: '/purchase-requests',
      body: { x: 1 },
      summary: 'PR test',
      idempotencyKey: createIdempotencyKey(),
    });
    expect(item.status).toBe('queued');
    expect(item.requiresUserConfirm).toBe(false);
    const flushable = await listAutoFlushable('u1');
    expect(flushable).toHaveLength(1);
    expect(await listAwaitingConfirm('u1')).toHaveLength(0);
  });

  it('enqueues confirm_required as awaiting_confirm', async () => {
    await enqueueOutbox({
      userId: 'u1',
      opType: 'consumption.confirm',
      opClass: 'confirm_required',
      method: 'POST',
      path: '/consumption-orders/1/confirm',
      summary: 'Confirm CON',
    });
    expect(await listAwaitingConfirm('u1')).toHaveLength(1);
    expect(await listAutoFlushable('u1')).toHaveLength(0);
  });

  it('updates status and removes items', async () => {
    const item = await enqueueOutbox({
      userId: 'u1',
      opType: 'billing.create',
      opClass: 'safe_save',
      method: 'POST',
      path: '/billing',
      summary: 'IPC',
    });
    await updateOutboxItem(item.id, { status: 'failed', lastError: 'boom' });
    const all = await listOutbox('u1');
    expect(all[0]?.status).toBe('failed');
    expect(all[0]?.lastError).toBe('boom');
    await removeOutboxItem(item.id);
    expect(await listOutbox('u1')).toHaveLength(0);
  });
});
