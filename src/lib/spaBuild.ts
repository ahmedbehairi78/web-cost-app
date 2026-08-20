import type { AppNotificationItem } from '../types';
import { requestApplySpaUpdate } from './electronShell';
import { markDesktopWindowSessionAlive } from './sessionLogout';

export const SPA_UPDATE_NOTIFICATION_TYPE = 'spa_update';
export const SPA_UPDATE_AVAILABLE_EVENT = 'web-cost:spa-update-available';
export const SPA_BUILD_JSON_PATH = '/spa-build.json';

export type SpaBuildManifest = {
  id: string;
  builtAt?: string;
};

export function localSpaBuildId(): string {
  return String(import.meta.env.VITE_SPA_BUILD_ID || '').trim();
}

export function parseSpaBuildManifest(raw: unknown): SpaBuildManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String((raw as { id?: unknown }).id || '').trim();
  if (!id) return null;
  const builtAt = String((raw as { builtAt?: unknown }).builtAt || '').trim();
  return builtAt ? { id, builtAt } : { id };
}

export function spaBuildNeedsUpdate(localId: string, remoteId: string): boolean {
  const local = localId.trim();
  const remote = remoteId.trim();
  if (!local || !remote) return false;
  return local !== remote;
}

export function isSpaUpdateNotificationType(type: string | undefined): boolean {
  return type === SPA_UPDATE_NOTIFICATION_TYPE;
}

export function buildSpaUpdateNotificationItem(now = new Date()): AppNotificationItem {
  return {
    key: SPA_UPDATE_NOTIFICATION_TYPE,
    type: SPA_UPDATE_NOTIFICATION_TYPE,
    priority: 'urgent',
    titleAr: 'يتوفر تحديث جديد — حدّث الآن أو لاحقاً (العمل مستمر حتى تختار الآن)',
    titleEn: 'A new app update is available — update now or later (you can keep working until you choose now)',
    moduleId: SPA_UPDATE_NOTIFICATION_TYPE,
    createdAt: now.toISOString(),
    read: false,
  };
}

let available = false;
const listeners = new Set<() => void>();

export function isSpaUpdateAvailable(): boolean {
  return available;
}

export function markSpaUpdateAvailable(): void {
  if (available) return;
  available = true;
  for (const fn of listeners) fn();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SPA_UPDATE_AVAILABLE_EVENT));
  }
}

export function subscribeSpaUpdateAvailable(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export async function fetchRemoteSpaBuild(fetcher: typeof fetch = fetch): Promise<SpaBuildManifest | null> {
  try {
    const res = await fetcher(`${SPA_BUILD_JSON_PATH}?t=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    return parseSpaBuildManifest(await res.json());
  } catch {
    return null;
  }
}

export async function checkHostedSpaUpdate(): Promise<boolean> {
  const local = localSpaBuildId();
  if (!local) return available;
  const remote = await fetchRemoteSpaBuild();
  if (remote && spaBuildNeedsUpdate(local, remote.id)) {
    markSpaUpdateAvailable();
    return true;
  }
  return available;
}

let watcherStarted = false;

/** Poll Railway-hosted spa-build.json. No-op in Vite dev. */
export function startSpaUpdateWatcher(intervalMs = 60_000): () => void {
  if (typeof window === 'undefined' || import.meta.env.DEV || watcherStarted) {
    return () => undefined;
  }
  watcherStarted = true;
  void checkHostedSpaUpdate();
  const timer = window.setInterval(() => {
    void checkHostedSpaUpdate();
  }, intervalMs);
  const onFocus = () => {
    void checkHostedSpaUpdate();
  };
  window.addEventListener('focus', onFocus);
  return () => {
    watcherStarted = false;
    window.clearInterval(timer);
    window.removeEventListener('focus', onFocus);
  };
}

let applying = false;

function reloadHostedSpaBypassingIndexCache(): void {
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('spa', String(Date.now()));
    window.location.replace(u.toString());
  } catch {
    window.location.reload();
  }
}

/** Reload the hosted SPA (clear Electron HTTP cache). Never quits and never signs the user out. */
export async function applyHostedSpaUpdate(): Promise<void> {
  if (applying) return;
  applying = true;
  markDesktopWindowSessionAlive();
  try {
    if (await requestApplySpaUpdate()) return;
    reloadHostedSpaBypassingIndexCache();
  } catch {
    applying = false;
    reloadHostedSpaBypassingIndexCache();
  }
}
