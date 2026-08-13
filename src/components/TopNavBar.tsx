import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppWindow,
  BookOpen,
  Calculator,
  ChevronDown,
  Languages,
  Lock,
  LogOut,
  Palette,
  UserCircle2,
  X,
} from 'lucide-react';
import { isErpTheme } from '../lib/erpBrand';
import { cn } from '../lib/utils';
import { isElectronShell, requestOpenNewWindow } from '../lib/electronShell';
import {
  shellFocusRing,
  shellNavActive,
  shellNavOpenDot,
  shellTheme,
  SHELL_CHROME_CLASS,
  SHELL_CHROME_Z,
} from '../lib/shellTheme';
import { getModuleMenu } from '../constants/moduleMenus';
import { SHELL_NAV_ITEMS } from '../constants/shellNav';
import { useLanguage } from '../context/LanguageContext';
import { ShellConfirmDialog } from './ShellConfirmDialog';
import { type UserPermissions } from '../types';
import { canOpenModule, canOpenShellModule, canOpenModuleView, moduleAccess, permissionKeyForModuleView } from '../lib/permissions';
import { isShellModuleNavVisible } from '../lib/shellModuleVisibility';
import { logActivity } from '../services/activityLogService';
import { AppIcon } from './AppIcon';
import { ConcordPlusLogo } from './ConcordPlusLogo';
import { playNavigate, playTap, playToggle, playWindowClose } from '../lib/uiSound';
import { persistLanguagePreference } from '../lib/userPreferences';
import { isLocalBackend } from '../lib/dataBackend';
import { NotificationBell } from './NotificationBell';
import { ShellAnchoredDropdown } from './ShellAnchoredDropdown';
import { ModuleNavMenu } from './ModuleNavMenu';
import { PurchaseRequestsShellMenu } from './PurchaseRequestsShellMenu';

interface TopNavBarProps {
  openModuleIds: Set<string>;
  activeModuleId: string | null;
  activeViewId?: string | null;
  openWindow: (moduleId: string, viewId?: string) => void;
  /** Deep-link from notification bell — remount even if module/view already active. */
  openFromNotification?: (moduleId: string, viewId?: string) => void;
  navigateTo?: (moduleId: string, viewId?: string) => void;
  erpNavigation?: boolean;
  modulesWithDrafts?: ReadonlySet<string>;
  closeAllWindows: () => void;
  permissions: UserPermissions;
  isAdmin: boolean;
  visibleShellModules?: string[] | null;
  currentUserEmail: string;
  currentUserName?: string | null;
  onLogout: () => void | Promise<void>;
}

const utilityBtnCls =
  'flex items-center justify-center gap-1.5 h-9 px-2.5 rounded-lg text-sm font-medium shell-transition';

