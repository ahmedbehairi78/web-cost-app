import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  shellFocusRing,
  shellNavActive,
  shellNavOpenDot,
  shellTheme,
  coerceAppTheme,
} from '../lib/shellTheme';
import {
  getModuleMenu,
  moduleHasViewDropdown,
  type ModuleMenuView,
} from '../constants/moduleMenus';
import { playNavigate, playTap } from '../lib/uiSound';
import { ShellAnchoredDropdown } from './ShellAnchoredDropdown';

interface ModuleNavMenuProps {
  moduleId: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  isActive: boolean;
  isOpen: boolean;
  canEnter: boolean;
  activeViewId: string | null;
  hasDraft: boolean;
  theme: string;
  dir: 'rtl' | 'ltr';
  deniedTitle?: string;
  translate: (key: string) => string;
  /** When omitted, all views are treated as allowed. */
  canOpenView?: (viewId: string) => boolean;
  viewDeniedTitle?: (viewId: string) => string | undefined;
  onNavigate: (moduleId: string, viewId?: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}

export function ModuleNavMenu({
  moduleId,
  label,
  icon: Icon,
  isActive,
  isOpen,
  canEnter,
  activeViewId,
  hasDraft,
  theme,
  dir,
  deniedTitle,
  translate,
  canOpenView,
  viewDeniedTitle,
  onNavigate,
  onKeyDown,
  buttonRef,
}: ModuleNavMenuProps) {
  const appTheme = coerceAppTheme(theme, 'erp');
  const shell = shellTheme(appTheme);
  const menu = getModuleMenu(moduleId);
  const hasDropdown = moduleHasViewDropdown(moduleId);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setDropdownOpen(false);
    }, 150);
  }, [cancelClose]);

  const openDropdown = useCallback(() => {
    if (!canEnter || !hasDropdown) return;
    cancelClose();
    setDropdownOpen(true);
  }, [canEnter, hasDropdown, cancelClose]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.shell-dropdown-panel')) return;
      setDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [dropdownOpen]);

  useEffect(() => {
    if (!isActive) setDropdownOpen(false);
  }, [isActive]);

  const pickView = useCallback(
    (viewId: string, allowed: boolean) => {
      cancelClose();
      setDropdownOpen(false);
      if (!canEnter) return;
      if (!allowed) {
        playTap();
        return;
      }
      playNavigate();
      onNavigate(moduleId, viewId);
    },
    [canEnter, moduleId, onNavigate, cancelClose],
  );

  const handlePrimaryClick = () => {
    if (!canEnter) {
      playTap();
      return;
    }
    if (hasDropdown) {
      playTap();
      setDropdownOpen((v) => !v);
      return;
    }
    playNavigate();
    onNavigate(moduleId);
  };

  const renderViewRow = (view: ModuleMenuView) => {
    const selected = isActive && activeViewId === view.viewId;
    const allowed = canOpenView?.(view.viewId) ?? true;
    const deniedHint = !allowed ? viewDeniedTitle?.(view.viewId) : undefined;
    return (
      <button
        key={view.viewId}
        type="button"
        role="menuitem"
        disabled={!allowed}
        aria-disabled={!allowed}
        title={deniedHint}
        onClick={() => pickView(view.viewId, allowed)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-sm shell-transition whitespace-nowrap',
          !allowed && 'opacity-45 cursor-not-allowed',
          allowed && selected
            ? 'bg-[var(--erp-nav-active-bg)] text-[var(--erp-nav-active-text)] font-semibold'
            : allowed
              ? 'text-[var(--erp-text)] hover:bg-[var(--erp-nav-hover)]'
              : 'text-[var(--erp-text-muted)]',
        )}
      >
        <span className="flex-1 truncate">{translate(view.labelKey)}</span>
        {!allowed && <Lock size={12} className="shrink-0 opacity-70" aria-hidden />}
        {allowed && hasDraft && !selected && (
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--erp-accent-warm)] shrink-0" aria-hidden />
        )}
      </button>
    );
  };

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      onPointerEnter={openDropdown}
      onPointerLeave={scheduleClose}
    >
      <button
        ref={buttonRef}
        type="button"
        data-shell-module={moduleId}
        onClick={handlePrimaryClick}
        onKeyDown={onKeyDown}
        title={deniedTitle}
        aria-expanded={hasDropdown ? dropdownOpen : undefined}
        aria-haspopup={hasDropdown ? 'menu' : undefined}
        className={cn(
          'relative flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs whitespace-nowrap erp-nav-entry',
          shellFocusRing(appTheme),
          !canEnter && 'opacity-45 cursor-not-allowed',
          canEnter && isActive
            ? cn(shellNavActive(appTheme), 'erp-nav-entry--active')
            : canEnter && isOpen
              ? shell.navOpen
              : shell.navMuted,
        )}
      >
        <Icon size={14} className="shrink-0" />
        <span className="font-medium">{label}</span>
        {!canEnter && <Lock size={11} className="shrink-0 opacity-70" aria-hidden />}
        {canEnter && hasDraft && (
          <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', shellNavOpenDot(appTheme))} aria-hidden />
        )}
      </button>

      <ShellAnchoredDropdown
        open={canEnter && hasDropdown && dropdownOpen && !!menu}
        anchorRef={rootRef}
        dir={dir}
        theme={theme}
        className="w-max max-w-[280px] bg-white py-1"
        onPanelPointerEnter={openDropdown}
        onPanelPointerLeave={scheduleClose}
      >
        {menu?.views.map((view) => renderViewRow(view))}
      </ShellAnchoredDropdown>
    </div>
  );
}
