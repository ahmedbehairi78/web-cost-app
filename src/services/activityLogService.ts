/**
 * Client-side activity / audit logging for the web app (Firestore).
 * Used for troubleshooting (who / when / which module) and coarse workplace context.
 */

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { isLocalBackend } from '../lib/dataBackend';

export type ActivityKind =
  | 'session_start'
  | 'heartbeat'
  | 'module_open'
  | 'module_focus'
  | 'module_close'
  | 'shell_close_all'
  | 'shell_language_switch'
  | 'logout'
  | 'error_boundary'
  | 'error_global'
  | 'error_unhandled_rejection';

export interface WorkplaceContextSnapshot {
  timeZone: string;
  locale: string;
  languages: string[];
  screen?: { w: number; h: number };
  viewport?: { w: number; h: number };
  connection?: string;
  referrer: string;
  path: string;
  geo: {
    status: 'pending' | 'ok' | 'denied' | 'timeout' | 'unsupported';
    lat?: number;
    lng?: number;
    accuracyM?: number;
  };
}

type GeoInternal = WorkplaceContextSnapshot['geo'];

let geoCache: GeoInternal = { status: 'pending' };
let geoRequested = false;

/**
 * Fire once per tab session. Does **not** call the Geolocation API unless the browser
 * permission state is already `granted`, so the user is not prompted on first visit.
 */
export function requestApproxGeolocation(): void {
  void requestApproxGeolocationAsync();
}

async function requestApproxGeolocationAsync(): Promise<void> {
  if (geoRequested) return;
  if (typeof navigator === 'undefined') return;
  if (!navigator.geolocation) {
    geoCache = { status: 'unsupported' };
    geoRequested = true;
    return;
  }
  geoRequested = true;

  if (typeof navigator.permissions?.query === 'function') {
    try {
      const r = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      if (r.state === 'denied') {
        geoCache = { status: 'denied' };
        return;
      }
      if (r.state !== 'granted') {
        geoCache = { status: 'pending' };
        return;
      }
    } catch {
      geoCache = { status: 'pending' };
      return;
    }
  } else {
    geoCache = { status: 'pending' };
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      geoCache = {
        status: 'ok',
        lat: Math.round(pos.coords.latitude * 100) / 100,
        lng: Math.round(pos.coords.longitude * 100) / 100,
        accuracyM: pos.coords.accuracy ? Math.round(pos.coords.accuracy) : undefined,
      };
    },
    () => {
      geoCache = { status: 'denied' };
    },
    { timeout: 10_000, maximumAge: 600_000, enableHighAccuracy: false },
  );
}

export function getWorkplaceContext(): WorkplaceContextSnapshot {
  let tz = '';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    tz = '';
  }

  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const conn =
    nav &&
    'connection' in nav &&
    nav.connection &&
    typeof (nav.connection as { effectiveType?: string }).effectiveType === 'string'
      ? (nav.connection as { effectiveType: string }).effectiveType
      : '';

  return {
    timeZone: tz,
    locale: nav?.language || '',
    languages: nav?.languages ? [...nav.languages].slice(0, 6) : [],
    screen:
      typeof screen !== 'undefined'
        ? { w: screen.width, h: screen.height }
        : undefined,
    viewport:
      typeof window !== 'undefined'
        ? { w: window.innerWidth, h: window.innerHeight }
        : undefined,
    connection: conn,
    referrer:
      typeof document !== 'undefined' && document.referrer
        ? document.referrer.slice(0, 400)
        : '',
    path: typeof window !== 'undefined' ? window.location.pathname.slice(0, 200) : '',
    geo: { ...geoCache },
  };
}

function sessionId(): string {
  try {
    const key = 'activity_session_id';
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return `fallback-${Date.now()}`;
  }
}

let lastHeartbeatAt = 0;
const HEARTBEAT_MIN_MS = 120_000;

/** Periodic presence ping while the tab is visible (best-effort “time on app”). */
export function maybeLogHeartbeat(): void {
  const now = Date.now();
  if (now - lastHeartbeatAt < HEARTBEAT_MIN_MS) return;
  lastHeartbeatAt = now;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  void logActivity({ kind: 'heartbeat', meta: { visible: true } });
}

/**
 * Append-only audit row. Silently fails (never blocks UX).
 */
export async function logActivity(params: {
  kind: ActivityKind;
  moduleId?: string | null;
  detail?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  if (isLocalBackend) return;

  const user = auth.currentUser;
  if (!user) return;

  const detail =
    params.detail !== undefined ? String(params.detail).slice(0, 4000) : null;

  try {
    await addDoc(collection(db, 'activity_logs'), {
      uid: user.uid,
      email: user.email || '',
      sessionId: sessionId(),
      kind: params.kind,
      moduleId: params.moduleId ?? null,
      detail,
      meta: params.meta ?? null,
      context: getWorkplaceContext(),
      appBuild:
        typeof import.meta.env.VITE_APP_BUILD !== 'undefined'
          ? String(import.meta.env.VITE_APP_BUILD).slice(0, 64)
          : import.meta.env.MODE,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn('[activity_logs]', e);
  }
}

export function logClientError(
  source: 'boundary' | 'global' | 'unhandledrejection',
  err: unknown,
  extraMeta?: Record<string, unknown>,
): void {
  const msg =
    err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);
  const stack = err instanceof Error ? err.stack?.slice(0, 6000) : undefined;
  const kind: ActivityKind =
    source === 'boundary'
      ? 'error_boundary'
      : source === 'unhandledrejection'
        ? 'error_unhandled_rejection'
        : 'error_global';
  void logActivity({
    kind,
    detail: msg.slice(0, 2000),
    meta:
      stack || extraMeta
        ? { ...(stack ? { stack } : {}), ...(extraMeta || {}) }
        : undefined,
  });
}
