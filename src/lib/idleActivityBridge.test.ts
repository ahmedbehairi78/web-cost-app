/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IDLE_ACTIVITY_EVENT,
  IDLE_LOCKED_ATTR,
  installIframeIdleActivityBridge,
  isIdleLockedDocument,
  pingIdleActivity,
  setIdleLockedDocumentFlag,
} from './idleActivityBridge';

afterEach(() => {
  setIdleLockedDocumentFlag(false);
  document.body.innerHTML = '';
});

describe('idleActivityBridge', () => {
  it('sets and clears the idle-locked document flag', () => {
    expect(isIdleLockedDocument()).toBe(false);
    setIdleLockedDocumentFlag(true);
    expect(document.documentElement.getAttribute(IDLE_LOCKED_ATTR)).toBe('1');
    expect(isIdleLockedDocument()).toBe(true);
    setIdleLockedDocumentFlag(false);
    expect(isIdleLockedDocument()).toBe(false);
  });

  it('pings idle activity to the parent window', () => {
    const spy = vi.fn();
    window.addEventListener(IDLE_ACTIVITY_EVENT, spy);
    pingIdleActivity();
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener(IDLE_ACTIVITY_EVENT, spy);
  });

  it('bridges iframe document mouse activity', () => {
    const spy = vi.fn();
    window.addEventListener(IDLE_ACTIVITY_EVENT, spy);
    const cleanup = installIframeIdleActivityBridge(document);
    document.dispatchEvent(new Event('mousedown'));
    expect(spy).toHaveBeenCalled();
    cleanup();
    window.removeEventListener(IDLE_ACTIVITY_EVENT, spy);
  });
});
