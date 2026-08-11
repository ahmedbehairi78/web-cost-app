/**
 * Centralized Tailwind classes for the app shell (sidebar + floating windows).
 * Keeps dark / soft / light / erp in one place — extend here before copying hex into new UI.
 */

export const APP_THEME_IDS = ['dark', 'light', 'soft', 'erp'] as const;
export type AppTheme = (typeof APP_THEME_IDS)[number];

/** Legacy theme id saved before Concord ERP rebrand. */
export const LEGACY_ERP_THEME_ID = 'odoo';

export function normalizeStoredTheme(value: string): string {
  return value === LEGACY_ERP_THEME_ID ? 'erp' : value;
}

export function isAppTheme(value: string): value is AppTheme {
  return (APP_THEME_IDS as readonly string[]).includes(value)
    || value === LEGACY_ERP_THEME_ID;
}

export function coerceAppTheme(value: string | undefined | null, fallback: AppTheme = 'erp'): AppTheme {
  const normalized = value ? normalizeStoredTheme(value) : fallback;
  return (APP_THEME_IDS as readonly string[]).includes(normalized)
    ? (normalized as AppTheme)
    : fallback;
}

/** Concord ERP layout uses a horizontal top bar instead of the sidebar. */
export function usesTopNav(mode: AppTheme): boolean {
  return mode === 'erp';
}

export function shellSidebarWidth(mode: AppTheme): number {
  return usesTopNav(mode) ? 0 : 256;
}

/** Tailwind class — Concord ERP shell gradient (see index.css). */
export const ERP_GRADIENT_BG = 'erp-gradient-bg';

/** @deprecated Use ERP_GRADIENT_BG */
export const ODOO_GRADIENT_BG = ERP_GRADIENT_BG;

/** Stack shell chrome (nav, dropdowns) above floating windows (z ≈ 10–200). */
export const SHELL_CHROME_Z = 'z-[1000]';
export const SHELL_CHROME_CLASS = 'shell-chrome';

/** Portaled nav dropdowns — above workspace panels and utility windows, below modals. */
export const SHELL_DROPDOWN_Z = 'z-[1200]';
export const SHELL_DROPDOWN_Z_INDEX = 1200;

/** Main desktop area — must stay below shell chrome for dropdowns/menus. */
export const SHELL_MAIN_CLASS = 'shell-main';

/** Global confirm / blocking overlays. */
export const SHELL_MODAL_Z = 'z-[10050]';
/** Verify / stacked confirm above a base Settings floating dialog. */
export const SHELL_MODAL_STACK_Z = 'z-[10060]';
/**
 * Unified report print preview — must sit above journal/settings modals
 * (SHELL_MODAL_Z / STACK) so Print from an open detail dialog is visible.
 */
export const SHELL_REPORT_PREVIEW_Z = 'z-[10100]';
export const SHELL_MODAL_ROOT_CLASS = 'shell-modal-root';

export function shellAppBackground(mode: AppTheme): string {
  if (mode === 'dark') return 'bg-[#0a0a0a]';
  if (mode === 'soft') return 'bg-[#dde3e8]';
  if (mode === 'erp') return ERP_GRADIENT_BG;
  return 'bg-gray-100';
}

export interface ShellThemePalette {
  sidebarSurface: string;
  sidebarDivider: string;
  navMuted: string;
  navOpen: string;
  brandHeading: string;
  footerTopBorder: string;
  logoutRow: string;
  closeAllRow: string;
  wmTitleBar: string;
  wmWindow: string;
  wmTitleText: string;
  wmModuleLoader: string;
  taskbar: string;
  taskbarBtn: string;
  emptyDesktop: string;
  topNavBar: string;
  topNavDivider: string;
  topNavBrand: string;
  topNavUtility: string;
}

