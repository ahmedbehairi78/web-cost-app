import React from 'react';
import {
  LayoutDashboard,
  Briefcase,
  FileText,
  Receipt,
  TrendingUp,
  Settings,
  BarChart3,
  BookOpen,
  LogOut,
  Languages,
  Droplets,
  X,
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { cn } from '../lib/utils';
import { shellTheme, shellInteractiveFocus } from '../lib/shellTheme';
import { useLanguage } from '../context/LanguageContext';
import { type UserPermissions } from '../types';

interface SidebarProps {
  openModuleIds: Set<string>;
  openWindow: (moduleId: string) => void;
  closeAllWindows: () => void;
  permissions: UserPermissions;
  isAdmin: boolean;
}

const ALL_MENU_ITEMS = [
  { id: 'dashboard', labelKey: 'dashboard', icon: LayoutDashboard },
  { id: 'ledger',    labelKey: 'ledger',    icon: BookOpen },
  { id: 'projects',  labelKey: 'projects',  icon: Briefcase },
  { id: 'boq',       labelKey: 'boq',       icon: FileText },
  { id: 'costs',     labelKey: 'costs',     icon: Receipt },
  { id: 'billing',   labelKey: 'billing',   icon: TrendingUp },
  { id: 'reports',   labelKey: 'reports',   icon: BarChart3 },
  { id: 'settings',  labelKey: 'settings',  icon: Settings },
] as const;

export function Sidebar({ openModuleIds, openWindow, closeAllWindows, permissions, isAdmin }: SidebarProps) {
  const { t, language, setLanguage, dir, theme } = useLanguage();
  const shell = shellTheme(theme);

  const menuItems = isAdmin
    ? ALL_MENU_ITEMS
    : ALL_MENU_ITEMS.filter((item) => permissions[item.id as keyof UserPermissions]);

  const borderSide = dir === 'rtl' ? 'border-l' : 'border-r';

  const sidebarCls = cn(
    'w-64 h-screen flex flex-col flex-shrink-0 transition-colors',
    borderSide,
    shell.sidebarSurface,
  );

  const dividerCls = cn('border-b', shell.sidebarDivider);

  const ghostBtnCls = cn(
    'w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
    language === 'ar' ? 'text-right' : 'text-left',
    shell.navMuted,
    shellInteractiveFocus,
  );

  return (
    <div className={sidebarCls} dir={dir}>
      {/* Header */}
      <div className={cn('p-6', dividerCls)}>
        <h1 className={cn('text-xl font-bold flex items-center gap-2', shell.brandHeading)}>
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center flex-shrink-0">
            <Briefcase size={20} />
          </div>
          {language === 'ar' ? 'نظام إدارة التكاليف' : 'Cost Management'}
        </h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {menuItems.map((item) => {
          const isOpen = openModuleIds.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => openWindow(item.id)}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
                language === 'ar' ? 'text-right' : 'text-left',
                shellInteractiveFocus,
                isOpen
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                  : shell.navMuted,
              )}
            >
              <item.icon size={20} className="flex-shrink-0" />
              <span className="font-medium">{t(item.labelKey)}</span>
              {/* Dot indicator: window is open */}
              {isOpen && (
                <span className="ms-auto w-2 h-2 rounded-full bg-white/70 flex-shrink-0" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={cn('p-4 border-t space-y-1', shell.footerTopBorder)}>
        <button
          type="button"
          onClick={() => openWindow('liquidity')}
          className={cn(
            ghostBtnCls,
            openModuleIds.has('liquidity') ? 'bg-blue-600 text-white hover:bg-blue-500' : '',
          )}
        >
          <Droplets size={20} className="flex-shrink-0" />
          <span className="font-medium">{language === 'ar' ? 'تقرير السيولة' : 'Liquidity'}</span>
        </button>

        {openModuleIds.size > 0 && (
          <button
            type="button"
            onClick={() => {
              const msg = language === 'ar'
                ? `هل تريد إغلاق ${openModuleIds.size} نافذة مفتوحة؟ تأكد من حفظ أي بيانات قبل المتابعة.`
                : `Close ${openModuleIds.size} open window(s)? Make sure to save any unsaved data first.`;
              if (window.confirm(msg)) closeAllWindows();
            }}
            className={cn(
              ghostBtnCls,
              shell.closeAllRow,
            )}
          >
            <X size={20} className="flex-shrink-0" />
            <span className="font-medium">
              {language === 'ar' ? `إغلاق الكل (${openModuleIds.size})` : `Close All (${openModuleIds.size})`}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            if (openModuleIds.size > 0) {
              const msg = language === 'ar'
                ? 'يوجد نوافذ مفتوحة. تأكد من حفظ أي تغييرات. سيتم إغلاق جميع النوافذ عند تغيير اللغة. هل تريد المتابعة؟'
                : 'There are open windows. Make sure to save any changes. All windows will be closed when switching language. Continue?';
              if (!window.confirm(msg)) return;
              closeAllWindows();
            }
            setLanguage(language === 'ar' ? 'en' : 'ar');
          }}
          className={ghostBtnCls}
        >
          <Languages size={20} className="flex-shrink-0" />
          <span className="font-medium">{language === 'ar' ? 'English' : 'العربية'}</span>
        </button>
        <button
          type="button"
          onClick={() => signOut(auth)}
          className={cn(
            'w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
            language === 'ar' ? 'text-right' : 'text-left',
            shell.logoutRow,
            shellInteractiveFocus,
          )}
        >
          <LogOut size={20} className="flex-shrink-0" />
          <span className="font-medium">{t('logout')}</span>
        </button>
      </div>
    </div>
  );
}
