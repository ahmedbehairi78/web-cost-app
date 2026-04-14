import React from 'react';
import {
  LayoutDashboard,
  Briefcase,
  FileText,
  Receipt,
  TrendingUp,
  Settings,
  AlertCircle,
  Users,
  BarChart3,
  FolderTree,
  BookOpen,
  Database
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  const { t, language, dir } = useLanguage();

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
    { id: 'migrate', label: 'النسخ الاحتياطي', icon: Database },
  ];

  return (
    <div className={cn(
      "w-64 bg-[#151619] text-white h-screen flex flex-col border-gray-800",
      dir === 'rtl' ? "border-l" : "border-r"
    )} dir={dir}>
      <div className="p-6 border-b border-gray-800">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
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
                : "text-gray-400 hover:bg-gray-800 hover:text-white"
            )}
          >
            <item.icon size={20} />
            <span className="font-medium">{item.label}</span>
          </button>
        ))}
      </nav>
      
      <div className="p-4 border-t border-gray-800">
        <div className="bg-red-900/20 border border-red-900/50 rounded-lg p-3 flex items-start gap-3">
          <AlertCircle className="text-red-500 shrink-0" size={18} />
          <div>
            <p className="text-xs font-bold text-red-400">تنبيه سيولة</p>
            <p className="text-[10px] text-red-300/70 mt-1">تأخر تحصيل مستخلص مشروع "أ"</p>
          </div>
        </div>
      </div>
    </div>
  );
}
