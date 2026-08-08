import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup } from 'firebase/auth';
import { CheckCircle2, Loader2, MessageCircle, XCircle } from 'lucide-react';
import { auth, googleProvider } from '../../firebase';
import { useLanguage } from '../../context/LanguageContext';
import { Login } from '../../components/Login';
import { authApi } from '../../services/local/authApi';
import { notificationsApi } from '../../services/local/modulesApi';
import { setApiAuthIdToken } from '../../lib/authToken';
import { isLocalBackend } from '../../lib/dataBackend';
import type { AppNotificationItem, NotificationItemDetail } from '../../types';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

function useMobilePath(): { view: 'inbox' | 'approve'; token: string | null } {
  return useMemo(() => {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    const params = new URLSearchParams(window.location.search);
    if (path === '/m/approve' || path.startsWith('/m/approve/')) {
      return { view: 'approve' as const, token: params.get('t') };
    }
    return { view: 'inbox' as const, token: params.get('t') };
  }, []);
}

function summaryRows(
  summary: Record<string, string>,
  labels: Record<string, string>,
): Array<{ label: string; value: string }> {
  const order = ['transferNumber', 'extractNumber', 'fromProject', 'toProject', 'date', 'status'];
  return order
    .filter((k) => summary[k])
    .map((k) => ({ label: labels[k] ?? k, value: summary[k] }));
}

