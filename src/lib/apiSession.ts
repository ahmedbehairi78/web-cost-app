/** Fired when an API call returns 401 while the UI still thinks the user is signed in. */
export const API_UNAUTHORIZED_EVENT = 'web_cost_api_unauthorized';
/** Factory reset finished — App shows the re-login overlay and stops module fetches. */
export const FACTORY_RESET_DONE_EVENT = 'web_cost_factory_reset_done';

const AUTH_EXEMPT_PATHS = ['/auth/login', '/auth/session-probe', '/auth/logout'];

/** After replace backup-import the session is destroyed; suppress forced logout until the user reviews the report. */
let suppressUnauthorizedUntil = 0;
/** After factory reset the Express session is gone — skip further authenticated fetches. */
let authenticatedApiPaused = false;

/** Thrown instead of hitting the network after factory reset (avoids 401 noise). */
export class ApiPausedError extends Error {
  readonly paused = true as const;
  constructor() {
    super('api_paused');
    this.name = 'ApiPausedError';
  }
}

export function suppressApiUnauthorizedLogout(ms = 15 * 60_000): void {
  suppressUnauthorizedUntil = Date.now() + Math.max(0, ms);
}

export function clearApiUnauthorizedLogoutSuppress(): void {
  suppressUnauthorizedUntil = 0;
}

export function isApiUnauthorizedLogoutSuppressed(): boolean {
  return Date.now() < suppressUnauthorizedUntil;
}

export function pauseAuthenticatedApi(): void {
  authenticatedApiPaused = true;
}

export function isAuthenticatedApiPaused(): boolean {
  return authenticatedApiPaused;
}

export function notifyFactoryResetDone(keptEmails: string[]): void {
  pauseAuthenticatedApi();
  suppressApiUnauthorizedLogout();
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(FACTORY_RESET_DONE_EVENT, { detail: { keptEmails } }),
  );
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
