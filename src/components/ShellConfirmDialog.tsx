/**
 * In-app confirmation overlay for shell actions (replaces window.confirm).
 */

import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import type { AppTheme } from '../lib/shellTheme';
import { SHELL_MODAL_Z } from '../lib/shellTheme';
import { erpModalMotion } from '../lib/erpMotion';
import { shellModalOverlayCls, shellModalPanelCls } from '../lib/erpShell';
import { isErpTheme } from '../lib/erpBrand';

export type ShellConfirmVariant = 'neutral' | 'danger';

interface ShellConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  variant?: ShellConfirmVariant;
  theme: AppTheme;
  dir: 'rtl' | 'ltr';
}

export function ShellConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  variant = 'neutral',
  theme,
  dir,
}: ShellConfirmDialogProps) {
  const displayed = useRef({ title: '', message: '', confirmLabel: '', cancelLabel: '' });

  if (open) {
    displayed.current = { title, message, confirmLabel, cancelLabel };
  }
  const d = displayed.current;

  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  const titleCls =
    variant === 'danger'
      ? 'text-red-500'
      : isErpTheme(theme)
        ? 'text-[var(--erp-primary)]'
        : theme === 'dark'
          ? 'text-blue-400'
          : 'text-blue-600';

  const confirmCls =
    variant === 'danger'
      ? 'bg-red-600 hover:bg-red-500'
      : isErpTheme(theme)
        ? 'bg-[var(--erp-primary)] hover:bg-[var(--erp-primary-hover)] erp-btn-primary'
        : 'bg-blue-600 hover:bg-blue-500';

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={shellModalOverlayCls(theme, SHELL_MODAL_Z)}
          dir={dir}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onOpenChange(false);
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="shell-confirm-title"
            initial={isErpTheme(theme) ? erpModalMotion.initial : { opacity: 0, scale: 0.96 }}
            animate={isErpTheme(theme) ? erpModalMotion.animate : { opacity: 1, scale: 1 }}
            exit={isErpTheme(theme) ? erpModalMotion.exit : { opacity: 0, scale: 0.96 }}
            transition={isErpTheme(theme) ? erpModalMotion.transition : { duration: 0.15 }}
            className={cn(
              'border rounded-2xl w-full max-w-md overflow-hidden shadow-2xl shell-transition relative z-[2]',
              shellModalPanelCls(theme),
              theme === 'dark'
                ? 'bg-[#151619] border-gray-800'
                : isErpTheme(theme)
                  ? ''
                  : 'bg-white border-gray-200',
            )}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className={cn(
                'p-5 border-b flex justify-between items-start gap-3',
                theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : 'bg-gray-50 border-gray-200',
              )}
            >
              <h2 id="shell-confirm-title" className={cn('text-lg font-bold leading-snug', titleCls)}>
                {d.title}
              </h2>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className={cn(
                  'flex-shrink-0 p-1 rounded-lg transition-colors',
                  theme === 'dark'
                    ? 'text-gray-500 hover:text-white hover:bg-gray-800'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200',
                )}
                aria-label={d.cancelLabel}
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5">
              <p
                className={cn(
                  'text-sm leading-relaxed whitespace-pre-line',
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-600',
                )}
              >
                {d.message}
              </p>
              <div className="flex gap-3 mt-6 justify-end">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium shell-transition',
                    theme === 'dark'
                      ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
                  )}
                >
                  {d.cancelLabel}
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium text-white shell-transition',
                    confirmCls,
                  )}
                >
                  {d.confirmLabel}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
