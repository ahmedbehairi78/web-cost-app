import { idbDelete, idbGet, idbGetAllByUserId, idbPut } from './idb';
import type { FormDraftRecord } from './types';
import { OFFLINE_CHANGED_EVENT } from './types';

function draftId(userId: string, draftKey: string): string {
  return `${userId}::${draftKey}`;
}

function emitChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OFFLINE_CHANGED_EVENT));
}

export async function saveFormDraft(
  userId: string,
  draftKey: string,
  payload: unknown,
): Promise<void> {
  if (!userId || !draftKey) return;
  const record: FormDraftRecord & { id: string } = {
    id: draftId(userId, draftKey),
    userId,
    draftKey,
    payload,
    updatedAt: new Date().toISOString(),
  };
  await idbPut('form_drafts', record);
  emitChanged();
}

export async function loadFormDraft<T = unknown>(
  userId: string,
  draftKey: string,
): Promise<FormDraftRecord & { payload: T } | null> {
  if (!userId || !draftKey) return null;
  const row = await idbGet<FormDraftRecord & { id: string }>('form_drafts', draftId(userId, draftKey));
  if (!row) return null;
  return row as FormDraftRecord & { payload: T };
}

export async function clearFormDraft(userId: string, draftKey: string): Promise<void> {
  if (!userId || !draftKey) return;
  await idbDelete('form_drafts', draftId(userId, draftKey));
  emitChanged();
}

export async function listFormDrafts(userId: string): Promise<FormDraftRecord[]> {
  if (!userId) return [];
  const rows = await idbGetAllByUserId<FormDraftRecord & { id: string }>('form_drafts', userId);
  return rows.map(({ id: _id, ...rest }) => rest);
}

export async function countFormDrafts(userId: string): Promise<number> {
  return (await listFormDrafts(userId)).length;
}
