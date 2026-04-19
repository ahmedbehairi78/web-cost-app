import React, { useState, useEffect } from 'react';
import { 
  Settings as SettingsIcon, 
  Database, 
  Users, 
  Monitor, 
  Languages, 
  Printer, 
  Shield, 
  Save, 
  User,
  Globe,
  Palette,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { collection, onSnapshot, query, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { accountingService } from '../services/accountingService';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';
import firebaseConfig from '../../firebase-applet-config.json';

export function Settings() {
  const { language, setLanguage, theme, setTheme, dir, t } = useLanguage();
  const [activeSection, setActiveSection] = useState('database');
  const [loading, setLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<string>('user');
  const [seedingAccounts, setSeedingAccounts] = useState(false);
  const [seedResult, setSeedResult] = useState<{ created: number } | null>(null);

  // Print Settings State
  const [printSettings, setPrintSettings] = useState({
    companyName: '',
    taxId: '',
    headerLogo: 'https://picsum.photos/seed/construction/200/200',
    footerText: ''
  });

  useEffect(() => {
    const fetchSettings = async () => {
      const settingsDoc = await getDoc(doc(db, 'settings', 'company_info'));
      if (settingsDoc.exists()) {
        setPrintSettings(settingsDoc.data() as any);
      } else {
        // Defaults
        setPrintSettings({
          companyName: language === 'ar' ? 'شركة النيل للمقاولات والاستثمار العقاري' : 'Nile Construction & Real Estate',
          taxId: '123-456-789',
          headerLogo: 'https://picsum.photos/seed/construction/200/200',
          footerText: language === 'ar' ? 'نظام إدارة التكاليف - جميع الحقوق محفوظة © 2024' : 'Cost Management System - All Rights Reserved © 2024'
        });
      }
    };
    fetchSettings();
  }, [language]);

  useEffect(() => {
    const fetchUserRole = async () => {
      if (auth.currentUser) {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          setCurrentUserRole(userDoc.data().role || 'user');
        }
      }
    };
    fetchUserRole();
  }, []);

  const handleSeedAccounts = async () => {
    setSeedingAccounts(true);
    setSeedResult(null);
    try {
      const created = await accountingService.seedChartOfAccounts();
      setSeedResult({ created });
      setTimeout(() => setSeedResult(null), 5000);
    } catch (error) {
      console.error('Seed error:', error);
    } finally {
      setSeedingAccounts(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await updateDoc(doc(db, 'settings', 'company_info'), printSettings);
    } catch (error) {
      // If doc doesn't exist, set it
      try {
        const { setDoc } = await import('firebase/firestore');
        await setDoc(doc(db, 'settings', 'company_info'), printSettings);
      } catch (e) {
        console.error("Error saving settings:", e);
      }
    }
    setLoading(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const sections = [
    { id: 'database', label: t('database_settings'), icon: Database },
    { id: 'users', label: t('user_settings'), icon: Users },
    { id: 'display', label: t('display_settings'), icon: Monitor },
    { id: 'language', label: t('language_settings'), icon: Languages },
    { id: 'print', label: t('print_settings'), icon: Printer },
  ];

  return (
    <div className={cn("p-8 min-h-screen transition-colors", theme === 'dark' ? "bg-[#0a0a0a] text-gray-100" : "bg-gray-50 text-gray-900")} dir={dir}>
      <header className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t('settings')}</h2>
          <p className="text-gray-400 mt-1">{language === 'ar' ? 'تخصيص بيئة العمل، إدارة الصلاحيات، وضبط المخرجات' : 'Customize workspace, manage permissions, and adjust outputs'}</p>
        </div>
        <button 
          onClick={handleSave}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 px-6 py-2 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg shadow-blue-900/20 text-white"
        >
          {loading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
          {saveSuccess ? (language === 'ar' ? 'تم الحفظ بنجاح' : 'Saved Successfully') : t('save')}
        </button>
      </header>

      <div className="flex gap-8">
        {/* Sidebar Navigation */}
        <div className="w-64 space-y-2">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
                language === 'ar' ? "text-right" : "text-left",
                activeSection === section.id 
                  ? "bg-blue-600/10 text-blue-500 border border-blue-600/20 shadow-inner" 
                  : cn(
                      "text-gray-400",
                      theme === 'dark' ? "hover:bg-gray-900 hover:text-gray-200" : 
                      theme === 'soft' ? "hover:bg-[#cfd8dc] hover:text-[#37474f]" : 
                      "hover:bg-gray-200 hover:text-gray-900"
                    )
              )}
            >
              <section.icon size={20} />
              <span className="font-bold text-sm">{section.label}</span>
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className={cn("flex-1 border rounded-2xl p-8 shadow-xl", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200")}>
          <AnimatePresence mode="wait">
            {activeSection === 'database' && (
              <motion.div
                key="database"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-blue-900/20 rounded-lg text-blue-500">
                    <Database size={24} />
                  </div>
                  <h3 className="text-xl font-bold">{language === 'ar' ? 'اتصال قاعدة البيانات (Firebase)' : 'Database Connection (Firebase)'}</h3>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div className={cn("p-4 border rounded-xl", theme === 'dark' ? "bg-gray-900/50 border-gray-800" : "bg-gray-50 border-gray-200")}>
                    <p className="text-xs text-gray-500 font-bold uppercase mb-2">Project ID</p>
                    <code className="text-blue-400 font-mono">{firebaseConfig.projectId}</code>
                  </div>
                  <div className={cn("p-4 border rounded-xl", theme === 'dark' ? "bg-gray-900/50 border-gray-800" : "bg-gray-50 border-gray-200")}>
                    <p className="text-xs text-gray-500 font-bold uppercase mb-2">Database ID</p>
                    <code className="text-green-400 font-mono">{firebaseConfig.firestoreDatabaseId || '(default)'}</code>
                  </div>

                  <div className={cn("p-6 border rounded-xl space-y-4", theme === 'dark' ? "bg-gray-900/50 border-gray-800" : "bg-gray-50 border-gray-200")}>
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-yellow-900/20 rounded-lg text-yellow-500 shrink-0">
                        <FileText size={20} />
                      </div>
                      <div>
                        <h4 className="font-bold text-sm">{language === 'ar' ? 'دليل الحسابات الافتراضي' : 'Default Chart of Accounts'}</h4>
                        <p className="text-xs text-gray-500 mt-1">
                          {language === 'ar'
                            ? 'يقوم بإضافة الحسابات المحاسبية الافتراضية للمشروع (أصول، خصوم، إيرادات، مصروفات). لن يؤثر على الحسابات الموجودة.'
                            : 'Seeds the default chart of accounts (assets, liabilities, revenue, expenses). Will not overwrite existing accounts.'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleSeedAccounts}
                        disabled={seedingAccounts}
                        className="bg-yellow-600 hover:bg-yellow-500 disabled:bg-yellow-900 disabled:text-yellow-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2"
                      >
                        {seedingAccounts
                          ? <><Loader2 className="animate-spin" size={16} />{language === 'ar' ? 'جاري الإضافة...' : 'Seeding...'}</>
                          : <><Database size={16} />{language === 'ar' ? 'إضافة الحسابات الافتراضية' : 'Seed Default Accounts'}</>
                        }
                      </button>

                      {seedResult !== null && (
                        <span className={cn(
                          "flex items-center gap-1.5 text-sm font-medium",
                          seedResult.created > 0 ? "text-green-500" : "text-gray-400"
                        )}>
                          <CheckCircle2 size={16} />
                          {seedResult.created > 0
                            ? (language === 'ar' ? `تمت إضافة ${seedResult.created} حساباً` : `${seedResult.created} accounts added`)
                            : (language === 'ar' ? 'جميع الحسابات موجودة بالفعل' : 'All accounts already exist')
                          }
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeSection === 'users' && (
              <motion.div
                key="users"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-purple-900/20 rounded-lg text-purple-500">
                    <Users size={24} />
                  </div>
                  <h3 className="text-xl font-bold">{t('user_settings')}</h3>
                </div>

                <div className="space-y-4">
                  <div className={cn("p-6 border rounded-2xl flex items-center justify-between", theme === 'dark' ? "bg-gray-900/50 border-gray-800" : "bg-gray-50 border-gray-200")}>
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center font-bold text-xl text-white">
                        {auth.currentUser?.email?.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h4 className="font-bold">{auth.currentUser?.email}</h4>
                        <p className="text-xs text-gray-500 mt-1">{language === 'ar' ? 'الدور الحالي:' : 'Current Role:'} <span className="text-blue-400 font-bold">{currentUserRole === 'admin' ? (language === 'ar' ? 'مدير نظام' : 'Admin') : (language === 'ar' ? 'مستخدم' : 'User')}</span></p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeSection === 'display' && (
              <motion.div
                key="display"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-orange-900/20 rounded-lg text-orange-500">
                    <Palette size={24} />
                  </div>
                  <h3 className="text-xl font-bold">{t('display_settings')}</h3>
                </div>

                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                      { id: 'light', label: t('light_mode'), icon: Monitor, color: 'bg-white text-gray-900 border-gray-200' },
                      { id: 'soft', label: t('soft_mode'), icon: Palette, color: 'bg-[#eceff1] text-[#37474f] border-[#cfd8dc]' },
                      { id: 'dark', label: t('dark_mode'), icon: Loader2, color: 'bg-[#0a0a0a] text-gray-100 border-gray-800' }
                    ].map((mode) => (
                      <button
                        key={mode.id}
                        onClick={() => setTheme(mode.id as any)}
                        className={cn(
                          "relative p-6 rounded-2xl border-2 transition-all flex flex-col items-center gap-3",
                          mode.color,
                          theme === mode.id ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-[#151619] border-transparent" : "opacity-60 grayscale hover:grayscale-0 hover:opacity-100"
                        )}
                      >
                        {theme === mode.id && (
                          <div className="absolute top-2 right-2 text-blue-500">
                            <CheckCircle2 size={16} />
                          </div>
                        )}
                        <mode.icon size={32} />
                        <span className="font-bold text-sm">{mode.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {activeSection === 'language' && (
              <motion.div
                key="language"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-green-900/20 rounded-lg text-green-500">
                    <Globe size={24} />
                  </div>
                  <h3 className="text-xl font-bold">{t('language_settings')}</h3>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'لغة النظام' : 'System Language'}</label>
                    <select 
                      value={language}
                      onChange={(e) => setLanguage(e.target.value as any)}
                      className={cn(
                        "w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors appearance-none", 
                        theme === 'dark' ? "bg-gray-900 border-gray-800" : 
                        theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
                        "bg-white border-gray-200"
                      )}
                    >
                      <option value="ar">العربية (Arabic)</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                </div>
              </motion.div>
            )}

            {activeSection === 'print' && (
              <motion.div
                key="print"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-red-900/20 rounded-lg text-red-500">
                    <Printer size={24} />
                  </div>
                  <h3 className="text-xl font-bold">{t('print_settings')}</h3>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'اسم الشركة' : 'Company Name'}</label>
                    <input 
                      type="text" 
                      className={cn(
                        "w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors", 
                        theme === 'dark' ? "bg-gray-900 border-gray-800" : 
                        theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
                        "bg-white border-gray-200"
                      )}
                      value={printSettings.companyName}
                      onChange={(e) => setPrintSettings({...printSettings, companyName: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'الرقم الضريبي' : 'Tax ID'}</label>
                    <input 
                      type="text" 
                      className={cn(
                        "w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors", 
                        theme === 'dark' ? "bg-gray-900 border-gray-800" : 
                        theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
                        "bg-white border-gray-200"
                      )}
                      value={printSettings.taxId}
                      onChange={(e) => setPrintSettings({...printSettings, taxId: e.target.value})}
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
