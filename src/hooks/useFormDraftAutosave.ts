import { useEffect, useRef, useState } from 'react';
import { clearFormDraft, loadFormDraft, saveFormDraft } from '../lib/offline/formDraftStore';
import { setOfflineDirtyFormActive } from '../lib/offline/idleGate';
import { isLocalBackend } from '../lib/dataBackend';

export interface UseFormDraftAutosaveOptions<T> {
  userId: string | null | undefined;
  draftKey: string;
  value: T;
  enabled: boolean;
  debounceMs?: number;
  /** Skip persist when value is "empty" */
  isEmpty?: (value: T) => boolean;
  /** Called once when a stored draft is found (caller decides restore UI). */
  onDraftAvailable?: (draft: T, updatedAt: string) => void;
}

/**
 * Debounced local draft persistence for financial forms (local backend only).
 */
export function useFormDraftAutosave<T>(opts: UseFormDraftAutosaveOptions<T>): {
  clearDraft: () => Promise<void>;
  restorePrompt: { payload: T; updatedAt: string } | null;
  acceptRestore: () => void;
  dismissRestore: () => Promise<void>;
} {
  const {
    userId,
    draftKey,
    value,
    enabled,
    debounceMs = 800,
    isEmpty,
    onDraftAvailable,
  } = opts;

  const [restorePrompt, setRestorePrompt] = useState<{ payload: T; updatedAt: string } | null>(null);
  const hydratedRef = useRef(false);
  const dirtyActiveRef = useRef(false);
  const onDraftAvailableRef = useRef(onDraftAvailable);
  onDraftAvailableRef.current = onDraftAvailable;

  const active = Boolean(isLocalBackend && enabled && userId && draftKey);

  useEffect(() => {
    if (!active || !userId) {
      hydratedRef.current = false;
      return;
    }
    let cancelled = false;
    hydratedRef.current = false;
    void (async () => {
      const existing = await loadFormDraft<T>(userId, draftKey);
      if (cancelled) return;
      if (existing?.payload != null) {
        const empty = isEmpty?.(existing.payload as T) ?? false;
        if (!empty) {
          setRestorePrompt({ payload: existing.payload as T, updatedAt: existing.updatedAt });
          onDraftAvailableRef.current?.(existing.payload as T, existing.updatedAt);
        }
      }
      hydratedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per key open
  }, [active, userId, draftKey]);

  useEffect(() => {
    if (!active || !userId || !hydratedRef.current) return;
    if (isEmpty?.(value)) return;

    if (!dirtyActiveRef.current) {
      dirtyActiveRef.current = true;
      setOfflineDirtyFormActive(true);
    }

    const timer = window.setTimeout(() => {
      void saveFormDraft(userId, draftKey, value);
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [active, userId, draftKey, value, debounceMs, isEmpty]);

  useEffect(() => {
    return () => {
      if (dirtyActiveRef.current) {
        dirtyActiveRef.current = false;
        setOfflineDirtyFormActive(false);
      }
    };
  }, []);

  const clearDraft = async () => {
    if (!userId || !draftKey) return;
    await clearFormDraft(userId, draftKey);
    setRestorePrompt(null);
    if (dirtyActiveRef.current) {
      dirtyActiveRef.current = false;
      setOfflineDirtyFormActive(false);
    }
  };

  const acceptRestore = () => {
    setRestorePrompt(null);
  };

  const dismissRestore = async () => {
    await clearDraft();
  };

  return { clearDraft, restorePrompt, acceptRestore, dismissRestore };
}
