import React, { useState, useRef, useCallback } from 'react';
import {
  LogOut,
  Languages,
  X,
  UserCircle2,
  Palette,
  Calculator,
  Lock,
  BookOpen,
  AppWindow,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { isElectronShell, requestOpenNewWindow } from '../lib/electronShell';
import { shellTheme, shellFocusRing, shellNavActive, shellNavOpenDot, SHELL_CHROME_CLASS, SHELL_CHROME_Z } from '../lib/shellTheme';
import { SHELL_NAV_ITEMS } from '../constants/shellNav';
import { useLanguage } from '../context/LanguageContext';
import { ShellConfirmDialog } from './ShellConfirmDialog';
import { type UserPermissions } from '../types';
import { canOpenShellModule, moduleAccess } from '../lib/permissions';
import { isShellModuleNavVisible } from '../lib/shellModuleVisibility';
import { logActivity } from '../services/activityLogService';
import { AppIcon } from './AppIcon';
import { playNavigate, playTap, playToggle, playWindowClose } from '../lib/uiSound';
import { persistLanguagePreference } from '../lib/userPreferences';
import { isLocalBackend } from '../lib/dataBackend';
import { NotificationBell } from './NotificationBell';
import { PurchaseRequestsShellMenu } from './PurchaseRequestsShellMenu';

interface SidebarProps {
  openModuleIds: Set<string>;
  activeModuleId: string | null;
  openWindow: (moduleId: string, viewId?: string) => void;
  closeAllWindows: () => void;
  permissions: UserPermissions;
  isAdmin: boolean;
  visibleShellModules?: string[] | null;
  currentUserEmail: string;
  currentUserName?: string | null;
  onLogout: () => void | Promise<void>;
}

export function Sidebar({
  openModuleIds,
  activeModuleId,
  openWindow,
  closeAllWindows,
  permissions,
  isAdmin,
  visibleShellModules = null,
  currentUserEmail,
  currentUserName,
  onLogout,
}: SidebarProps) {
  const { t, language, setLanguage, dir, theme } = useLanguage();
  const shell = shellTheme(theme);

  // Refs for keyboard arrow navigation between nav items
  const navBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const handleNavKeyDown = useCallback((e: React.KeyboardEvent, idx: number, total: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navBtnRefs.current[(idx + 1) % total]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navBtnRefs.current[(idx - 1 + total) % total]?.focus();
    }
  }, []);

  const [shellConfirm, setShellConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    action: () => void;
  } | null>(null);

  const menuItems = SHELL_NAV_ITEMS.filter((item) =>
    isShellModuleNavVisible(item.id, visibleShellModules),
  );
  const showPurchaseRequests = isShellModuleNavVisible('purchase_requests', visibleShellModules);

  const borderSide = dir === 'rtl' ? 'border-l' : 'border-r';

  const sidebarCls = cn(
    'w-56 h-screen flex flex-col flex-shrink-0 transition-colors relative overflow-visible',
    SHELL_CHROME_CLASS,
    SHELL_CHROME_Z,
    borderSide,
    shell.sidebarSurface,
  );

  const dividerCls = cn('border-b', shell.sidebarDivider);

  const ghostBtnCls = cn(
    'w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-all duration-200',
    language === 'ar' ? 'text-right' : 'text-left',
    shell.navMuted,
    shellFocusRing(theme),
  );

  const currentUserLabel = currentUserName?.trim() || currentUserEmail;

  const handleLangToggle = () => {
    const nextLang = language === 'ar' ? 'en' : 'ar';
    const applyLang = () => persistLanguagePreference(setLanguage, nextLang);
    if (openModuleIds.size > 0) {
      setShellConfirm({
        title: t('shell_confirm_language_title'),
        message: t('shell_confirm_language_body'),
        confirmLabel: t('shell_confirm_continue'),
        action: () => {
          void logActivity({ kind: 'shell_language_switch', detail: 'with_close_windows' });
          closeAllWindows();
          playToggle();
          applyLang();
        },
      });
      return;
    }
    void logActivity({ kind: 'shell_language_switch', detail: 'no_open_windows' });
    playToggle();
    applyLang();
  };

  return (
    <div className={sidebarCls} dir={dir} data-no-global-ui-sound>
      {/* Header */}
      <div className={cn('px-4 py-3', dividerCls)}>
        <h1 className={cn('text-sm font-bold flex items-center gap-2', shell.brandHeading)}>
          <AppIcon className="w-6 h-6 rounded-md ring-1 ring-white/10" />
          {language === 'ar' ? 'نظام إدارة التكاليف' : 'Cost Management'}
        </h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {menuItems.map((item, idx) => {
          const isActive = item.id === activeModuleId;
          const isOpen   = openModuleIds.has(item.id);
          const canEnter = canOpenShellModule(permissions, item.id, { isAdmin });
          return (
            <button
              key={item.id}
              ref={(el) => { navBtnRefs.current[idx] = el; }}
              type="button"
              data-shell-module={item.id}
              onClick={() => {
                if (canEnter) playNavigate();
                else playTap();
                openWindow(item.id);
              }}
              onKeyDown={(e) => handleNavKeyDown(e, idx, menuItems.length)}
              title={!canEnter ? t('shell_module_access_denied').replace('{module}', t(item.labelKey)) : undefined}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-all duration-200',
                language === 'ar' ? 'text-right' : 'text-left',
                shellFocusRing(theme),
                !canEnter && 'opacity-45 cursor-not-allowed',
                canEnter && isActive
                  ? shellNavActive(theme)
                  : canEnter && isOpen
                    ? shell.navOpen
                    : shell.navMuted,
              )}
            >
              <item.icon size={16} className="flex-shrink-0" />
              <span className="font-medium">{t(item.labelKey)}</span>
              {!canEnter && (
                <Lock size={12} className="ms-auto shrink-0 opacity-70" aria-hidden />
              )}
              {canEnter && isActive && (
                <span className="ms-auto w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />
              )}
              {canEnter && !isActive && isOpen && (
                <span className={cn('ms-auto w-1.5 h-1.5 rounded-full flex-shrink-0', shellNavOpenDot(theme))} />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={cn('px-3 py-2 border-t space-y-1', shell.footerTopBorder)}>

        {/* Current user card */}
        <div className={cn(
          'mb-1 rounded-lg border px-2 py-1.5',
          theme === 'dark'
            ? 'border-gray-700 bg-gray-900/50 text-gray-300'
            : 'border-gray-200 bg-white/70 text-gray-700'
        )}>
          <div className="flex items-center gap-1.5 min-w-0">
            <UserCircle2 size={14} className="shrink-0 text-blue-400" />
            <div className="min-w-0">
              <div className="text-[10px] font-bold text-gray-500">
                {language === 'ar' ? 'المستخدم الحالي' : 'Current user'}
              </div>
              <div className="truncate text-[11px] font-semibold" title={currentUserLabel}>
                {currentUserLabel}
              </div>
              {currentUserName && currentUserEmail && currentUserName !== currentUserEmail && (
                <div className="truncate text-[10px] text-gray-500" title={currentUserEmail}>
                  {currentUserEmail}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Close all windows */}
        {openModuleIds.size > 0 && (
          <button
            type="button"
            onClick={() => {
              const count = String(openModuleIds.size);
              setShellConfirm({
                title: t('shell_confirm_close_all_title'),
                message: t('shell_confirm_close_all_body').replace('{count}', count),
                confirmLabel: t('shell_confirm_close_all_action'),
                action: () => {
                  playWindowClose();
                  closeAllWindows();
                },
              });
            }}
            className={cn(ghostBtnCls, shell.closeAllRow)}
          >
            <X size={14} className="flex-shrink-0" />
            <span className="font-medium">
              {language === 'ar' ? `إغلاق الكل (${openModuleIds.size})` : `Close All (${openModuleIds.size})`}
            </span>
          </button>
        )}

        {/* General settings (accessible to all users) */}
        <button
          type="button"
          onClick={() => {
            playNavigate();
            openWindow('general');
          }}
          className={cn(
            ghostBtnCls,
            (openModuleIds.has('general') || openModuleIds.has('display')) ? shellNavActive(theme) : '',
          )}
        >
          <Palette size={14} className="flex-shrink-0" />
          <span className="font-medium">{t('general_settings')}</span>
          {(openModuleIds.has('general') || openModuleIds.has('display')) && (
            <span className="ms-auto w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />
          )}
        </button>

        {/* Purchase requests — menu of views next to general settings */}
        {showPurchaseRequests && (
          <PurchaseRequestsShellMenu
            openWindow={openWindow}
            theme={theme}
            variant="sidebar"
            isActive={activeModuleId === 'purchase_requests'}
            isOpen={openModuleIds.has('purchase_requests')}
            canCreate={isAdmin || moduleAccess(permissions, 'purchase_requests').create}
          />
        )}

        {/* New desktop window — Electron only; same session for all users */}
        {isElectronShell() && (
          <button
            type="button"
            onClick={() => {
              playNavigate();
              requestOpenNewWindow();
            }}
            title={`${t('general_new_window')} (${t('general_new_window_shortcut')})`}
            className={ghostBtnCls}
          >
            <AppWindow size={14} className="flex-shrink-0" />
            <span className="font-medium">{t('general_new_window')}</span>
            <kbd className="ms-auto text-[10px] font-mono opacity-60 flex-shrink-0">
              {t('general_new_window_shortcut')}
            </kbd>
          </button>
        )}

        {/* Calculator button (accessible to all users, no permission check) */}
        <button
          type="button"
          onClick={() => {
            playNavigate();
            openWindow('calculator');
          }}
          className={cn(
            ghostBtnCls,
            openModuleIds.has('calculator') ? shellNavActive(theme) : '',
          )}
        >
          <Calculator size={14} className="flex-shrink-0" />
          <span className="font-medium">{language === 'ar' ? 'الآلة الحاسبة' : 'Calculator'}</span>
          {openModuleIds.has('calculator') && (
            <span className="ms-auto w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />
          )}
        </button>

        {/* User guide (accessible to all authenticated users) */}
        <button
          type="button"
          onClick={() => {
            playNavigate();
            openWindow('manual');
          }}
          className={cn(
            ghostBtnCls,
            openModuleIds.has('manual') ? shellNavActive(theme) : '',
          )}
        >
          <BookOpen size={14} className="flex-shrink-0" />
          <span className="font-medium">{t('manual_title')}</span>
          {openModuleIds.has('manual') && (
            <span className="ms-auto w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />
          )}
        </button>

        {isLocalBackend && (
          <NotificationBell openWindow={openWindow} theme={theme} />
        )}

        {/* Language toggle */}
        <button
          type="button"
          onClick={handleLangToggle}
          className={ghostBtnCls}
        >
          <Languages size={14} className="flex-shrink-0" />
          <span className="font-medium">{language === 'ar' ? 'English' : 'العربية'}</span>
        </button>

        {/* Logout */}
        <button
          type="button"
          onClick={() => {
            playTap();
            setShellConfirm({
              title: language === 'ar' ? 'تأكيد تسجيل الخروج' : 'Confirm Logout',
              message: isElectronShell() ? t('logout_confirm_desktop') : t('logout_confirm_message'),
              confirmLabel: t('logout'),
              action: () => {
                void onLogout();
              },
            });
          }}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-all duration-200',
            language === 'ar' ? 'text-right' : 'text-left',
            shell.logoutRow,
            shellFocusRing(theme),
          )}
        >
          <LogOut size={14} className="flex-shrink-0" />
          <span className="font-medium">{t('logout')}</span>
        </button>
      </div>

      <ShellConfirmDialog
        open={shellConfirm !== null}
        onOpenChange={(next) => {
          if (!next) setShellConfirm(null);
        }}
        title={shellConfirm?.title ?? ''}
        message={shellConfirm?.message ?? ''}
        confirmLabel={shellConfirm?.confirmLabel ?? t('confirm')}
        cancelLabel={t('cancel')}
        onConfirm={() => shellConfirm?.action()}
        variant="neutral"
        theme={theme}
        dir={dir}
      />
    </div>
  );
}
