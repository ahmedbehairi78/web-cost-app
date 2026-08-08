/** Cloud legacy uses Firestore; full-stack deploy (Railway/Electron prod) uses Postgres via `/api`. */
function resolveDataBackend(): 'firebase' | 'local' {
  const configured = String(import.meta.env.VITE_DATA_BACKEND ?? '').trim().toLowerCase();
  if (configured === 'local') return 'local';
  if (configured === 'firebase') return 'firebase';
  const apiBase = String(import.meta.env.VITE_API_BASE_URL ?? '').trim();
  if (import.meta.env.PROD && (apiBase === '/api' || apiBase.endsWith('/api'))) {
    return 'local';
  }
  return 'firebase';
}

export const DATA_BACKEND = resolveDataBackend();
export const isLocalBackend = DATA_BACKEND === 'local';
