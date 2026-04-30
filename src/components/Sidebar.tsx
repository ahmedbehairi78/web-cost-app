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
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { cn } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';
import { type UserPermissions } from '../types';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
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

export function Sidebar({ activeTab, setActiveTab, permissions, isAdmin }: SidebarProps) {
  const { t, language, setLanguage, dir, theme } = useLanguage();

  // Admins always see all modules; regular users see only permitted ones
  const menuItems = isAdmin
    ? ALL_MENU_ITEMS
    : ALL_MENU_ITEMS.filter((item) => permissions[item.id as keyof UserPermissions]);

  return (
    <div
      className={cn(
        'w-64 h-screen flex flex-col transition-colors',
        theme === 'dark'
          ? 'bg-[#151619] text-white border-gray-800'
          : theme === 'soft'
            ? 'bg-white text-[#37474f] border-[#cfd8dc]'
            : 'bg-white text-gray-900 border-gray-200',
        dir === 'rtl' ? 'border-l' : 'border-r'
      )}
      dir={dir}
    >
      <div
        className={cn(
          'p-6 border-b',
          theme === 'dark' ? 'border-gray-800' : theme === 'soft' ? 'border-[#cfd8dc]' : 'border-gray-200'
        )}
      >
        <h1
          className={cn(
            'text-xl font-bold flex items-center gap-2',
            theme === 'dark' ? 'text-white' : 'text-gray-900'
          )}
        >
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">
            <Briefcase size={20} />
          </div>
          {language === 'ar' ? 'نظام إدارة التكاليف' : 'Cost Management'}
        </h1>
      </div>

      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {menuItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id)}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
              language === 'ar' ? 'text-right' : 'text-left',
              activeTab === item.id
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                : theme === 'dark'
                  ? 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  : theme === 'soft'
                    ? 'text-[#546e7a] hover:bg-[#eceff1] hover:text-[#37474f]'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
            )}
          >
            <item.icon size={20} />
            <span className="font-medium">{t(item.labelKey)}</span>
          </button>
        ))}
      </nav>

      <div
        className={cn(
          'p-4 border-t space-y-2',
          theme === 'dark' ? 'border-gray-800' : theme === 'soft' ? 'border-[#cfd8dc]' : 'border-gray-200'
        )}
      >
        <button
          type="button"
          onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
          className={cn(
            'w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
            language === 'ar' ? 'text-right' : 'text-left',
            theme === 'dark'
              ? 'text-gray-400 hover:bg-gray-800 hover:text-white'
              : theme === 'soft'
                ? 'text-[#546e7a] hover:bg-[#eceff1] hover:text-[#37474f]'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
          )}
        >
          <Languages size={20} />
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
                : 'text-gray-500 hover:bg-red-50 hover:text-red-500'
          )}
        >
          <LogOut size={20} />
          <span className="font-medium">{t('logout')}</span>
        </button>
      </div>
    </div>
  );
}
