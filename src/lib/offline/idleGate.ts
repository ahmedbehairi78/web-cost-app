/**
 * Gate for idle logout: pause when offline or pending sync / dirty form drafts.
 */
import { isLongRunningOperationActive } from '../longRunningOperation';
import { isBrowserOnline } from './networkStatus';
import { countFormDrafts } from './formDraftStore';
import { listOutbox } from './syncOutbox';

let dirtyFormCount = 0;

/** Called by useFormDraftAutosave when a form has unsaved local draft activity. */
export function setOfflineDirtyFormActive(active: boolean): void {
  dirtyFormCount = Math.max(0, dirtyFormCount + (active ? 1 : -1));
}

export function getOfflineDirtyFormCount(): number {
  return dirtyFormCount;
}

export async function shouldPauseIdleLogout(userId: string | null | undefined): Promise<boolean> {
  if (isLongRunningOperationActive()) return true;
  if (!isBrowserOnline()) return true;
  if (dirtyFormCount > 0) return true;
  if (!userId) return false;
  const [drafts, outbox] = await Promise.all([
    countFormDrafts(userId),
    listOutbox(userId),
  ]);
  if (drafts > 0) return true;
  return outbox.some((i) =>
    i.status === 'queued'
    || i.status === 'failed'
    || i.status === 'awaiting_confirm'
    || i.status === 'syncing',
  );
}
