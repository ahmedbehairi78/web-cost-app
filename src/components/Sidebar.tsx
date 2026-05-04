import React from 'react';
import {
  LayoutDashboard,
  Briefcase,
  FileText,
  Receipt,
  TrendingUp,
  Settings,
  Users,
  BarChart3,
  BookOpen,
  LogOut,
  Languages,
  Droplets,
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { cn } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';
import { type UserPermissions } from '../types';

interface SidebarProps {
  openModuleIds: Set<string>;
  openWindow: (moduleId: string) => void;
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
  { id: 'suppliers', labelKey: 'suppliers', icon: Users },
  { id: 'reports',   labelKey: 'reports',   icon: BarChart3 },
  { id: 'settings',  labelKey: 'settings',  icon: Settings },
] as const;

export function Sidebar({ openModuleIds, openWindow, permissions, isAdmin }: SidebarProps) {
  const { t, language, setLanguage, dir, theme } = useLanguage();

  const menuItems = isAdmin
    ? ALL_MENU_ITEMS
    : ALL_MENU_ITEMS.filter((item) => permissions[item.id as keyof UserPermissions]);

  const borderSide = dir === 'rtl' ? 'border-l' : 'border-r';

  const sidebarCls = cn(
    'w-64 h-screen flex flex-col flex-shrink-0 transition-colors',
    borderSide,
    theme === 'dark'
      ? 'bg-[#151619] text-white border-gray-800'
      : theme === 'soft'
        ? 'bg-white text-[#37474f] border-[#cfd8dc]'
        : 'bg-white text-gray-900 border-gray-200',
  );

  const dividerCls = cn(
    'border-b',
    theme === 'dark' ? 'border-gray-800' : theme === 'soft' ? 'border-[#cfd8dc]' : 'border-gray-200',
  );

  const ghostBtnCls = cn(
    'w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
    language === 'ar' ? 'text-right' : 'text-left',
    theme === 'dark'
      ? 'text-gray-400 hover:bg-gray-800 hover:text-white'
      : theme === 'soft'
        ? 'text-[#546e7a] hover:bg-[#eceff1] hover:text-[#37474f]'
        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
  );

  return (
    <div className={sidebarCls} dir={dir}>
      {/* Header */}
      <div className={cn('p-6', dividerCls)}>
        <h1 className={cn('text-xl font-bold flex items-center gap-2',
          theme === 'dark' ? 'text-white' : 'text-gray-900')}>
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
                isOpen
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                  : theme === 'dark'
                    ? 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    : theme === 'soft'
                      ? 'text-[#546e7a] hover:bg-[#eceff1] hover:text-[#37474f]'
                      : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
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
      <div className={cn('p-4 border-t space-y-1',
        theme === 'dark' ? 'border-gray-800' : theme === 'soft' ? 'border-[#cfd8dc]' : 'border-gray-200')}>
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
        <button
          type="button"
          onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
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
            theme === 'dark'
              ? 'text-gray-400 hover:bg-red-900/30 hover:text-red-400'
              : theme === 'soft'
                ? 'text-[#546e7a] hover:bg-red-50 hover:text-red-500'
                : 'text-gray-500 hover:bg-red-50 hover:text-red-500',
          )}
        >
          <LogOut size={20} className="flex-shrink-0" />
          <span className="font-medium">{t('logout')}</span>
        </button>
      </div>
    </div>
  );
}
