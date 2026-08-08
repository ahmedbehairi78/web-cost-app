/**
 * Floating overlay for Settings dialogs — portals to document.body so windows
 * are not clipped by the Settings module shell. Use layer="stack" for verify/confirm
 * above a base dialog (only one should be visible at a time when sequencing).
 */
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { coerceAppTheme, type AppTheme, SHELL_MODAL_Z, SHELL_MODAL_STACK_Z } from '../../lib/shellTheme';
import { shellModalOverlayCls } from '../../lib/erpShell';
import { isErpTheme } from '../../lib/erpBrand';
import { erpModalMotion } from '../../lib/erpMotion';
import { notifyUiModalClose, notifyUiModalOpen } from '../../init/uiSoundBridge';

export type SettingsFloatingDialogLayer = 'base' | 'stack';

type Props = {
  open: boolean;
  theme: string | AppTheme;
  dir?: 'rtl' | 'ltr';
  layer?: SettingsFloatingDialogLayer;
  /** When false, backdrop click does nothing (busy operations). */
  closeOnBackdrop?: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  className?: string;
  /** Extra classes on the panel wrapper (max-width, scroll, etc.). */
  panelClassName?: string;
};

export function SettingsFloatingDialog({
  open,
  theme,
  dir = 'rtl',
  layer = 'base',
  closeOnBackdrop = true,
  onClose,
  children,
  className,
  panelClassName,
}: Props) {
  const appTheme = coerceAppTheme(theme);
  const zCls = layer === 'stack' ? SHELL_MODAL_STACK_Z : SHELL_MODAL_Z;

  useEffect(() => {
    if (!open) return;
    notifyUiModalOpen();
    return () => notifyUiModalClose();
  }, [open]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={cn(shellModalOverlayCls(appTheme, zCls), className)}
          dir={dir}
          role="presentation"
          onMouseDown={(e) => {
            if (!closeOnBackdrop || !onClose) return;
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={isErpTheme(appTheme) ? erpModalMotion.initial : { opacity: 0, scale: 0.96 }}
            animate={isErpTheme(appTheme) ? erpModalMotion.animate : { opacity: 1, scale: 1 }}
            exit={isErpTheme(appTheme) ? erpModalMotion.exit : { opacity: 0, scale: 0.96 }}
            transition={isErpTheme(appTheme) ? erpModalMotion.transition : { duration: 0.15 }}
            className={cn('relative z-[2] w-full', panelClassName)}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
