import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { isLocalBackend } from '../../lib/dataBackend';
import {
  OFFLINE_CHANGED_EVENT,
  OFFLINE_OPEN_PENDING_EVENT,
  listAwaitingConfirm,
  listOutbox,
  confirmAndFlushOutboxItem,
  discardOutboxItem,
  flushSafeOutbox,
  type SyncOutboxItem,
} from '../../lib/offline';
import toast from 'react-hot-toast';

interface PendingSyncPanelProps {
  userId: string | null | undefined;
  open: boolean;
  onClose: () => void;
}

export function PendingSyncPanel({ userId, open, onClose }: PendingSyncPanelProps) {
  const { t } = useLanguage();
  const [items, setItems] = useState<SyncOutboxItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    const awaiting = await listAwaitingConfirm(userId);
    const failed = (await listOutbox(userId)).filter((i) => i.status === 'failed');
    setItems([...awaiting, ...failed]);
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const onChanged = () => {
      void refresh();
    };
    window.addEventListener(OFFLINE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(OFFLINE_CHANGED_EVENT, onChanged);
  }, [open, refresh]);

  if (!isLocalBackend || !open) return null;

  const confirmOne = async (id: string) => {
    setBusyId(id);
    try {
      await confirmAndFlushOutboxItem(id);
      toast.success(t('offline_sync_success'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('offline_sync_failed'));
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const discardOne = async (id: string) => {
    setBusyId(id);
    try {
      await discardOutboxItem(id);
      toast.success(t('offline_discarded'));
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const retryFailedSafe = async () => {
    if (!userId) return;
    setBusyId('__flush__');
    try {
      const r = await flushSafeOutbox(userId);
      if (r.flushed > 0) toast.success(t('offline_sync_success'));
      if (r.failed > 0) toast.error(t('offline_sync_failed'));
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" role="dialog">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('offline_pending_title')}
          </h2>
          <button type="button" className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800" onClick={onClose} aria-label="close">
            <X size={16} />
          </button>
        </div>
        <p className="px-4 pt-2 text-xs text-gray-600 dark:text-gray-400">{t('offline_pending_hint')}</p>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {items.length === 0 ? (
            <p className="text-sm text-gray-500">{t('offline_pending_empty')}</p>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                >
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.summary}</div>
                  <div className="mt-0.5 text-[11px] text-gray-500">
                    {item.opType} · {item.status}
                    {item.lastError ? ` · ${item.lastError}` : ''}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(item.status === 'awaiting_confirm' || item.status === 'failed') && (
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                        onClick={() => void confirmOne(item.id)}
                      >
                        {t('offline_confirm_send')}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      className="rounded border border-gray-300 px-2.5 py-1 text-xs dark:border-gray-600 disabled:opacity-50"
                      onClick={() => void discardOne(item.id)}
                    >
                      {t('offline_discard')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button
            type="button"
            className="rounded border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-600"
            disabled={busyId === '__flush__'}
            onClick={() => void retryFailedSafe()}
          >
            {t('offline_retry_safe')}
          </button>
          <button
            type="button"
            className="rounded bg-gray-800 px-3 py-1.5 text-xs text-white dark:bg-gray-200 dark:text-gray-900"
            onClick={onClose}
          >
            {t('offline_close')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hook: listen for open-pending event. */
export function usePendingSyncPanelState(userId: string | null | undefined) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!isLocalBackend) return;
    const onOpen = () => setOpen(true);
    window.addEventListener(OFFLINE_OPEN_PENDING_EVENT, onOpen);
    return () => window.removeEventListener(OFFLINE_OPEN_PENDING_EVENT, onOpen);
  }, [userId]);
  return { open, setOpen };
}
