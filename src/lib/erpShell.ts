import { cn } from './utils';
import type { AppTheme } from './shellTheme';
import { ERP_GRADIENT_BG, SHELL_MODAL_ROOT_CLASS, SHELL_MODAL_Z } from './shellTheme';
import { isErpTheme } from './erpBrand';

export { ERP_GRADIENT_BG };

/** Modal overlay — Concord ERP gradient veil, dark dim elsewhere. */
export function shellModalOverlayCls(theme: AppTheme, extra?: string): string {
  return cn(
    'fixed inset-0 flex items-center justify-center p-4 backdrop-blur-sm shell-transition',
    SHELL_MODAL_ROOT_CLASS,
    isErpTheme(theme) ? 'erp-modal-backdrop' : 'bg-black/60',
    extra ?? SHELL_MODAL_Z,
  );
}

/** Modal panel — frosted card on ERP shell. */
export function shellModalPanelCls(theme: AppTheme, extra?: string): string {
  return cn(
    isErpTheme(theme)
      ? 'bg-white/96 backdrop-blur-md border border-[var(--erp-border)] shadow-xl shadow-[var(--erp-primary)]/12'
      : '',
    extra,
  );
}

/** Module page root — transparent in ERP mode so shell gradient shows through. */
export function shellModulePageCls(theme: AppTheme, fallback: string): string {
  return isErpTheme(theme) ? 'min-h-full bg-transparent text-[var(--erp-text)]' : fallback;
}
