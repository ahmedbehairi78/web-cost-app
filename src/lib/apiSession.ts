/** Fired when an API call returns 401 while the UI still thinks the user is signed in. */
export const API_UNAUTHORIZED_EVENT = 'web_cost_api_unauthorized';

const AUTH_EXEMPT_PATHS = ['/auth/login', '/auth/session-probe', '/auth/logout'];

/** After replace backup-import the session is destroyed; suppress forced logout until the user reviews the report. */
let suppressUnauthorizedUntil = 0;

export function suppressApiUnauthorizedLogout(ms = 15 * 60_000): void {
  suppressUnauthorizedUntil = Date.now() + Math.max(0, ms);
}

export function clearApiUnauthorizedLogoutSuppress(): void {
  suppressUnauthorizedUntil = 0;
}

export function isApiUnauthorizedLogoutSuppressed(): boolean {
  return Date.now() < suppressUnauthorizedUntil;
}

export function isAuthExemptApiPath(path: string): boolean {
  const normalized = path.split('?')[0] ?? path;
  return AUTH_EXEMPT_PATHS.some((p) => normalized === p || normalized.endsWith(p));
}

export function notifyApiUnauthorized(): void {
  if (typeof window === 'undefined') return;
  if (isApiUnauthorizedLogoutSuppressed()) return;
  window.dispatchEvent(new CustomEvent(API_UNAUTHORIZED_EVENT));
}
