import { describe, expect, it } from 'vitest';
import {
  shouldReuseDesktopPasswordSession,
  shouldRunElectronColdStartReset,
} from './sessionLogout';

describe('desktop session continuity', () => {
  it('reuses the password session on Ctrl+N and on SPA reload in the same window', () => {
    expect(
      shouldReuseDesktopPasswordSession({
        isReuseWindow: true,
        windowSessionAlive: false,
        mustPasswordLogin: true,
      }),
    ).toBe(true);
    expect(
      shouldReuseDesktopPasswordSession({
        isReuseWindow: false,
        windowSessionAlive: true,
        mustPasswordLogin: true,
      }),
    ).toBe(true);
    expect(
      shouldReuseDesktopPasswordSession({
        isReuseWindow: false,
        windowSessionAlive: false,
        keepSessionOnLoad: true,
        mustPasswordLogin: true,
      }),
    ).toBe(true);
  });

  it('does not reuse the session on a fresh Electron launch', () => {
    expect(
      shouldReuseDesktopPasswordSession({
        isReuseWindow: false,
        windowSessionAlive: false,
        mustPasswordLogin: true,
      }),
    ).toBe(false);
  });

  it('runs cold-start logout only on a primary Electron launch', () => {
    expect(
      shouldRunElectronColdStartReset({
        isElectron: true,
        isReuseWindow: false,
        windowSessionAlive: false,
      }),
    ).toBe(true);
    expect(
      shouldRunElectronColdStartReset({
        isElectron: true,
        isReuseWindow: false,
        windowSessionAlive: true,
      }),
    ).toBe(false);
    expect(
      shouldRunElectronColdStartReset({
        isElectron: true,
        isReuseWindow: false,
        windowSessionAlive: false,
        keepSessionOnLoad: true,
      }),
    ).toBe(false);
    expect(
      shouldRunElectronColdStartReset({
        isElectron: false,
        isReuseWindow: false,
        windowSessionAlive: false,
      }),
    ).toBe(false);
  });
});