export function MobileApprovalApp() {
  const { t, language, dir, theme } = useLanguage();
  const { view, token } = useMobilePath();
  const [authReady, setAuthReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<NotificationItemDetail | null>(null);
  const [inbox, setInbox] = useState<AppNotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user && isLocalBackend) {
        try {
          const idToken = await user.getIdToken();
          setApiAuthIdToken(idToken);
          await authApi.firebaseSession(idToken);
        } catch {
          setApiAuthIdToken(null);
        }
      } else {
        setApiAuthIdToken(null);
      }
      setAuthed(!!user);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!token || !authReady) return;
    let cancelled = false;
    void notificationsApi.verifyLink(token).then((r) => {
      if (!cancelled && r.valid && r.notificationKey) setResolvedKey(r.notificationKey);
    });
    return () => { cancelled = true; };
  }, [token, authReady]);

  const activeKey = useMemo(() => {
    if (view === 'approve' && resolvedKey) return resolvedKey;
    const params = new URLSearchParams(window.location.search);
    return params.get('key');
  }, [view, resolvedKey]);

  const loadDetail = useCallback(async (key: string) => {
    setLoading(true);
    try {
      const item = await notificationsApi.item(key);
      setDetail(item);
    } catch {
      setDetail(null);
      toast.error(t('mobile_approve_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    try {
      const data = await notificationsApi.feed();
      const actionable = data.items.filter(
        (i) => i.type.startsWith('transfer_') || i.type === 'mos_draft',
      );
      setInbox(actionable);
    } catch {
      setInbox([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authed || !authReady) return;
    if (activeKey) {
      void loadDetail(activeKey);
    } else if (view === 'inbox') {
      void loadInbox();
    }
  }, [authed, authReady, activeKey, view, loadDetail, loadInbox]);

  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch {
      toast.error(t('mobile_approve_login_failed'));
    }
  };

  const runAction = async (action: 'approve' | 'reject') => {
    if (!detail) return;
    setActing(true);
    try {
      await notificationsApi.action(detail.key, action);
      setDone(true);
      toast.success(t('mobile_approve_success'));
    } catch {
      toast.error(t('mobile_approve_action_failed'));
    } finally {
      setActing(false);
    }
  };

  const shellCls = cn(
    'mobile-approval-shell min-h-screen flex flex-col',
    theme === 'dark' ? 'bg-[#0f1115] text-gray-100' : 'bg-gray-50 text-gray-900',
  );

  const cardCls = cn(
    'rounded-2xl border p-5 shadow-lg',
    theme === 'dark' ? 'bg-[#1a1d23] border-gray-700' : 'bg-white border-gray-200',
  );

  const summaryLabels: Record<string, string> = {
    transferNumber: t('mobile_summary_transfer'),
    extractNumber: t('mobile_summary_extract'),
    fromProject: t('mobile_summary_from'),
    toProject: t('mobile_summary_to'),
    date: t('mobile_summary_date'),
    status: t('mobile_summary_status'),
  };

  if (!authReady) {
    return (
      <div className={cn(shellCls, 'items-center justify-center')} dir={dir}>
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  if (!authed) {
    return (
      <div className={shellCls} dir={dir}>
        <div className="p-4 flex-1 flex flex-col items-center justify-center gap-4 max-w-md mx-auto w-full">
          <MessageCircle size={40} className="text-green-600" />
          <h1 className="text-lg font-bold text-center">{t('mobile_approve_login_title')}</h1>
          <p className="text-sm text-center opacity-70">{t('mobile_approve_login_hint')}</p>
          {isLocalBackend ? (
            <Login onPasswordLogin={() => undefined} />
          ) : (
            <button
              type="button"
              onClick={() => void handleGoogleLogin()}
              className="w-full py-3 rounded-xl bg-blue-600 text-white font-bold"
            >
              {t('mobile_approve_google')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={shellCls} dir={dir}>
      <header className={cn(
        'px-4 py-3 border-b flex items-center gap-2',
        theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white',
      )}
      >
        <MessageCircle size={20} className="text-green-600" />
        <span className="font-bold text-sm">{t('mobile_approve_header')}</span>
      </header>

      <main className="flex-1 p-4 max-w-md mx-auto w-full">
        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-blue-500" size={28} />
          </div>
        )}

        {!loading && view === 'inbox' && !activeKey && (
          <div className="space-y-3">
            <h2 className="font-bold">{t('mobile_inbox_title')}</h2>
            {inbox.length === 0 ? (
              <p className="text-sm opacity-60">{t('notifications_empty')}</p>
            ) : (
              inbox.map((item) => (
                <a
                  key={item.key}
                  href={`/m/approve?key=${encodeURIComponent(item.key)}`}
                  className={cn(cardCls, 'block hover:border-blue-400 transition-colors')}
                >
                  <p className="text-sm font-medium">
                    {language === 'ar' ? item.titleAr : item.titleEn}
                  </p>
                </a>
              ))
            )}
          </div>
        )}

        {!loading && activeKey && detail && (
          <div className={cardCls}>
            <h2 className="font-bold text-base mb-3">
              {language === 'ar' ? detail.titleAr : detail.titleEn}
            </h2>
            <dl className="space-y-2 text-sm mb-6">
              {summaryRows(detail.summary, summaryLabels).map((row) => (
                <div key={row.label} className="flex justify-between gap-3">
                  <dt className="opacity-60 shrink-0">{row.label}</dt>
                  <dd className="font-medium text-end">{row.value}</dd>
                </div>
              ))}
            </dl>

            {done ? (
              <div className="flex items-center gap-2 text-green-600 font-bold justify-center py-4">
                <CheckCircle2 size={20} />
                {t('mobile_approve_done')}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {detail.allowedActions.includes('approve') && (
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => void runAction('approve')}
                    className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2"
                  >
                    {acting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                    {t('mobile_approve_btn')}
                  </button>
                )}
                {detail.allowedActions.includes('reject') && (
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => void runAction('reject')}
                    className="w-full py-3 rounded-xl border border-red-500 text-red-500 hover:bg-red-50 disabled:opacity-50 font-bold flex items-center justify-center gap-2"
                  >
                    <XCircle size={18} />
                    {t('mobile_reject_btn')}
                  </button>
                )}
                {detail.allowedActions.length === 0 && (
                  <p className="text-sm text-center opacity-60">{t('mobile_approve_no_actions')}</p>
                )}
              </div>
            )}
          </div>
        )}

        {!loading && activeKey && !detail && (
          <p className="text-sm text-center opacity-60 py-8">{t('mobile_approve_not_found')}</p>
        )}
      </main>

      <footer className="p-4 text-center">
        <a href="/" className="text-xs text-blue-500 underline">{t('mobile_open_full_app')}</a>
      </footer>
    </div>
  );
}
