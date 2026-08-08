import { NetworkError } from './NetworkError';

export function isBrowserOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

/** Classify fetch / TypeError / NetworkError failures as network (vs HTTP ApiError). */
export function isNetworkError(err: unknown): boolean {
  if (!err) return false;
  // Duck-type ApiError without importing apiClient (avoid circular deps).
  if (typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
    return false;
  }
  if (err instanceof NetworkError) return true;
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes('failed to fetch')
    || lower.includes('networkerror')
    || lower.includes('network request failed')
    || lower.includes('load failed')
    || lower.includes('fetch failed')
    || lower.includes('net::err_')
    || lower.includes('econnrefused')
    || lower.includes('econnreset')
    || lower.includes('enotfound')
  );
}

export function subscribeOnlineStatus(listener: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onOnline = () => listener(true);
  const onOffline = () => listener(false);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
