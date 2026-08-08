/**
 * Odoo 17 CE visual identity — faithful to the open-source palette.
 * Source: odoo/web/static/src/scss/_variables.scss (Community Edition)
 *
 * Primary (wine/mauve)  : #714B67
 * Workspace background  : #F0EFEF
 * Navbar (Odoo apps bar)  : #714B67  (o-brand-primary)
 * Accent/teal           : #00A09D
 * Danger                : #E2534A
 * Warning               : #ECB613
 * Success               : #00A09D
 */

// ── Odoo brand palette ────────────────────────────────────────────────────────
export const ERP_PRIMARY        = '#714B67';  // o-brand-primary
export const ERP_PRIMARY_HOVER  = '#5C3B52';  // darker shade
export const ERP_PRIMARY_LIGHT  = '#875A7B';  // lighter hover variant
export const ERP_ACCENT         = '#00A09D';  // o-brand-secondary (teal)
export const ERP_ACCENT_WARM    = '#ECB613';  // warning / highlight yellow
export const ERP_DANGER         = '#E2534A';
export const ERP_SUCCESS        = '#00A09D';

// ── Surface & text ────────────────────────────────────────────────────────────
export const ERP_TEXT           = '#212529';  // near-black body text
export const ERP_TEXT_HEADING   = '#1F1F1F';
export const ERP_TEXT_MUTED     = '#6C757D';  // Bootstrap-like muted
export const ERP_BORDER         = '#D6D1CD';  // warm-gray border
export const ERP_SURFACE        = '#FFFFFF';

// ── Workspace / navigation ────────────────────────────────────────────────────
export const ERP_NAVBAR_BG      = '#714B67';  // Odoo CE apps / top bar (brand primary)
export const ERP_NAVBAR_TEXT    = '#F0EFEF';
export const ERP_WS_BG          = '#F0EFEF';  // o-webclient-background-color
export const ERP_NAV_HOVER      = '#F3F2F1';  // sidebar item hover
export const ERP_NAV_ACTIVE_BG  = '#714B67';
export const ERP_NAV_ACTIVE_TEXT = '#FFFFFF';
export const ERP_ACCENT_SOFT    = '#F3EFF2';  // very light tint of primary
export const ERP_OPEN_NAV_BG    = '#EDE6EB';

/** CSS custom-property names (defined in index.css). */
export const ERP_CSS = {
  primary:        '--erp-primary',
  primaryHover:   '--erp-primary-hover',
  accent:         '--erp-accent',
  accentWarm:     '--erp-accent-warm',
  border:         '--erp-border',
  navHover:       '--erp-nav-hover',
  accentSoft:     '--erp-accent-soft',
  openNav:        '--erp-open-nav-bg',
  text:           '--erp-text',
  textHeading:    '--erp-text-heading',
  textMuted:      '--erp-text-muted',
  navbarBg:       '--erp-navbar-bg',
  navbarText:     '--erp-navbar-text',
  wsBg:           '--erp-ws-bg',
} as const;

export function isErpTheme(theme: string): boolean {
  return theme === 'erp';
}
