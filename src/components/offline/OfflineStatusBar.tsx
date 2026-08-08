import { useCallback, useEffect, useState } from 'react';
import { Wifi, WifiOff, CloudUpload, AlertCircle } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { isLocalBackend } from '../../lib/dataBackend';
import {
  OFFLINE_CHANGED_EVENT,
  countOutboxByStatus,
  countFormDrafts,
  isBrowserOnline,
  subscribeOnlineStatus,
  requestOpenPendingSyncPanel,
  isOfflineFlushPausedForAuth,
} from '../../lib/offline';

interface OfflineStatusBarProps {
  userId: string | null | undefined;
}

export function OfflineStatusBar({ userId }: OfflineStatusBarProps) {
  const { t, language } = useLanguage();
  const [online, setOnline] = useState(isBrowserOnline());
  const [queued, setQueued] = useState(0);
  const [awaiting, setAwaiting] = useState(0);
  const [failed, setFailed] = useState(0);
  const [drafts, setDrafts] = useState(0);
  const [authPaused, setAuthPaused] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setQueued(0);
      setAwaiting(0);
      setFailed(0);
      setDrafts(0);
      return;
    }
    const [q, a, f, d] = await Promise.all([
      countOutboxByStatus(userId, ['queued', 'syncing']),
      countOutboxByStatus(userId, ['awaiting_confirm']),
      countOutboxByStatus(userId, ['failed']),
      countFormDrafts(userId),
    ]);
    setQueued(q);
    setAwaiting(a);
    setFailed(f);
    setDrafts(d);
    setAuthPaused(isOfflineFlushPausedForAuth());
  }, [userId]);

  useEffect(() => {
    if (!isLocalBackend) return;
    setOnline(isBrowserOnline());
    const unsub = subscribeOnlineStatus(setOnline);
    void refresh();
    const onChanged = () => {
      void refresh();
    };
    window.addEventListener(OFFLINE_CHANGED_EVENT, onChanged);
    return () => {
      unsub();
      window.removeEventListener(OFFLINE_CHANGED_EVENT, onChanged);
    };
  }, [refresh]);

  if (!isLocalBackend || !userId) return null;

  const showBar = !online || queued > 0 || awaiting > 0 || failed > 0 || authPaused;
  if (!showBar) return null;

  const ar = language === 'ar';

  return (
    <div
      className={`pointer-events-auto fixed bottom-3 z-[80] flex max-w-[min(96vw,28rem)] flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg ${
        online
          ? 'border-amber-500/40 bg-amber-50 text-amber-950 dark:bg-amber-950/90 dark:text-amber-50'
          : 'border-red-500/40 bg-red-50 text-red-950 dark:bg-red-950/90 dark:text-red-50'
      } ${ar ? 'left-3' : 'right-3'}`}
      role="status"
    >
      {online ? <Wifi size={14} /> : <WifiOff size={14} />}
      <span>
        {!online
          ? t('offline_status_offline')
          : authPaused
            ? t('offline_status_auth_paused')
            : queued > 0
              ? t('offline_status_syncing')
              : awaiting > 0
                ? t('offline_status_pending_confirm')
                : failed > 0
                  ? t('offline_status_failed')
                  : t('offline_status_online')}
      </span>
      {(queued > 0 || drafts > 0) && (
        <span className="inline-flex items-center gap-1 opacity-80">
          <CloudUpload size={12} />
          {queued > 0 ? queued : drafts}
        </span>
      )}
      {failed > 0 && (
        <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-300">
          <AlertCircle size={12} />
          {failed}
        </span>
      )}
      {awaiting > 0 && (
        <button
          type="button"
          className="rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700"
          onClick={() => requestOpenPendingSyncPanel()}
        >
          {t('offline_review_pending')} ({awaiting})
        </button>
      )}
    </div>
  );
}
