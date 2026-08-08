import { useEffect, useRef } from 'react';
import type { User } from 'firebase/auth';
import toast from 'react-hot-toast';
import { useLanguage } from '../context/LanguageContext';
import {
  logActivity,
  logClientError,
  maybeLogHeartbeat,
  requestApproxGeolocation,
} from '../services/activityLogService';
import { isDesktopSessionReuseWindow } from '../lib/electronShell';

const GEO_NOTICE_STORAGE_KEY = 'activity_geo_notice_toast_v1';

/**
 * Run once per signed-in session: start log, optional geo, heartbeat, global error taps.
 */
export function useActivitySession(user: User | null, opts: { language: string; theme: string }) {
  const startedRef = useRef(false);
  const { t } = useLanguage();

  useEffect(() => {
    if (!user) {
      startedRef.current = false;
      return;
    }

    if (!startedRef.current) {
      startedRef.current = true;
      // New GUI secondary window: no geo toast (primary already showed it this app launch).
      const reuseGui = isDesktopSessionReuseWindow();
      if (!reuseGui) {
        try {
          if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(GEO_NOTICE_STORAGE_KEY)) {
            sessionStorage.setItem(GEO_NOTICE_STORAGE_KEY, '1');
            toast(t('activity_geo_notice'), { duration: 2000 });
          }
        } catch {
          toast(t('activity_geo_notice'), { duration: 2000 });
        }
        requestApproxGeolocation();
      }
      void logActivity({
        kind: 'session_start',
        meta: {
          language: opts.language,
          theme: opts.theme,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent?.slice(0, 500) : '',
          desktopReuseWindow: reuseGui || undefined,
        },
      });
    }

    const onVis = () => {
      if (document.visibilityState === 'visible') maybeLogHeartbeat();
    };

    const onErr = (ev: ErrorEvent) => {
      logClientError('global', ev.error ?? new Error(ev.message || 'ErrorEvent'));
    };

    const onRej = (ev: PromiseRejectionEvent) => {
      logClientError('unhandledrejection', ev.reason);
    };

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);

    const hb = window.setInterval(() => maybeLogHeartbeat(), 180_000);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
      window.clearInterval(hb);
    };
  }, [user, opts.language, opts.theme, t]);
}
