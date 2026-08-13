import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../lib/utils';
import { shellTheme, shellFocusRing, type AppTheme } from '../lib/shellTheme';
import { useLanguage } from '../context/LanguageContext';
import { usePermissions } from '../context/PermissionsContext';
import { playTap } from '../lib/uiSound';
import type { AppNotificationItem } from '../types';
import { notificationsApi } from '../services/local/modulesApi';
import {
  applyNotificationNavigationPending,
  canNavigateToNotificationTarget,
  resolveNotificationNavigation,
} from '../lib/notificationNavigation';
import { permissionKeyForModuleView } from '../lib/moduleViewPermissions';
import { MODULE_LABELS } from '../constants/modules';
import { notifyDesktopUrgent } from '../lib/electronShell';
import {
  applyHostedSpaUpdate,
  buildSpaUpdateNotificationItem,
  isSpaUpdateAvailable,
  isSpaUpdateNotificationType,
  subscribeSpaUpdateAvailable,
} from '../lib/spaBuild';
import { ShellAnchoredDropdown } from './ShellAnchoredDropdown';

const POLL_MS = 90_000;

interface NotificationBellProps {
  openWindow: (moduleId: string, viewId?: string) => void;
  theme: AppTheme | string;
  variant?: 'sidebar' | 'topnav';
}