export function shellTheme(mode: AppTheme): ShellThemePalette {
  if (mode === 'erp') {
    // Odoo 17 CE — brand-primary top bar (#714B67), warm-gray workspace (#F0EFEF)
    return {
      sidebarSurface: 'bg-white text-[var(--erp-text)] border-[var(--erp-border)]',
      sidebarDivider: 'border-[var(--erp-border)]',
      // On the purple navbar, items are light-colored
      navMuted:  'text-[#F0EFEF]/75 hover:bg-white/10 hover:text-white',
      navOpen:   'bg-white/15 text-white hover:bg-white/20',
      brandHeading: 'text-white',
      footerTopBorder: 'border-white/15',
      logoutRow: 'text-[#F0EFEF]/75 hover:bg-white/10 hover:text-red-300',
      closeAllRow: 'text-[var(--erp-accent-warm)]/80 hover:bg-white/10 hover:text-[var(--erp-accent-warm)]',
      // Window chrome — frosted white card on warm workspace background
      wmTitleBar: 'bg-white border-[var(--erp-border)] shadow-sm',
      wmWindow:   'border border-[var(--erp-border)] shadow-[0_4px_20px_rgba(0,0,0,0.10)] bg-transparent',
      wmTitleText: 'text-[var(--erp-text-heading)]',
      wmModuleLoader: 'bg-transparent text-[var(--erp-text-muted)]',
      // Taskbar — white pill strip at the bottom
      taskbar:    'bg-white/90 backdrop-blur-md border-[var(--erp-border)]',
      taskbarBtn: 'bg-[var(--erp-nav-hover)] text-[var(--erp-primary)] hover:bg-[var(--erp-open-nav-bg)] hover:text-[var(--erp-primary-hover)]',
      emptyDesktop: 'text-[var(--erp-text-muted)]',
      // Top nav bar — Odoo brand primary (#714B67)
      topNavBar: 'bg-[var(--erp-navbar-bg)] text-[var(--erp-navbar-text)] border-b border-black/15 shadow-[0_2px_6px_rgba(0,0,0,0.18)]',
      topNavDivider: 'border-white/12',
      topNavBrand: 'text-white font-semibold',
      topNavUtility: 'text-[#F0EFEF]/80 hover:bg-white/10 hover:text-white',
    };
  }

  if (mode === 'dark') {
    return {
      sidebarSurface: 'bg-[#151619] text-white border-gray-800',
      sidebarDivider: 'border-gray-800',
      navMuted: 'text-gray-400 hover:bg-gray-800 hover:text-white',
      navOpen: 'bg-gray-800/70 text-gray-200 hover:bg-gray-700 hover:text-white',
      brandHeading: 'text-white',
      footerTopBorder: 'border-gray-800',
      logoutRow: 'text-gray-400 hover:bg-red-900/30 hover:text-red-400',
      closeAllRow: 'text-orange-400 hover:bg-orange-900/20 hover:text-orange-300',
      wmTitleBar: 'bg-[#1c1d22] border-gray-700/60',
      wmWindow: 'bg-[#0d0e11] border-gray-700/60 shadow-2xl shadow-black/60',
      wmTitleText: 'text-gray-200',
      wmModuleLoader: 'bg-[#0d0e11] text-gray-500',
      taskbar: 'bg-[#151619] border-gray-800',
      taskbarBtn: 'bg-gray-800 text-gray-300 hover:bg-gray-700',
      emptyDesktop: 'text-gray-600',
      topNavBar: 'bg-[#151619] text-white border-gray-800',
      topNavDivider: 'border-gray-800',
      topNavBrand: 'text-white',
      topNavUtility: 'text-gray-400 hover:bg-gray-800 hover:text-white',
    };
  }

  if (mode === 'soft') {
    return {
      sidebarSurface: 'bg-white text-[#37474f] border-[#cfd8dc]',
      sidebarDivider: 'border-[#cfd8dc]',
      navMuted: 'text-[#546e7a] hover:bg-[#eceff1] hover:text-[#37474f]',
      navOpen: 'bg-[#e4eef4] text-[#2d6a8a] hover:bg-[#d8eaf5] hover:text-[#1e5070]',
      brandHeading: 'text-gray-900',
      footerTopBorder: 'border-[#cfd8dc]',
      logoutRow: 'text-[#546e7a] hover:bg-red-50 hover:text-red-500',
      closeAllRow: 'text-orange-600 hover:bg-orange-50 hover:text-orange-700',
      wmTitleBar: 'bg-[#e4e9ec] border-[#cfd8dc]',
      wmWindow: 'bg-white border-[#cfd8dc] shadow-xl shadow-black/10',
      wmTitleText: 'text-gray-700',
      wmModuleLoader: 'bg-white text-[#546e7a]',
      taskbar: 'bg-white border-[#cfd8dc]',
      taskbarBtn: 'bg-[#eceff1] text-[#546e7a] hover:bg-[#cfd8dc]',
      emptyDesktop: 'text-gray-400',
      topNavBar: 'bg-white text-[#37474f] border-[#cfd8dc]',
      topNavDivider: 'border-[#cfd8dc]',
      topNavBrand: 'text-gray-900',
      topNavUtility: 'text-[#546e7a] hover:bg-[#eceff1] hover:text-[#37474f]',
    };
  }

  return {
    sidebarSurface: 'bg-white text-gray-900 border-gray-200',
    sidebarDivider: 'border-gray-200',
    navMuted: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
    navOpen: 'bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800',
    brandHeading: 'text-gray-900',
    footerTopBorder: 'border-gray-200',
    logoutRow: 'text-gray-500 hover:bg-red-50 hover:text-red-500',
    closeAllRow: 'text-orange-600 hover:bg-orange-50 hover:text-orange-700',
    wmTitleBar: 'bg-gray-100 border-gray-200',
    wmWindow: 'bg-white border-gray-200 shadow-xl shadow-black/10',
    wmTitleText: 'text-gray-700',
    wmModuleLoader: 'bg-white text-gray-500',
    taskbar: 'bg-gray-50 border-gray-200',
    taskbarBtn: 'bg-gray-200 text-gray-700 hover:bg-gray-300',
    emptyDesktop: 'text-gray-400',
    topNavBar: 'bg-white text-gray-900 border-gray-200',
    topNavDivider: 'border-gray-200',
    topNavBrand: 'text-gray-900',
    topNavUtility: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
  };
}

/** Active nav item (sidebar or top bar). */
export function shellNavActive(mode: AppTheme): string {
  if (mode === 'erp') {
    // Active tab on purple navbar — slightly darker mauve for contrast
    return 'bg-[var(--erp-primary-hover)] text-white shadow-sm shadow-black/15 ring-0';
  }
  return 'bg-blue-600 text-white shadow-lg shadow-blue-900/20';
}

/** Dot indicator for open-but-inactive modules. */
export function shellNavOpenDot(mode: AppTheme): string {
  if (mode === 'erp') return 'bg-white/75';
  return 'bg-blue-400/70';
}

/** Treat ERP like soft/light for module surfaces that branch on soft vs dark. */
export function isSoftLikeTheme(mode: AppTheme): boolean {
  return mode === 'soft' || mode === 'erp';
}

/** Use on sidebar / window chrome buttons for keyboard focus. */
export function shellFocusRing(mode: AppTheme): string {
  if (mode === 'erp') {
    return 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-primary)]';
  }
  return 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500';
}

/** @deprecated Prefer shellFocusRing(theme) for theme-aware focus. */
export const shellInteractiveFocus =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500';
