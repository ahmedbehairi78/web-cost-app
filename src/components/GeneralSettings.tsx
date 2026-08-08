import React, { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { type AppTheme, isSoftLikeTheme } from '../lib/shellTheme';
import { shellModulePageCls } from '../lib/erpShell';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';
import {
  Monitor,
  Settings2,
  Languages,
  CheckCircle2,
  Loader2,
  SunMedium,
  LayoutTemplate,
  Palette,
} from 'lucide-react';
import { STARTUP_MODULES, DEFAULT_MODULE, NONE_DEFAULT_MODULE } from '../constants/modules';
import toast from 'react-hot-toast';
import { playToggle } from '../lib/uiSound';
import { PrintSettingsPanel } from './settings/PrintSettingsPanel';
import { ManualHelpButton } from './help/ManualHelpButton';
import { usePermissions } from '../context/PermissionsContext';
import {
  saveUserPreferences,
  canPersistUserPreferences,
  emitUserPrefsUpdated,
  loadDefaultModulePreference,
  USER_PREFS_UPDATED_EVENT,
} from '../lib/userPreferences';
import { ApiError } from '../lib/apiClient';

const THEME_CARDS: {
  id: AppTheme;
  labelKey: 'dark_mode' | 'soft_mode' | 'light_mode' | 'erp_mode';
  preview: string;
  icon: typeof Monitor;
}[] = [
  {
    id: 'dark',
    labelKey: 'dark_mode',
    preview: 'bg-[#1a1110] text-gray-100 border-gray-800',
    icon: Monitor,
  },
  {
    id: 'soft',
    labelKey: 'soft_mode',
    preview: 'bg-[#b7c0c7] text-[#37474f] border-[#cfd8dc]',
    icon: Palette,
  },
  {
    id: 'light',
    labelKey: 'light_mode',
    preview: 'bg-white text-gray-900 border-gray-200',
    icon: SunMedium,
  },
  {
    id: 'erp',
    labelKey: 'erp_mode',
    preview: 'bg-[#E3ECF3] text-[#003B71] border-[#F58220]/40',
    icon: LayoutTemplate,
  },
];

export function GeneralSettings() {
  const { language, setLanguage, theme, setTheme, dir, t } = useLanguage();
  const { isAdmin } = usePermissions();

  const [themeSaving, setThemeSaving] = useState(false);
  const [defaultModule, setDefaultModule] = useState<string>(DEFAULT_MODULE);
  const [moduleSaving, setModuleSaving] = useState(false);
  const [languageSaving, setLanguageSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const moduleId = await loadDefaultModulePreference();
        if (!cancelled) setDefaultModule(moduleId);
      } catch {
        // best-effort — theme/language applied on login via App.tsx
      }
    };
    const onPrefsUpdated = () => {
      void load();
    };
    void load();
    window.addEventListener(USER_PREFS_UPDATED_EVENT, onPrefsUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(USER_PREFS_UPDATED_EVENT, onPrefsUpdated);
    };
  }, []);

  const handleThemeChange = async (newTheme: AppTheme) => {
    const prev = theme;
    setTheme(newTheme);
    if (!canPersistUserPreferences()) {
      setTheme(prev);
      toast.error(t('error_save_theme'));
      return;
    }
    setThemeSaving(true);
    try {
      await saveUserPreferences({ defaultTheme: newTheme });
    } catch (err) {
      setTheme(prev);
      toast.error(err instanceof ApiError ? err.message : t('error_save_theme'));
    } finally {
      setThemeSaving(false);
    }
  };

  const handleLanguageChange = async (lang: 'ar' | 'en') => {
    if (language === lang) return;
    playToggle();
    const prev = language;
    setLanguage(lang);
    if (!canPersistUserPreferences()) {
      setLanguage(prev);
      toast.error(t('error_saving'));
      return;
    }
    setLanguageSaving(true);
    try {
      await saveUserPreferences({ defaultLanguage: lang });
    } catch (err) {
      setLanguage(prev);
      toast.error(err instanceof ApiError ? err.message : t('error_saving'));
    } finally {
      setLanguageSaving(false);
    }
  };

  const handleDefaultModuleChange = async (moduleId: string) => {
    const prev = defaultModule;
    setDefaultModule(moduleId);
    if (!canPersistUserPreferences()) {
      setDefaultModule(prev);
      toast.error(t('error_saving'));
      return;
    }
    setModuleSaving(true);
    try {
      await saveUserPreferences({ defaultModule: moduleId });
      emitUserPrefsUpdated({ defaultModule: moduleId });
      toast.success(t('saved_successfully'));
    } catch (err) {
      setDefaultModule(prev);
      toast.error(err instanceof ApiError ? err.message : t('error_saving'));
    } finally {
      setModuleSaving(false);
    }
  };

  const surface = theme === 'dark'
    ? 'bg-[#1a1110] text-gray-100'
    : shellModulePageCls(
        theme,
        isSoftLikeTheme(theme)
          ? 'bg-[#eceff1] text-[#37474f] min-h-full'
          : 'bg-gray-50 text-gray-900 min-h-full',
      );

  const cardSurface = theme === 'dark'
    ? 'bg-[#151619] border-gray-800'
    : theme === 'erp'
    ? 'bg-white border-[#DEE2E6]'
    : isSoftLikeTheme(theme)
    ? 'bg-white border-[#cfd8dc]'
    : 'bg-white border-gray-200';

  const selectCls = cn(
    'w-full rounded-xl border px-4 py-2.5 text-sm font-medium shell-transition focus:outline-none focus:ring-2',
    theme === 'erp' ? 'focus:ring-[var(--erp-accent-warm)]' : 'focus:ring-blue-500',
    theme === 'dark'
      ? 'bg-gray-800 border-gray-600 text-white'
      : theme === 'erp'
      ? 'bg-white border-[#DEE2E6] text-[#212529]'
      : isSoftLikeTheme(theme)
      ? 'bg-white border-[#b0bec5] text-[#37474f]'
      : 'bg-gray-50 border-gray-300 text-gray-900',
  );

  const inputCls = cn(
    'w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark'
      ? 'bg-gray-900 border-gray-800 text-white'
      : theme === 'erp'
      ? 'bg-white border-[#DEE2E6] text-[#212529]'
      : isSoftLikeTheme(theme)
      ? 'bg-white border-[#cfd8dc] text-[#37474f]'
      : 'bg-white border-gray-200 text-gray-900',
  );

  const mutedText = theme === 'dark' ? 'text-gray-500' : 'text-gray-400';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('p-8', surface, theme === 'erp' && 'text-[#212529]')}
      dir={dir}
    >
      <motion.div className="max-w-2xl mx-auto space-y-8">
        <motion.div className="flex items-center gap-3">
          <motion.div className="p-2.5 bg-orange-500/15 rounded-xl text-orange-400">
            <Settings2 size={26} />
          </motion.div>
          <motion.div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-black">{t('general_settings')}</h2>
              <ManualHelpButton topicId="settings.display.preferences" size={16} />
            </div>
            <p className={cn('text-sm mt-0.5', mutedText)}>{t('general_settings_subtitle')}</p>
          </motion.div>
        </motion.div>

        <motion.div className={cn('rounded-2xl border p-6 space-y-4', cardSurface)}>
          <motion.div className="flex items-center gap-2">
            <Monitor size={18} className="text-blue-400" />
            <span className="font-bold">{t('interface_theme')}</span>
          </motion.div>

          <motion.div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {THEME_CARDS.map((mode) => {
              const isActive = theme === mode.id;
              const ringOffset = theme === 'dark'
                ? 'ring-offset-[#151619]'
                : theme === 'erp'
                ? 'ring-offset-[#F0F0F0]'
                : 'ring-offset-gray-50';
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => void handleThemeChange(mode.id)}
                  disabled={themeSaving}
                  className={cn(
                    'relative p-4 sm:p-5 rounded-2xl border-2 flex flex-col items-center gap-2 sm:gap-3 shell-transition disabled:cursor-wait',
                    mode.preview,
                    isActive
                      ? cn(
                          'ring-2 border-transparent opacity-100 grayscale-0',
                          mode.id === 'erp' ? 'ring-[var(--erp-primary)] ring-offset-2' : 'ring-blue-500 ring-offset-2',
                          ringOffset,
                        )
                      : 'opacity-55 grayscale hover:grayscale-0 hover:opacity-100',
                  )}
                >
                  {isActive && (
                    <div className={cn('absolute top-2 end-2', mode.id === 'erp' ? 'text-[var(--erp-primary)]' : 'text-blue-500')}>
                      {themeSaving
                        ? <Loader2 size={14} className="animate-spin" />
                        : <CheckCircle2 size={14} />}
                    </div>
                  )}
                  <mode.icon size={30} />
                  <span className="font-bold text-xs text-center leading-tight">
                    {t(mode.labelKey)}
                  </span>
                  {isActive && (
                    <span className="text-[10px] opacity-60">{t('theme_active')}</span>
                  )}
                </button>
              );
            })}
          </motion.div>

          <p className={cn('text-xs', mutedText)}>{t('theme_sync_hint')}</p>
        </motion.div>

        <motion.div className={cn('rounded-2xl border p-6', cardSurface)}>
          <motion.div className="flex items-center justify-between gap-4">
            <motion.div className="flex items-center gap-2">
              <Languages size={18} className="text-blue-400" />
              <motion.div>
                <p className="font-bold">{t('interface_language')}</p>
                <p className={cn('text-xs mt-0.5', mutedText)}>{t('interface_language_hint')}</p>
              </motion.div>
            </motion.div>
            <motion.div
              className={cn(
                'flex rounded-xl overflow-hidden border',
                theme === 'dark' ? 'border-gray-700' : 'border-gray-300',
              )}
            >
              <button
                type="button"
                onClick={() => void handleLanguageChange('ar')}
                disabled={languageSaving}
                className={cn(
                  'px-5 py-2 text-sm font-bold transition-colors',
                  language === 'ar'
                    ? (theme === 'erp' ? 'bg-[var(--erp-primary)] text-white' : 'bg-blue-600 text-white')
                    : theme === 'dark' ? 'text-gray-400 hover:text-white hover:bg-gray-800' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100',
                )}
              >
                {t('lang_arabic')}
              </button>
              <button
                type="button"
                onClick={() => void handleLanguageChange('en')}
                disabled={languageSaving}
                className={cn(
                  'px-5 py-2 text-sm font-bold transition-colors',
                  language === 'en'
                    ? (theme === 'erp' ? 'bg-[var(--erp-primary)] text-white' : 'bg-blue-600 text-white')
                    : theme === 'dark' ? 'text-gray-400 hover:text-white hover:bg-gray-800' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100',
                )}
              >
                {t('lang_english')}
              </button>
            </motion.div>
          </motion.div>
        </motion.div>

        <motion.div className={cn('rounded-2xl border p-6 space-y-3', cardSurface)}>
          <motion.div className="flex items-center gap-2">
            <Monitor size={18} className="text-blue-400" />
            <span className="font-bold">{t('default_screen')}</span>
            {moduleSaving && <Loader2 size={14} className="animate-spin text-blue-400 ms-auto" />}
          </motion.div>
          <p className={cn('text-xs', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
            {t('default_screen_hint')}
          </p>
          <select
            value={defaultModule}
            onChange={(e) => void handleDefaultModuleChange(e.target.value)}
            aria-label={t('default_screen')}
            className={selectCls}
            dir={dir}
          >
            <option value={NONE_DEFAULT_MODULE}>{t('default_screen_none')}</option>
            {STARTUP_MODULES.filter((m) => m.id !== 'settings').map((m) => (
              <option key={m.id} value={m.id}>
                {language === 'ar' ? m.ar : m.en}
              </option>
            ))}
          </select>
        </motion.div>

        {isAdmin && (
          <PrintSettingsPanel
            theme={theme}
            cardSurface={cardSurface}
            inputCls={inputCls}
            mutedText={mutedText}
          />
        )}
      </motion.div>
    </motion.div>
  );
}
