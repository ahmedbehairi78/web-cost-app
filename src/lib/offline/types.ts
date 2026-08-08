/** Offline sync — shared types (local backend / Railway only). */

export type SyncOpClass = 'safe_save' | 'confirm_required';

export type SyncOpType =
  | 'purchase_request.create'
  | 'purchase_request.update_status'
  | 'billing.create'
  | 'billing.update'
  | 'purchase_tx.create'
  | 'purchase_tx.update'
  | 'custody.create'
  | 'custody.update'
  | 'mos.create'
  | 'bank_movement.create'
  | 'bank_movement.update'
  | 'bank_cheque.create'
  | 'bank_cheque.update'
  | 'purchase_invoice.post'
  | 'purchase_tx.approve'
  | 'billing.approve'
  | 'custody.approve'
  | 'mos.approve'
  | 'consumption.create'
  | 'consumption.confirm'
  | 'return.create'
  | 'return.confirm'
  | 'warehouse_receipt.create'
  | 'warehouse_receipt.submit'
  | 'warehouse_receipt.approve'
  | 'project_transfer.create'
  | 'project_transfer.approve_b'
  | 'project_transfer.approve_projects'
  | 'bank_movement.post'
  | 'bank_cheque.iss'
  | 'bank_cheque.clr'
  | 'gl.create_transaction'
  | 'gl.reverse';

export type OutboxStatus = 'queued' | 'syncing' | 'failed' | 'awaiting_confirm';

export interface FormDraftRecord {
  userId: string;
  draftKey: string;
  payload: unknown;
  updatedAt: string;
}

export interface SyncOutboxItem {
  id: string;
  userId: string;
  opType: SyncOpType;
  opClass: SyncOpClass;
  /** HTTP method + path used when flushing */
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  idempotencyKey: string;
  /** Short Arabic/English-agnostic label for UI */
  summary: string;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  requiresUserConfirm: boolean;
}

export const OFFLINE_CHANGED_EVENT = 'web_cost_offline_changed';
export const OFFLINE_OPEN_PENDING_EVENT = 'web_cost_offline_open_pending';
