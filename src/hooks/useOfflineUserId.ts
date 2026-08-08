import { useEffect, useState } from 'react';
import { getOfflineSessionUserId, OFFLINE_CHANGED_EVENT } from '../lib/offline';
import { isLocalBackend } from '../lib/dataBackend';

/** Stable offline-store user id set by App sync controller (local backend). */
export function useOfflineUserId(): string | null {
  const [id, setId] = useState<string | null>(() =>
    isLocalBackend ? getOfflineSessionUserId() : null,
  );

  useEffect(() => {
    if (!isLocalBackend) {
      setId(null);
      return;
    }
    const refresh = () => setId(getOfflineSessionUserId());
    refresh();
    window.addEventListener(OFFLINE_CHANGED_EVENT, refresh);
    const timer = window.setTimeout(refresh, 50);
    return () => {
      window.removeEventListener(OFFLINE_CHANGED_EVENT, refresh);
      window.clearTimeout(timer);
    };
  }, []);

  return id;
}
