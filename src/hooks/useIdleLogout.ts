import { useEffect, useRef } from 'react';
import { IDLE_LOGOUT_MS } from '../lib/sessionLogout';
import { shouldPauseIdleLogout } from '../lib/offline/idleGate';
import { isBrowserOnline, subscribeOnlineStatus } from '../lib/offline/networkStatus';
import { OFFLINE_CHANGED_EVENT } from '../lib/offline/types';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;

/** mousemove / scroll / wheel fire dozens of times per second — throttle timer resets. */
const HIGH_FREQ_EVENTS = new Set<string>(['mousemove', 'scroll', 'wheel']);
export const IDLE_ACTIVITY_THROTTLE_MS = 1000;

/**
 * Signs the user out after `idleMs` with no pointer/keyboard activity.
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
    let cancelled = false;
    let lastHighFreqScheduleAt = 0;

    const clear = () => {
      window.clearTimeout(timerId);
      timerId = 0;
    };

    const fireIfAllowed = async () => {
      if (cancelled) return;
      if (!isBrowserOnline()) {
        schedule();
        return;
      }
      try {
        if (await shouldPauseIdleLogout(userIdRef.current)) {
          schedule();
          return;
        }
      } catch {
        /* ignore gate errors */
      }
      if (!cancelled) onIdleRef.current();
    };

    const schedule = () => {
      clear();
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
      schedule();
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', schedule);
    const unsubOnline = subscribeOnlineStatus(() => schedule());
    const onOfflineChanged = () => schedule();
    window.addEventListener(OFFLINE_CHANGED_EVENT, onOfflineChanged);
    schedule();

    return () => {
      cancelled = true;
      clear();
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity);
      }
      document.removeEventListener('visibilitychange', schedule);
      unsubOnline();
      window.removeEventListener(OFFLINE_CHANGED_EVENT, onOfflineChanged);
    };
  }, [enabled, idleMs]);
}