export function TopNavBar({
  openModuleIds,
  activeModuleId,
  activeViewId = null,
  openWindow,
  openFromNotification,
  navigateTo,
  erpNavigation = false,
  modulesWithDrafts,
  closeAllWindows,
  permissions,
  isAdmin,
  visibleShellModules = null,
  currentUserEmail,
  currentUserName,
  onLogout,
}: TopNavBarProps) {
  const { t, language, setLanguage, dir, theme } = useLanguage();
  const shell = shellTheme(theme);
  const navScrollRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [shellConfirm, setShellConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    action: () => void;
  } | null>(null);

  const navBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const handleNavKeyDown = useCallback((e: React.KeyboardEvent, idx: number, total: number) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = dir === 'rtl' ? (idx - 1 + total) % total : (idx + 1) % total;
      navBtnRefs.current[next]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = dir === 'rtl' ? (idx + 1) % total : (idx - 1 + total) % total;
      navBtnRefs.current[next]?.focus();
    }
  }, [dir]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (userMenuRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.shell-dropdown-panel')) return;
      setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [userMenuOpen]);

  const currentUserLabel = currentUserName?.trim() || currentUserEmail;
  const menuItems = SHELL_NAV_ITEMS.filter((item) =>
    isShellModuleNavVisible(item.id, visibleShellModules),
  );
  const showPurchaseRequests = isShellModuleNavVisible('purchase_requests', visibleShellModules);
  const onModuleNavigate = navigateTo ?? openWindow;

  const handleLangToggle = () => {
    const nextLang = language === 'ar' ? 'en' : 'ar';
    const applyLang = () => persistLanguagePreference(setLanguage, nextLang);
    if (openModuleIds.size > 0 || (erpNavigation && activeModuleId)) {
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
    <header
      className={cn(
        'flex-shrink-0 border-b shell-transition relative overflow-visible',
        SHELL_CHROME_CLASS,
        SHELL_CHROME_Z,
        shell.topNavBar,
        shell.topNavDivider,
      )}
      dir={dir}
      data-no-global-ui-sound
    >
      <div className="flex items-center gap-2 h-[var(--erp-navbar-height,3rem)] px-3 min-w-0">
        <div className={cn('flex items-center gap-2 shrink-0 pe-2 border-e', shell.topNavDivider)}>
          <AppIcon className="w-7 h-7 rounded-md ring-1 ring-[var(--erp-accent-warm)]/25 sm:hidden" />
          <ConcordPlusLogo variant="compact" className="h-9 w-auto hidden sm:block" />
        </div>

        <nav
          ref={navScrollRef}
          className="flex-1 flex items-center gap-1 overflow-x-auto min-w-0 py-1"
          aria-label={language === 'ar' ? 'الوحدات' : 'Modules'}
        >
          {menuItems.map((item, idx) => {
            const isActive = item.id === activeModuleId;
            const isOpen = openModuleIds.has(item.id);
            const canEnter = canOpenShellModule(permissions, item.id, { isAdmin });
            const deniedTitle = !canEnter
              ? t('shell_module_access_denied').replace('{module}', t(item.labelKey))
              : undefined;
            const canOpenView = (viewId: string) =>
              canOpenModuleView(permissions, item.id, viewId, { isAdmin });
            const viewDeniedTitle = (viewId: string) => {
              if (canOpenView(viewId)) return undefined;
              const permKey = permissionKeyForModuleView(item.id, viewId);
              const permLabel = t(permKey);
              return t('shell_view_access_denied').replace('{view}', t(
                getModuleMenu(item.id)?.views.find((v) => v.viewId === viewId)?.labelKey ?? item.labelKey,
              )).replace('{module}', permLabel);
            };

            if (erpNavigation) {
              return (
                <ModuleNavMenu
                  key={item.id}
                  moduleId={item.id}
                  label={t(item.labelKey)}
                  icon={item.icon}
                  isActive={isActive}
                  isOpen={isOpen}
                  canEnter={canEnter}
                  activeViewId={isActive ? activeViewId : null}
                  hasDraft={modulesWithDrafts?.has(item.id) ?? false}
                  theme={theme}
                  dir={dir}
                  deniedTitle={deniedTitle}
                  translate={t}
                  canOpenView={canOpenView}
                  viewDeniedTitle={viewDeniedTitle}
                  onNavigate={onModuleNavigate}
                  onKeyDown={(e) => handleNavKeyDown(e, idx, menuItems.length)}
                  buttonRef={(el) => { navBtnRefs.current[idx] = el; }}
                />
              );
            }

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
                title={deniedTitle}
                className={cn(
                  'relative flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs whitespace-nowrap shrink-0 erp-nav-entry',
                  shellFocusRing(theme),
                  !canEnter && 'opacity-45 cursor-not-allowed',
                  canEnter && isActive
                    ? cn(shellNavActive(theme), 'erp-nav-entry--active')
                    : canEnter && isOpen
                      ? shell.navOpen
                      : shell.navMuted,
                )}
              >
                <item.icon size={14} className="shrink-0" />
                <span className="font-medium">{t(item.labelKey)}</span>
                {!canEnter && <Lock size={11} className="shrink-0 opacity-70" aria-hidden />}
                {canEnter && !isActive && isOpen && (
                  <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', shellNavOpenDot(theme))} />
                )}
              </button>
            );
          })}
        </nav>

        <div className={cn('flex items-center gap-0.5 shrink-0 ps-2 border-s', shell.topNavDivider)}>
          {(openModuleIds.size > 0 || (erpNavigation && activeModuleId)) && (
            <button
              type="button"
              title={language === 'ar' ? `إغلاق الكل (${openModuleIds.size})` : `Close all (${openModuleIds.size})`}
              onClick={() => {
                setShellConfirm({
                  title: t('shell_confirm_close_all_title'),
                  message: t('shell_confirm_close_all_body').replace('{count}', String(openModuleIds.size)),
                  confirmLabel: t('shell_confirm_close_all_action'),
                  action: () => {
                    playWindowClose();
                    closeAllWindows();
                  },
                });
              }}
              className={cn(utilityBtnCls, shell.topNavUtility, shellFocusRing(theme), 'erp-nav-entry')}
            >
              <X size={15} />
              <span className="hidden lg:inline text-xs">{openModuleIds.size}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => { playNavigate(); openWindow('general'); }}
            className={cn(
              utilityBtnCls,
              shellFocusRing(theme),
              isErpTheme(theme) && 'erp-nav-entry',
              (openModuleIds.has('general') || openModuleIds.has('display')) ? shellNavActive(theme) : shell.topNavUtility,
            )}
            title={t('general_settings')}
          >
            <Palette size={15} />
          </button>

          {showPurchaseRequests && (
            <PurchaseRequestsShellMenu
              openWindow={onModuleNavigate}
              theme={theme}
              variant="topnav"
              isActive={activeModuleId === 'purchase_requests'}
              isOpen={openModuleIds.has('purchase_requests')}
              canCreate={moduleAccess(permissions, 'purchase_requests').create}
              className={isErpTheme(theme) ? 'erp-nav-entry' : undefined}
            />
          )}

          {isElectronShell() && (
            <button
              type="button"
              onClick={() => { playNavigate(); requestOpenNewWindow(); }}
              className={cn(
                utilityBtnCls,
                shell.topNavUtility,
                shellFocusRing(theme),
                isErpTheme(theme) && 'erp-nav-entry',
              )}
              title={`${t('general_new_window')} (${t('general_new_window_shortcut')})`}
            >
              <AppWindow size={15} />
            </button>
          )}

          <button
            type="button"
            onClick={() => { playNavigate(); openWindow('calculator'); }}
            className={cn(
              utilityBtnCls,
              shellFocusRing(theme),
              isErpTheme(theme) && 'erp-nav-entry',
              openModuleIds.has('calculator') ? shellNavActive(theme) : shell.topNavUtility,
            )}
            title={language === 'ar' ? 'الآلة الحاسبة' : 'Calculator'}
          >
            <Calculator size={15} />
          </button>

          <button
            type="button"
            onClick={() => { playNavigate(); openWindow('manual'); }}
            className={cn(
              utilityBtnCls,
              shellFocusRing(theme),
              isErpTheme(theme) && 'erp-nav-entry',
              openModuleIds.has('manual') ? shellNavActive(theme) : shell.topNavUtility,
            )}
            title={t('manual_title')}
          >
            <BookOpen size={15} />
          </button>

          {isLocalBackend && (
            <NotificationBell
              openWindow={openFromNotification ?? openWindow}
              theme={theme}
              variant="topnav"
            />
          )}

          <button
            type="button"
            onClick={handleLangToggle}
            className={cn(utilityBtnCls, shell.topNavUtility, shellFocusRing(theme), isErpTheme(theme) && 'erp-nav-entry')}
            title={language === 'ar' ? 'English' : 'العربية'}
          >
            <Languages size={15} />
          </button>

          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              onClick={() => { playTap(); setUserMenuOpen((v) => !v); }}
              className={cn(
                utilityBtnCls,
                'max-w-[140px]',
                shell.topNavUtility,
                shellFocusRing(theme),
                isErpTheme(theme) && 'erp-nav-entry',
                userMenuOpen && (isErpTheme(theme) ? 'bg-white/15 text-white' : 'bg-[var(--erp-nav-hover)] text-[var(--erp-primary)]'),
              )}
              aria-expanded={userMenuOpen}
              aria-haspopup="menu"
            >
              <UserCircle2 size={16} className="shrink-0" />
              <span className="truncate text-xs hidden md:inline">{currentUserLabel}</span>
              <ChevronDown
                size={14}
                className={cn('shrink-0 shell-transition', userMenuOpen && 'rotate-180')}
              />
            </button>

            <ShellAnchoredDropdown
              open={userMenuOpen}
              anchorRef={userMenuRef}
              dir={dir}
              theme={theme}
              align="end"
              className={cn('min-w-[220px] bg-white py-1', shell.topNavDivider)}
            >
              <div className="px-3 py-2 border-b border-[var(--erp-border)]">
                <p className="text-[10px] font-bold text-[var(--erp-text-muted)]">
                  {language === 'ar' ? 'المستخدم الحالي' : 'Current user'}
                </p>
                <p className="text-sm font-semibold text-[var(--erp-text-heading)] truncate" title={currentUserLabel}>
                  {currentUserLabel}
                </p>
                {currentUserName && currentUserEmail && currentUserName !== currentUserEmail && (
                  <p className="text-[11px] text-[var(--erp-text-muted)] truncate" title={currentUserEmail}>
                    {currentUserEmail}
                  </p>
                )}
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setUserMenuOpen(false);
                  playTap();
                  setShellConfirm({
                    title: language === 'ar' ? 'تأكيد تسجيل الخروج' : 'Confirm Logout',
                    message: isElectronShell() ? t('logout_confirm_desktop') : t('logout_confirm_message'),
                    confirmLabel: t('logout'),
                    action: () => { void onLogout(); },
                  });
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 shell-transition',
                  language === 'ar' ? 'text-right' : 'text-left',
                )}
              >
                <LogOut size={15} />
                {t('logout')}
              </button>
            </ShellAnchoredDropdown>
          </div>
        </div>
      </div>

      <ShellConfirmDialog
        open={shellConfirm !== null}
        onOpenChange={(next) => { if (!next) setShellConfirm(null); }}
        title={shellConfirm?.title ?? ''}
        message={shellConfirm?.message ?? ''}
        confirmLabel={shellConfirm?.confirmLabel ?? t('confirm')}
        cancelLabel={t('cancel')}
        onConfirm={() => shellConfirm?.action()}
        variant="neutral"
        theme={theme}
        dir={dir}
      />
    </header>
  );
}
