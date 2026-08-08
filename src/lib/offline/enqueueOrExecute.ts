import { apiRequest, ApiError } from '../apiClient';
import { isNetworkError, isBrowserOnline } from './networkStatus';
import {
  enqueueOutbox,
  createIdempotencyKey,
  type EnqueueOutboxInput,
} from './syncOutbox';
import type { SyncOpClass, SyncOpType } from './types';

export class NetworkQueuedError extends Error {
  constructor(
    message: string,
    public outboxId: string,
    public requiresUserConfirm: boolean,
  ) {
    super(message);
    this.name = 'NetworkQueuedError';
  }
}

export interface EnqueueOrExecuteOptions {
  userId: string;
  opType: SyncOpType;
  opClass: SyncOpClass;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  summary: string;
  /** Reuse key across retries of the same user intent */
  idempotencyKey?: string;
}

/**
 * Try the API immediately. On network failure, enqueue for later
 * (auto-flush for safe_save, manual confirm for confirm_required).
 */
export async function enqueueOrExecute<T>(opts: EnqueueOrExecuteOptions): Promise<T> {
  const idempotencyKey = opts.idempotencyKey ?? createIdempotencyKey();
  const headers: Record<string, string> = {
    'Idempotency-Key': idempotencyKey,
  };

  const run = () =>
    apiRequest<T>(opts.path, {
      method: opts.method,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      headers,
    });

  if (!isBrowserOnline()) {
    const item = await enqueueOutbox({
      userId: opts.userId,
      opType: opts.opType,
      opClass: opts.opClass,
      method: opts.method,
      path: opts.path,
      body: opts.body,
      summary: opts.summary,
      idempotencyKey,
      requiresUserConfirm: opts.opClass === 'confirm_required',
    });
    throw new NetworkQueuedError(
      opts.opClass === 'confirm_required'
        ? 'Queued for confirmation when online'
        : 'Queued for sync when online',
      item.id,
      item.requiresUserConfirm,
    );
  }

  try {
    return await run();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (!isNetworkError(err)) throw err;
    const item = await enqueueOutbox({
      userId: opts.userId,
      opType: opts.opType,
      opClass: opts.opClass,
      method: opts.method,
      path: opts.path,
      body: opts.body,
      summary: opts.summary,
      idempotencyKey,
      requiresUserConfirm: opts.opClass === 'confirm_required',
    } satisfies EnqueueOutboxInput);
    throw new NetworkQueuedError(
      opts.opClass === 'confirm_required'
        ? 'Queued for confirmation when online'
        : 'Queued for sync when online',
      item.id,
      item.requiresUserConfirm,
    );
  }
}
