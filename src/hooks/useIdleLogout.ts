import { useEffect, useRef } from 'react';
import { IDLE_LOGOUT_MS } from '../lib/sessionLogout';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;

/**
 * Signs the user out after `idleMs` with no pointer/keyboard activity.
 */
export function useIdleLogout(
  enabled: boolean,
  onIdle: () => void,
  idleMs: number = IDLE_LOGOUT_MS,
) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return;

    let timerId = 0;

    const schedule = () => {
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => onIdleRef.current(), idleMs);
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, schedule, { passive: true });
    }
    document.addEventListener('visibilitychange', schedule);
    schedule();

    return () => {
      window.clearTimeout(timerId);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, schedule);
      }
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [enabled, idleMs]);
}
