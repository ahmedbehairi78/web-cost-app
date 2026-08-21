/**
 * Cross-document idle activity bridge.
 * Print-preview iframes do not bubble mouse/keyboard events to the parent window,
 * so browser idle tracking would lock while the user works inside the preview.
 * Electron OS-wide idle does not need this; the hook still accepts pings harmlessly.
 */

export const IDLE_ACTIVITY_EVENT = 'webcost:idle-activity';

/** Document / html marker while the idle privacy lock is showing. */
export const IDLE_LOCKED_ATTR = 'data-idle-locked';

export function pingIdleActivity(): void {
  try {
    window.dispatchEvent(new Event(IDLE_ACTIVITY_EVENT));
  } catch {
    /* ignore */
  }
}

export function setIdleLockedDocumentFlag(locked: boolean): void {
  try {
    if (locked) document.documentElement.setAttribute(IDLE_LOCKED_ATTR, '1');
    else document.documentElement.removeAttribute(IDLE_LOCKED_ATTR);
  } catch {
    /* ignore */
  }
}

export function isIdleLockedDocument(): boolean {
  try {
    return document.documentElement.getAttribute(IDLE_LOCKED_ATTR) === '1';
  } catch {
    return false;
  }
}

/** Attach activity listeners on an iframe document; returns cleanup. */
export function installIframeIdleActivityBridge(doc: Document): () => void {
  const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;
  let lastHighFreq = 0;
  const highFreq = new Set(['mousemove', 'scroll', 'wheel']);
  const onEvent = (e: Event) => {
    if (highFreq.has(e.type)) {
      const now = Date.now();
      if (now - lastHighFreq < 1000) return;
      lastHighFreq = now;
    }
    pingIdleActivity();
  };
  for (const ev of events) {
    doc.addEventListener(ev, onEvent, { passive: true });
  }
  return () => {
    for (const ev of events) {
      doc.removeEventListener(ev, onEvent);
    }
  };
}
