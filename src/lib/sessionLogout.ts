import { inMemoryPersistence, setPersistence, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { isLocalBackend } from './dataBackend';
import { authApi } from '../services/local/authApi';
import { logActivity } from '../services/activityLogService';
import { isElectronShell, requestAppQuit, clearDesktopSessionStorage } from './electronShell';
import { setApiAuthIdToken } from './authToken';

export const SESSION_USER_LOCK_KEY = 'web_cost_session_user_email';
/** Password login required — survives reload; set on logout and desktop cold start. */
export const REQUIRE_FRESH_LOGIN_KEY = 'web_cost_require_fresh_login';
/** Last successful password login email — kept across logout / app restart (password never stored). */
export const LAST_LOGIN_EMAIL_KEY = 'web_cost_last_login_email';
export const IDLE_LOGOUT_MS = 3 * 60 * 1000;

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

/** Electron cold start: no remembered Google/API session — password screen every launch. */
export async function performColdStartAuthReset(): Promise<void> {
  if (!isElectronShell()) return;
  markFreshLoginRequired();
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
          setTimeout(resolve, 3000);
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

/** Sign out API + Firebase; quit Electron shell (no in-app login screen). */
export async function performAppLogout(): Promise<void> {
  markFreshLoginRequired();
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
  if (isElectronShell()) {
    requestAppQuit();
  }
}
