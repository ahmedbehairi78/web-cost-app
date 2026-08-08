import { cn } from './utils';
import type { AppTheme } from './shellTheme';
import { isSoftLikeTheme, shellFocusRing } from './shellTheme';
import { isErpTheme } from './erpBrand';

/** Primary action button — Concord ERP navy, blue elsewhere. */
export function uiBtnPrimary(theme: AppTheme, extra?: string): string {
  return cn(
    'font-medium shell-transition disabled:opacity-60 disabled:cursor-not-allowed',
    isErpTheme(theme)
      ? 'bg-[var(--erp-primary)] hover:bg-[var(--erp-primary-hover)] text-white shadow-sm shadow-[var(--erp-primary)]/20 erp-btn-primary'
      : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-900/20',
    shellFocusRing(theme),
    extra,
  );
}

/** Secondary / outline button. */
export function uiBtnSecondary(theme: AppTheme, extra?: string): string {
  return cn(
    'font-medium shell-transition border',
    isErpTheme(theme)
      ? 'bg-white border-[var(--erp-border)] text-[var(--erp-primary)] hover:bg-[var(--erp-nav-hover)]'
      : isSoftLikeTheme(theme)
        ? 'bg-white border-[#cfd8dc] text-[#546e7a] hover:bg-[#eceff1]'
        : theme === 'dark'
          ? 'bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700'
          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50',
    shellFocusRing(theme),
    extra,
  );
}

/** Active tab underline / pill. */
export function uiTabActive(theme: AppTheme, extra?: string): string {
  return cn(
    isErpTheme(theme)
      ? 'border-[var(--erp-primary)] text-[var(--erp-primary)] bg-[var(--erp-nav-hover)]'
      : 'border-blue-600 text-blue-600 bg-blue-50',
    extra,
  );
}

/** Muted link / secondary accent text. */
export function uiAccentText(theme: AppTheme, extra?: string): string {
  return cn(isErpTheme(theme) ? 'text-[var(--erp-accent)]' : 'text-blue-600', extra);
}

/** Card / panel on module pages. */
export function uiCard(theme: AppTheme, extra?: string): string {
  return cn(
    'rounded-xl border shell-transition',
    isErpTheme(theme)
      ? 'bg-white/95 backdrop-blur-sm border-[var(--erp-border)] shadow-sm shadow-[var(--erp-primary)]/8 erp-card-enter'
      : isSoftLikeTheme(theme)
        ? 'bg-white border-[#cfd8dc] shadow-sm'
        : theme === 'dark'
          ? 'bg-[#151619] border-gray-800 shadow-lg'
          : 'bg-white border-gray-200 shadow-sm',
    extra,
  );
}

/** Form field border + focus. */
export function uiInput(theme: AppTheme, extra?: string): string {
  return cn(
    'rounded-lg border text-sm shell-transition outline-none',
    isErpTheme(theme)
      ? 'bg-white border-[var(--erp-border)] text-[var(--erp-text)] focus:border-[var(--erp-primary)] focus:ring-2 focus:ring-[var(--erp-accent-warm)]/25'
      : theme === 'dark'
        ? 'bg-gray-900 border-gray-700 text-gray-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30'
        : isSoftLikeTheme(theme)
          ? 'bg-white border-[#cfd8dc] text-[#37474f] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
          : 'bg-white border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20',
    extra,
  );
}
