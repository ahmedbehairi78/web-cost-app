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
  LogOut
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { cn } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  const { t, language, dir, theme } = useLanguage();

  const menuItems = [
    { id: 'dashboard', label: t('dashboard'), icon: LayoutDashboard },
    { id: 'ledger', label: t('ledger'), icon: BookOpen },
    { id: 'projects', label: t('projects'), icon: Briefcase },
    { id: 'boq', label: t('boq'), icon: FileText },
    { id: 'costs', label: t('costs'), icon: Receipt },
    { id: 'billing', label: t('billing'), icon: TrendingUp },
    { id: 'suppliers', label: t('suppliers'), icon: Users },
    { id: 'reports', label: t('reports'), icon: BarChart3 },
    { id: 'settings', label: t('settings'), icon: Settings },
  ];

  return (
    <div className={cn(
      "w-64 h-screen flex flex-col transition-colors",
      theme === 'dark' ? "bg-[#151619] text-white border-gray-800" : 
      theme === 'soft' ? "bg-white text-[#37474f] border-[#cfd8dc]" :
      "bg-white text-gray-900 border-gray-200",
      dir === 'rtl' ? "border-l" : "border-r"
    )} dir={dir}>
      <div className={cn("p-6 border-b", theme === 'dark' ? "border-gray-800" : theme === 'soft' ? "border-[#cfd8dc]" : "border-gray-200")}>
        <h1 className={cn(
          "text-xl font-bold flex items-center gap-2",
          theme === 'dark' ? "text-white" : "text-gray-900"
        )}>
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
            onClick={() => setActiveTab(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200",
              language === 'ar' ? "text-right" : "text-left",
              activeTab === item.id 
                ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20" 
                : theme === 'dark' 
                  ? "text-gray-400 hover:bg-gray-800 hover:text-white"
                  : theme === 'soft'
                    ? "text-[#546e7a] hover:bg-[#eceff1] hover:text-[#37474f]"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            )}
          >
            <item.icon size={20} />
            <span className="font-medium">{item.label}</span>
          </button>
        ))}
      </nav>
      
      <div className={cn(
        "p-4 border-t",
        theme === 'dark' ? "border-gray-800" : theme === 'soft' ? "border-[#cfd8dc]" : "border-gray-200"
      )}>
        <button
          type="button"
          onClick={() => signOut(auth)}
          className={cn(
            "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200",
            language === 'ar' ? "text-right" : "text-left",
            theme === 'dark'
              ? "text-gray-400 hover:bg-red-900/30 hover:text-red-400"
              : theme === 'soft'
                ? "text-[#546e7a] hover:bg-red-50 hover:text-red-500"
                : "text-gray-500 hover:bg-red-50 hover:text-red-500"
          )}
        >
          <LogOut size={20} />
          <span className="font-medium">{t('logout')}</span>
        </button>
      </div>
    </div>
  );
}
