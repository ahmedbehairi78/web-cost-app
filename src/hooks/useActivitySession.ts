import { useEffect, useRef } from 'react';
import type { User } from 'firebase/auth';
import {
  logActivity,
  logClientError,
  maybeLogHeartbeat,
} from '../services/activityLogService';
import { isDesktopSessionReuseWindow } from '../lib/electronShell';

/**
 * Run once per signed-in session: start log, heartbeat, global error taps.
 * No geolocation notice toast — workplace geo is not prompted at login.
 */
export function useActivitySession(user: User | null, opts: { language: string; theme: string }) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (!user) {
      startedRef.current = false;
      return;
    }

    if (!startedRef.current) {
      startedRef.current = true;
      const reuseGui = isDesktopSessionReuseWindow();
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
  }, [user, opts.language, opts.theme]);
}
