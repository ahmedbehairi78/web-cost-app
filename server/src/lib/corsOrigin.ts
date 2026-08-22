/** Vite LAN (`--host=0.0.0.0`) — private ranges only. */
export function isDevAllowedOrigin(origin: string): boolean {
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  if (
    /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(
      origin,
    )
  ) {
    return true;
  }
  return false;
}

export type CorsOriginOptions = {
  nodeEnv: string;
  /** Exact browser origin, e.g. `https://app.example.com`. Empty = unset. */
  corsOrigin: string;
};

/**
 * Cookie-credential CORS allowlist.
 * Production: missing Origin (same-origin / non-browser) OR exact `corsOrigin`.
 * Never treat an empty `corsOrigin` as “allow all”.
 */
export function isAllowedCorsOrigin(origin: string | undefined, opts: CorsOriginOptions): boolean {
  const corsOrigin = opts.corsOrigin.trim();
  if (opts.nodeEnv !== 'production') {
    if (!origin || isDevAllowedOrigin(origin)) return true;
    return corsOrigin.length > 0 && origin === corsOrigin;
  }
  if (!origin) return true;
  return corsOrigin.length > 0 && origin === corsOrigin;
}

export function assertProductionCorsOrigin(corsOrigin: string): void {
  if (!corsOrigin.trim()) {
    throw new Error('CORS_ORIGIN (or RAILWAY_PUBLIC_DOMAIN) must be set in production.');
  }
}
