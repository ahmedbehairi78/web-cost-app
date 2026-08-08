import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../lib/utils';
import { SHELL_DROPDOWN_Z } from '../lib/shellTheme';
import { erpDropdownMotion } from '../lib/erpMotion';
import { isErpTheme } from '../lib/erpBrand';

type DropdownAlign = 'start' | 'end';

interface ShellAnchoredDropdownProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  dir: 'rtl' | 'ltr';
  theme: string;
  children: React.ReactNode;
  className?: string;
  align?: DropdownAlign;
  role?: string;
  onPanelPointerEnter?: () => void;
  onPanelPointerLeave?: () => void;
}

const PANEL_MARGIN = 12; // px gap from viewport edges
const FALLBACK_WIDTH = 280; // used before the panel has been measured

interface PanelPosition {
  top: number;
  left: number;
  minWidth: number;
}

/**
 * Compute an explicit left/top, always using the panel's measured width so the
 * box is fully clamped within the viewport (no overflow off the app frame).
 */
function dropdownPosition(
  rect: DOMRect,
  dir: 'rtl' | 'ltr',
  align: DropdownAlign,
  panelWidth: number,
  panelHeight = 160,
): PanelPosition {
  const minWidth = Math.max(rect.width, 140);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(panelWidth, vw - PANEL_MARGIN * 2);
  const height = Math.min(panelHeight, vh - PANEL_MARGIN * 2);

  // Prefer below the anchor; flip above when the footer/utility area is near the bottom.
  const spaceBelow = vh - rect.bottom - PANEL_MARGIN;
  const spaceAbove = rect.top - PANEL_MARGIN;
  let top: number;
  if (spaceBelow < height && spaceAbove > spaceBelow) {
    top = Math.max(PANEL_MARGIN, rect.top - height - 4);
  } else {
    top = rect.bottom + 4;
    if (top + height > vh - PANEL_MARGIN) {
      top = Math.max(PANEL_MARGIN, vh - PANEL_MARGIN - height);
    }
  }

  // Preferred left edge based on alignment + reading direction.
  let left: number;
  if (align === 'end') {
    // Trailing edge of the anchor: panel's right edge aligns with the anchor's right edge.
    left = rect.right - width;
  } else {
    // Leading edge: panel's left edge aligns with the anchor's left edge (flip for RTL).
    left = dir === 'rtl' ? rect.right - width : rect.left;
  }

  // Clamp the whole box inside [PANEL_MARGIN, vw - PANEL_MARGIN].
  const maxLeft = vw - PANEL_MARGIN - width;
  left = Math.max(PANEL_MARGIN, Math.min(left, maxLeft));

  return { top, left, minWidth };
}

/** Renders a shell nav dropdown in a top-layer portal so it stays above open windows. */
export function ShellAnchoredDropdown({
  open,
  anchorRef,
  dir,
  theme,
  children,
  className,
  align = 'start',
  role = 'menu',
  onPanelPointerEnter,
  onPanelPointerLeave,
}: ShellAnchoredDropdownProps) {
  const [style, setStyle] = useState<PanelPosition | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const update = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const measuredW = panelRef.current?.offsetWidth ?? 0;
    const measuredH = panelRef.current?.offsetHeight ?? 0;
    const panelWidth = measuredW > 0 ? measuredW : FALLBACK_WIDTH;
    const panelHeight = measuredH > 0 ? measuredH : 160;
    setStyle(dropdownPosition(el.getBoundingClientRect(), dir, align, panelWidth, panelHeight));
  }, [anchorRef, dir, align]);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setStyle(null);
      return;
    }
    update();
    // Re-measure on the next frame once the panel has rendered at its real width.
    const raf = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef, update]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && style && (
        <motion.div
          ref={panelRef}
          role={role}
          dir={dir}
          onPointerEnter={onPanelPointerEnter}
          onPointerLeave={onPanelPointerLeave}
          initial={isErpTheme(theme) ? erpDropdownMotion.initial : { opacity: 0, y: -6, scale: 0.98 }}
          animate={isErpTheme(theme) ? erpDropdownMotion.animate : { opacity: 1, y: 0, scale: 1 }}
          exit={isErpTheme(theme) ? erpDropdownMotion.exit : { opacity: 0, y: -4, scale: 0.98 }}
          transition={isErpTheme(theme) ? erpDropdownMotion.transition : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          style={{
            top: style.top,
            left: style.left,
            minWidth: style.minWidth,
            maxWidth: `calc(100vw - ${PANEL_MARGIN * 2}px)`,
          }}
          className={cn(
            'fixed rounded-xl border shadow-lg shadow-black/10 shell-dropdown-panel',
            SHELL_DROPDOWN_Z,
            isErpTheme(theme) && 'erp-dropdown-panel',
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
