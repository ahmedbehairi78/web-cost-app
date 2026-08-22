import { inMemoryPersistence, setPersistence, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { isLocalBackend } from './dataBackend';
import { authApi } from '../services/local/authApi';
import { logActivity } from '../services/activityLogService';
import {
  isElectronShell,
  isDesktopSessionReuseWindow,
  isDesktopReloadKeepingSession,
  requestAppQuit,
  requestAppRelaunch,
  clearDesktopSessionStorage,
} from './electronShell';
import { setApiAuthIdToken } from './authToken';

export const SESSION_USER_LOCK_KEY = 'web_cost_session_user_email';
/** Password login required — survives reload; set on logout and desktop cold start. */
export const REQUIRE_FRESH_LOGIN_KEY = 'web_cost_require_fresh_login';
/**
 * Survives `reloadIgnoringCache` inside the same BrowserWindow (SPA update / Ctrl+Shift+R).
 * Cleared when the OS window is destroyed — next launch is a real cold start.
 */
export const DESKTOP_WINDOW_SESSION_KEY = 'web_cost_desktop_window_session';
/** Last successful password login email — kept across logout / app restart (password never stored). */
export const LAST_LOGIN_EMAIL_KEY = 'web_cost_last_login_email';
/** Auto lock (privacy screen) after this much idle time. Electron uses OS-wide input. */
export const IDLE_LOGOUT_MS = 3 * 60 * 1000; // 3 minutes

const SESSION_LOCK_CHANNEL = 'web-cost-session-lock';

export function broadcastSessionLock(locked: boolean): void {
  try {
    const ch = new BroadcastChannel(SESSION_LOCK_CHANNEL);
    ch.postMessage(locked ? 'lock' : 'unlock');
    ch.close();
  } catch {
    /* ignore */
  }
}

export function subscribeSessionLock(onChange: (locked: boolean) => void): () => void {
  try {
    const ch = new BroadcastChannel(SESSION_LOCK_CHANNEL);
    ch.onmessage = (event) => {
      if (event.data === 'lock') onChange(true);
      if (event.data === 'unlock') onChange(false);
    };
    return () => ch.close();
  } catch {
    return () => undefined;
  }
}

/** Desktop app always uses password; browser after logout/idle too. */
export function mustPasswordLogin(): boolean {
  return isElectronShell() || isFreshLoginRequired();
}

export function markFreshLoginRequired(): void {
  try {
    localStorage.setItem(REQUIRE_FRESH_LOGIN_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function clearFreshLoginRequired(): void {
  try {
    localStorage.removeItem(REQUIRE_FRESH_LOGIN_KEY);
  } catch {
    /* ignore */
  }
}

export function isFreshLoginRequired(): boolean {
  try {
    return localStorage.getItem(REQUIRE_FRESH_LOGIN_KEY) === '1';
  } catch {
    return false;
  }
}

export function readLastLoginEmail(): string {
  try {
    return localStorage.getItem(LAST_LOGIN_EMAIL_KEY)?.trim().toLowerCase() ?? '';
  } catch {
    return '';
  }
}

export function writeLastLoginEmail(email: string): void {
  const clean = email.trim().toLowerCase();
  if (!clean) return;
  try {
    localStorage.setItem(LAST_LOGIN_EMAIL_KEY, clean);
  } catch {
    /* ignore */
  }
}

export function markDesktopWindowSessionAlive(): void {
  try {
    sessionStorage.setItem(DESKTOP_WINDOW_SESSION_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function clearDesktopWindowSessionAlive(): void {
  try {
    sessionStorage.removeItem(DESKTOP_WINDOW_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function isDesktopWindowSessionAlive(): boolean {
  try {
    return sessionStorage.getItem(DESKTOP_WINDOW_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

/** Keep the Express cookie across SPA reload in this OS window; still require password on a new launch. */
export function shouldReuseDesktopPasswordSession(input: {
  isReuseWindow: boolean;
  windowSessionAlive: boolean;
  keepSessionOnLoad?: boolean;
  mustPasswordLogin: boolean;
}): boolean {
  if (input.isReuseWindow || input.windowSessionAlive || input.keepSessionOnLoad) return true;
  return !input.mustPasswordLogin;
}

/** True only for the first load of a primary Electron window after OS launch. */
export function shouldRunElectronColdStartReset(input: {
  isElectron: boolean;
  isReuseWindow: boolean;
  windowSessionAlive: boolean;
  keepSessionOnLoad?: boolean;
}): boolean {
  return input.isElectron && !input.isReuseWindow && !input.windowSessionAlive && !input.keepSessionOnLoad;
}

export function currentShouldReuseDesktopPasswordSession(): boolean {
  return shouldReuseDesktopPasswordSession({
    isReuseWindow: isDesktopSessionReuseWindow(),
    windowSessionAlive: isDesktopWindowSessionAlive(),
    keepSessionOnLoad: isDesktopReloadKeepingSession(),
    mustPasswordLogin: mustPasswordLogin(),
  });
}

/** Electron cold start: no remembered Google/API session — password screen every launch. */
export async function performColdStartAuthReset(): Promise<void> {
  if (!isElectronShell()) return;
  markFreshLoginRequired();
  clearDesktopWindowSessionAlive();
  clearDesktopSessionStorage();
  try {
    await setPersistence(auth, inMemoryPersistence);
  } catch {
    /* ignore */
  }
  if (isLocalBackend) {
    try {
      await Promise.race([
        authApi.logout(),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 800);
        }),
      ]);
    } catch {
      /* ignore */
    }
  }
  setApiAuthIdToken(null);
  try {
    await signOut(auth);
  } catch {
    /* ignore */
  }
}

export function readSessionUserLock(): string | null {
  try {
    return sessionStorage.getItem(SESSION_USER_LOCK_KEY);
  } catch {
    return null;
  }
}

export function writeSessionUserLock(email: string): void {
  try {
    sessionStorage.setItem(SESSION_USER_LOCK_KEY, email.trim().toLowerCase());
  } catch {
    /* ignore */
  }
}

/** Sign out API + Firebase; quit Electron shell unless `quitElectron` is false. */
export async function performAppLogout(options?: { quitElectron?: boolean }): Promise<void> {
  markFreshLoginRequired();
  clearDesktopWindowSessionAlive();
  void logActivity({ kind: 'logout' });
  try {
    sessionStorage.removeItem('activity_session_id');
    sessionStorage.removeItem(SESSION_USER_LOCK_KEY);
    sessionStorage.removeItem('web_cost_desktop_notified_keys');
  } catch {
    /* ignore */
  }
  if (isLocalBackend) {
    try {
      await authApi.logout();
    } catch {
      /* ignore */
    }
  }
  setApiAuthIdToken(null);
  try {
    await signOut(auth);
  } catch {
    /* password-only sessions may have no Firebase user */
  }
  if (isElectronShell() && options?.quitElectron !== false) {
    requestAppQuit();
  }
}

/**
 * After factory reset: sign out without a sudden quit, then reopen on the login screen.
 * Electron prefers a full relaunch; older shells / the browser reload the same window.
 */
export async function performFactoryResetReentry(): Promise<void> {
  await performAppLogout({ quitElectron: false });
  await clearDesktopSessionStorage();
  if (isElectronShell() && (await requestAppRelaunch())) return;
  window.location.reload();
}
