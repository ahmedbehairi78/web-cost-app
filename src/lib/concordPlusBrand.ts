/** Concord Plus brand tokens — single source for colors, paths, and asset URLs. */
export const CONCORD_NAVY = '#003B71';
export const CONCORD_ORANGE = '#F58220';
export const CONCORD_FONT =
  'Segoe UI, Helvetica Neue, Arial, sans-serif';

export const CONCORD_BRAND = {
  logoFull: '/branding/logo-full.svg',
  logoCompact: '/branding/logo-compact.svg',
  logoPrint: '/branding/my-logo.png',
  logoPrintPng: '/branding/my-logo.png',
  iconApp: '/branding/icon-app.svg',
  iconFavicon: '/branding/icon-favicon.svg',
  desktopIcon: '/desktop-icon.png',
} as const;

export const DEFAULT_HEADER_LOGO = CONCORD_BRAND.logoPrint;

export function resolveHeaderLogo(url?: string | null): string {
  const trimmed = url?.trim();
  return trimmed || DEFAULT_HEADER_LOGO;
}

/** Icon row geometry (shared across SVG exports + React). */
export const CONCORD_ICON = {
  /** MEP — sharp lightning bolt */
  lightning:
    'M11.2 0L4.2 12.2H8.1L6.2 22.5L15.2 11.4H11.4L14 0H11.2z',
  /** Finishing — industrial building, stepped roof */
  finishing:
    'M0 11.2L3.2 8.4L6.4 10.6L9.6 7.8L12.8 10.2L16 8L18.8 10.4V19.2H0V11.2z',
  /** Infra — tower inside rounded frame (stroke rect drawn separately) */
  infraFrame: { x: 0, y: 0, w: 19, h: 21, rx: 2.8 },
  infraTower: 'M5.5 17.5V9.2L9.5 6.2L13.5 9.2V17.5H5.5z',
  infraWindows: [
    { x: 7.8, y: 10.5, w: 1.3, h: 7 },
    { x: 10.9, y: 10.5, w: 1.3, h: 7 },
  ] as const,
  /** Positions in the 68px-wide icon strip */
  layout: {
    lightning: { x: 0, y: 0 },
    finishing: { x: 20, y: 1.5 },
    infra: { x: 42, y: 0 },
    plusTextX: 70,
  },
} as const;

export const CONCORD_TAGLINE = 'MEP \u2022 Finishing \u2022 Infra';

/** Tagline split into words — x positions include slight right shift for visual center. */
export const CONCORD_TAGLINE_PARTS = [
  { kind: 'word' as const, text: 'MEP', x: 38 },
  { kind: 'sep' as const, text: '\u2022', x: 66 },
  { kind: 'word' as const, text: 'Finishing', x: 78 },
  { kind: 'sep' as const, text: '\u2022', x: 148 },
  { kind: 'word' as const, text: 'Infra', x: 160 },
] as const;

export const CONCORD_TAGLINE_Y = 82;
export const CONCORD_TAGLINE_FONT_SIZE = 11;

/**
 * Tight SVG viewBox sizes — tagline is the widest element (~208px).
 * Wordmark (Concord + icons + Plus) is narrower (~116px) and centered above it.
 * Keep in sync with scripts/sync-branding-svgs.mjs (CONCORD_LOGO_VIEWBOX).
 */
export const CONCORD_LOGO_VIEWBOX = {
  full: { w: 208, h: 88, hNoTagline: 62, wordmarkW: 116, wordmarkOffsetX: 46 },
  compact: { w: 104, h: 58 },
  print: { w: 212, h: 92, padX: 2, padY: 2 },
} as const;

export function concordFullLogoViewBox(showTagline: boolean): string {
  const { w, h, hNoTagline } = CONCORD_LOGO_VIEWBOX.full;
  return `0 0 ${w} ${showTagline ? h : hNoTagline}`;
}

export function concordCompactLogoViewBox(): string {
  const { w, h } = CONCORD_LOGO_VIEWBOX.compact;
  return `0 0 ${w} ${h}`;
}
