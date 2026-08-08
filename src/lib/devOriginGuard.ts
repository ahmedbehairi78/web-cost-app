/**
 * Local dev: session cookies and Firebase Auth are host-specific.
 * Always use http://localhost:3000 (not 127.0.0.1, LAN IP, or machine name).
 * Firebase Google sign-in rejects unauthorized domains (auth/unauthorized-domain).
 */
export function enforceDevLocalhostOrigin(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  const { hostname, port, protocol, pathname, search, hash } = window.location;
  if (hostname === 'localhost') return;
  const p = port ? `:${port}` : '';
  window.location.replace(`${protocol}//localhost${p}${pathname}${search}${hash}`);
}