export function NotificationBell({ openWindow, theme, variant = 'sidebar' }: NotificationBellProps) {
  const { t, language, dir } = useLanguage();
  const { permissions, isAdmin } = usePermissions();
  const shell = shellTheme(theme as AppTheme);
  const isTopNav = variant === 'topnav';
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [spaUpdate, setSpaUpdate] = useState(isSpaUpdateAvailable);
  const [applyingSpa, setApplyingSpa] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await notificationsApi.feed();
      setItems(data.items);
      setUnreadCount(data.unreadCount);
      for (const item of data.items) {
        if (item.priority === 'urgent' && !item.read) {
          const title = language === 'ar' ? item.titleAr : item.titleEn;
          notifyDesktopUrgent(title, t('notifications_title'), item.key);
        }
      }
    } catch {
      /* ignore when API unavailable */
    } finally {
      setLoading(false);
    }
  }, [language, t]);

  useEffect(() => subscribeSpaUpdateAvailable(() => setSpaUpdate(true)), []);

  useEffect(() => {
    if (!spaUpdate) return;
    const item = buildSpaUpdateNotificationItem();
    const title = language === 'ar' ? item.titleAr : item.titleEn;
    notifyDesktopUrgent(title, t('notifications_title'), item.key);
  }, [spaUpdate, language, t]);

  const displayItems = spaUpdate
    ? [buildSpaUpdateNotificationItem(), ...items.filter((i) => !isSpaUpdateNotificationType(i.type))]
    : items;
  const displayUnread = unreadCount + (spaUpdate ? 1 : 0);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    const onForceRefresh = () => void refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('notifications:refresh', onForceRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('notifications:refresh', onForceRefresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      // Portal panel lives under document.body — do not close before item activation.
      if (target instanceof Element && target.closest('.shell-dropdown-panel')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocPointer);
    return () => document.removeEventListener('mousedown', onDocPointer);
  }, [open]);

  const handleOpenItem = useCallback((item: AppNotificationItem) => {
    playTap();
    setOpen(false);

    if (isSpaUpdateNotificationType(item.type)) {
      if (applyingSpa) return;
      setApplyingSpa(true);
      toast.loading(t('notifications_spa_update_applying'), { id: 'spa-update' });
      void applyHostedSpaUpdate();
      return;
    }

    const target = resolveNotificationNavigation(item);
    if (!canNavigateToNotificationTarget(permissions, target, { isAdmin })) {
      const permKey = permissionKeyForModuleView(target.moduleId, target.viewId);
      const labels = MODULE_LABELS[permKey] ?? MODULE_LABELS[target.moduleId];
      const moduleName = labels
        ? (language === 'ar' ? labels.ar : labels.en)
        : permKey;
      toast.error(
        t('shell_module_access_denied').replace('{module}', moduleName),
        { id: `notif-denied-${item.key}` },
      );
      return;
    }

    applyNotificationNavigationPending(item, target);
    void notificationsApi.markRead([item.key]).then(() => void refresh());
    openWindow(target.moduleId, target.viewId);
  }, [permissions, isAdmin, language, t, openWindow, refresh, applyingSpa]);

  const handleDismiss = (item: AppNotificationItem, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    playTap();
    void notificationsApi.dismiss([item.key]).then(() => void refresh());
  };

  const priorityDot = (priority: AppNotificationItem['priority']) => {
    if (priority === 'urgent') return 'bg-red-500';
    if (priority === 'normal') return 'bg-amber-400';
    return 'bg-gray-500';
  };

  const ghostBtnCls = cn(
    isTopNav
      ? 'flex items-center justify-center h-9 w-9 rounded-lg shell-transition'
      : 'w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm shell-transition',
    !isTopNav && (language === 'ar' ? 'text-right' : 'text-left'),
    isTopNav ? shell.topNavUtility : shell.navMuted,
    shellFocusRing(theme as AppTheme),
    open && (isTopNav ? 'bg-[var(--erp-nav-hover)] text-[var(--erp-primary)]' : shell.navOpen),
  );

  const panelClassName = cn(
    'w-80 max-h-96 overflow-hidden shadow-2xl flex flex-col py-0',
    theme === 'dark'
      ? 'bg-[#1a1d23] border-gray-700 text-white'
      : 'bg-white border-gray-200 text-gray-900',
  );

  const list = (
    <>
      <div className={cn(
        'flex items-center justify-between px-3 py-2 border-b text-sm font-semibold',
        theme === 'dark' ? 'border-gray-700' : 'border-gray-200',
      )}
      >
        <span>{t('notifications_title')}</span>
        {loading && <span className="text-xs opacity-60">…</span>}
      </div>
      <div className="overflow-y-auto flex-1">
        {displayItems.length === 0 ? (
          <p className="text-sm text-center py-8 opacity-60 px-4">{t('notifications_empty')}</p>
        ) : (
          displayItems.map((item, ni) => (
            <div
              key={item.key || `notif-${ni}`}
              role="button"
              tabIndex={0}
              onMouseDown={(e) => {
                // Activate on mousedown so navigation wins over outside-close handlers.
                if (e.button !== 0) return;
                if ((e.target as HTMLElement).closest('[data-notif-dismiss]')) return;
                e.preventDefault();
                e.stopPropagation();
                handleOpenItem(item);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleOpenItem(item);
                }
              }}
              className={cn(
                'w-full text-start px-3 py-2.5 border-b transition-colors flex gap-2 items-start group cursor-pointer',
                theme === 'dark'
                  ? 'border-gray-800 hover:bg-gray-800/60'
                  : 'border-gray-100 hover:bg-gray-50',
                !item.read && (theme === 'dark' ? 'bg-blue-950/20' : 'bg-blue-50/50'),
              )}
            >
              <span className={cn('mt-1.5 w-2 h-2 rounded-full shrink-0', priorityDot(item.priority))} />
              <span className="flex-1 min-w-0">
                <span className="text-sm leading-snug block">
                  {language === 'ar' ? item.titleAr : item.titleEn}
                </span>
                {item.dueAt && (
                  <span className="text-[10px] opacity-60 mt-0.5 block">
                    {t('notifications_due')}: {item.dueAt}
                  </span>
                )}
              </span>
              {!isSpaUpdateNotificationType(item.type) && (
              <button
                type="button"
                data-notif-dismiss
                title={t('notifications_dismiss')}
                onMouseDown={(e) => handleDismiss(item, e)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-black/10 shrink-0"
              >
                <X size={12} />
              </button>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );

  return (
    <div className={cn('relative', isTopNav ? '' : 'w-full')} ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          playTap();
          setOpen((v) => !v);
          if (!open) void refresh();
        }}
        className={ghostBtnCls}
        title={t('notifications')}
        aria-expanded={open}
      >
        <span className="relative flex-shrink-0">
          <Bell size={isTopNav ? 16 : 14} />
          {displayUnread > 0 && (
            <span className="absolute -top-1.5 -end-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {displayUnread > 99 ? '99+' : displayUnread}
            </span>
          )}
        </span>
        {!isTopNav && <span className="font-medium">{t('notifications')}</span>}
      </button>

      <ShellAnchoredDropdown
        open={open}
        anchorRef={rootRef}
        dir={dir}
        theme={theme as AppTheme}
        align="end"
        className={panelClassName}
      >
        {list}
      </ShellAnchoredDropdown>
    </div>
  );
}
