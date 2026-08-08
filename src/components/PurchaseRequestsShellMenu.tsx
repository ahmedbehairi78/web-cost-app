import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ShoppingCart } from 'lucide-react';
import { cn } from '../lib/utils';
import { getModuleMenu } from '../constants/moduleMenus';
import { shellFocusRing, shellNavActive, shellTheme, type AppTheme } from '../lib/shellTheme';
import { ShellAnchoredDropdown } from './ShellAnchoredDropdown';
import { playNavigate, playTap } from '../lib/uiSound';
import { useLanguage } from '../context/LanguageContext';

interface PurchaseRequestsShellMenuProps {
  openWindow: (moduleId: string, viewId?: string) => void;
  theme: AppTheme | string;
  /** Sidebar footer row vs TopNav icon button */
  variant?: 'sidebar' | 'topnav';
  isActive?: boolean;
  isOpen?: boolean;
  /** Hide create when user cannot create requests */
  canCreate?: boolean;
  className?: string;
}

/**
 * Footer / utility control: click opens a menu of PR views, then navigates only after a choice.
 */
export function PurchaseRequestsShellMenu({
  openWindow,
  theme,
  variant = 'sidebar',
  isActive = false,
  isOpen = false,
  canCreate = true,
  className,
}: PurchaseRequestsShellMenuProps) {
  const { t, dir } = useLanguage();
  const shell = shellTheme(theme as AppTheme);
  const menu = getModuleMenu('purchase_requests');
  const views = (menu?.views ?? []).filter((v) => v.viewId !== 'create' || canCreate);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const pickView = useCallback(
    (viewId: string) => {
      setDropdownOpen(false);
      playNavigate();
      openWindow('purchase_requests', viewId);
    },
    [openWindow],
  );

  const isTopNav = variant === 'topnav';
  const highlighted = isActive || isOpen;

  return (
    <div ref={rootRef} className={cn('relative', isTopNav ? 'shrink-0' : 'w-full', className)}>
      <button
        type="button"
        onClick={() => {
          playTap();
          setDropdownOpen((v) => !v);
        }}
        aria-expanded={dropdownOpen}
        aria-haspopup="menu"
        title={t('purchase_requests')}
        className={cn(
          shellFocusRing(theme as AppTheme),
          isTopNav
            ? cn(
                'w-8 h-8 flex items-center justify-center rounded-lg shell-transition',
                highlighted ? shellNavActive(theme as AppTheme) : shell.topNavUtility,
              )
            : cn(
                'w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm shell-transition',
                dir === 'rtl' ? 'text-right' : 'text-left',
                highlighted ? shellNavActive(theme as AppTheme) : shell.navMuted,
              ),
        )}
      >
        <ShoppingCart size={isTopNav ? 15 : 14} className="flex-shrink-0" />
        {!isTopNav && (
          <>
            <span className="font-medium flex-1">{t('purchase_requests')}</span>
            <ChevronDown
              size={14}
              className={cn('flex-shrink-0 opacity-70 transition-transform', dropdownOpen && 'rotate-180')}
            />
          </>
        )}
      </button>

      <ShellAnchoredDropdown
        open={dropdownOpen && views.length > 0}
        anchorRef={rootRef}
        dir={dir}
        theme={theme}
        align={isTopNav ? 'end' : 'start'}
        className={cn(
          'w-max min-w-[11rem] max-w-[280px] py-1',
          theme === 'dark' ? 'bg-gray-900 border border-gray-700' : 'bg-white border border-gray-200',
        )}
      >
        {views.map((view) => (
          <button
            key={view.viewId}
            type="button"
            role="menuitem"
            onClick={() => pickView(view.viewId)}
            className={cn(
              'w-full flex items-center px-3 py-2 text-sm font-medium whitespace-nowrap shell-transition',
              dir === 'rtl' ? 'text-right' : 'text-left',
              theme === 'dark'
                ? 'text-gray-100 hover:bg-gray-800'
                : 'text-gray-800 hover:bg-gray-100',
            )}
          >
            {t(view.labelKey)}
          </button>
        ))}
      </ShellAnchoredDropdown>
    </div>
  );
}
