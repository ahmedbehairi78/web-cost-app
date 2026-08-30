/** Escape text interpolated into HTML / attributes. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Logo / img src: relative app paths, http(s), or data:image — not javascript: or protocol-relative. */
export function isSafeLogoUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  if (u.startsWith('/') && !u.startsWith('//')) return true;
  const lower = u.toLowerCase();
  if (lower.startsWith('https:') || lower.startsWith('http:')) return true;
  if (lower.startsWith('data:image/')) return true;
  return false;
}

export function printAssetOrigin(origin?: string | null): string {
  const raw =
    origin
    ?? (typeof window !== 'undefined' ? window.location?.origin : '')
    ?? '';
  return String(raw).trim().replace(/\/$/, '');
}

/**
 * Blob-preview iframes cannot load app-relative `/branding/…` paths.
 * Prefix with the SPA origin so the company logo actually appears.
 */
export function absolutizePrintAssetUrl(url: string, origin?: string | null): string {
  const u = url.trim();
  if (!u || !isSafeLogoUrl(u)) return u;
  if (u.startsWith('/') && !u.startsWith('//')) {
    const encoded = encodeURI(u);
    const base = printAssetOrigin(origin);
    return base ? `${base}${encoded}` : encoded;
  }
  return u;
}
