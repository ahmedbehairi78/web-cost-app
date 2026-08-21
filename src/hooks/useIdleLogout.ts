import { useEffect, useRef } from 'react';
import { IDLE_LOGOUT_MS } from '../lib/sessionLogout';
import { shouldPauseIdleLogout } from '../lib/offline/idleGate';
import { isBrowserOnline, subscribeOnlineStatus } from '../lib/offline/networkStatus';
import { OFFLINE_CHANGED_EVENT } from '../lib/offline/types';
import { getSystemIdleSeconds, isElectronShell } from '../lib/electronShell';
import { IDLE_ACTIVITY_EVENT } from '../lib/idleActivityBridge';
import { SYSTEM_IDLE_POLL_MS, systemIdleReached } from '../lib/systemIdle';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;

/** mousemove / scroll / wheel fire dozens of times per second — throttle timer resets. */
const HIGH_FREQ_EVENTS = new Set<string>(['mousemove', 'scroll', 'wheel']);
export const IDLE_ACTIVITY_THROTTLE_MS = 1000;

/**
 * Fires after `idleMs` with no activity.
 * Electron: OS-wide idle (`powerMonitor`) so working in another app keeps the session.
 * Browser / older shells: pointer/keyboard activity inside this window only.
 * Pauses while offline or when offline drafts/outbox work is pending.
 */
export function useIdleLogout(
  enabled: boolean,
  onIdle: () => void,
  idleMs: number = IDLE_LOGOUT_MS,
  userId?: string | null,
) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  useEffect(() => {
    if (!enabled) return;

    let timerId = 0;
    let pollId = 0;
    let cancelled = false;
    let fired = false;
    let lastHighFreqScheduleAt = 0;
    let usingWindowActivity = false;

    const clearTimer = () => {
      window.clearTimeout(timerId);
      timerId = 0;
    };

    const fireIfAllowed = async () => {
      if (cancelled || fired) return;
      if (!isBrowserOnline()) {
        if (usingWindowActivity) scheduleWindow();
        return;
      }
      try {
        if (await shouldPauseIdleLogout(userIdRef.current)) {
          if (usingWindowActivity) scheduleWindow();
          return;
        }
      } catch {
        /* ignore gate errors */
      }
      if (cancelled || fired) return;
      fired = true;
      onIdleRef.current();
    };

    const scheduleWindow = () => {
      clearTimer();
      timerId = window.setTimeout(() => {
        void fireIfAllowed();
      }, idleMs);
    };

    const onActivity = (event: Event) => {
      if (HIGH_FREQ_EVENTS.has(event.type)) {
        const now = Date.now();
        if (now - lastHighFreqScheduleAt < IDLE_ACTIVITY_THROTTLE_MS) return;
        lastHighFreqScheduleAt = now;
      }
      scheduleWindow();
    };

    const attachWindowActivity = () => {
      if (usingWindowActivity) return;
      usingWindowActivity = true;
      for (const event of ACTIVITY_EVENTS) {
        window.addEventListener(event, onActivity, { passive: true });
      }
      document.addEventListener('visibilitychange', scheduleWindow);
      scheduleWindow();
    };

    const detachWindowActivity = () => {
      if (!usingWindowActivity) return;
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity);
      }
      document.removeEventListener('visibilitychange', scheduleWindow);
      usingWindowActivity = false;
    };

    const tickSystemIdle = async () => {
      if (cancelled || fired) return;
      const seconds = await getSystemIdleSeconds();
      if (cancelled || fired) return;
      if (seconds == null) {
        window.clearInterval(pollId);
        pollId = 0;
        attachWindowActivity();
        return;
      }
      if (systemIdleReached(seconds, idleMs)) {
        await fireIfAllowed();
      }
    };

    const onBridgeActivity = () => {
      if (usingWindowActivity) scheduleWindow();
    };

    const unsubOnline = subscribeOnlineStatus(() => {
      if (usingWindowActivity) scheduleWindow();
    });
    const onOfflineChanged = () => {
      if (usingWindowActivity) scheduleWindow();
    };
    window.addEventListener(OFFLINE_CHANGED_EVENT, onOfflineChanged);
    window.addEventListener(IDLE_ACTIVITY_EVENT, onBridgeActivity);

    if (isElectronShell()) {
      void tickSystemIdle();
      pollId = window.setInterval(() => {
        void tickSystemIdle();
      }, SYSTEM_IDLE_POLL_MS);
    } else {
      attachWindowActivity();
    }

    return () => {
      cancelled = true;
      clearTimer();
      window.clearInterval(pollId);
      detachWindowActivity();
      unsubOnline();
      window.removeEventListener(OFFLINE_CHANGED_EVENT, onOfflineChanged);
      window.removeEventListener(IDLE_ACTIVITY_EVENT, onBridgeActivity);
    };
  }, [enabled, idleMs]);
}
