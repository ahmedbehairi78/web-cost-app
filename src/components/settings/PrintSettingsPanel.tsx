import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { Printer, Save, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { db } from '../../firebase';
import { canPersistUserPreferences } from '../../lib/userPreferences';
import { useLanguage } from '../../context/LanguageContext';
import { isLocalBackend } from '../../lib/dataBackend';
import { settingsApi } from '../../services/local/modulesApi';
import { DEFAULT_HEADER_LOGO } from '../../constants/branding';
import { cn } from '../../lib/utils';
import type { AppTheme } from '../../lib/shellTheme';
import { ManualHelpButton } from '../help/ManualHelpButton';
import type { StoredReportPrintProfiles } from '../../lib/reportPrintProfiles';

type PrintSettingsState = {
  companyName: string;
  companyNameEn: string;
  taxId: string;
  address: string;
  addressEn: string;
  headerLogo: string;
  headerLogoLeft: string;
  headerLogoRight: string;
  /** IPC cover middle line under center logo. */
  coverContractLabel: string;
  coverPreparedBy: string;
  coverApprovedBy: string;
  footerText: string;
  footerTextEn: string;
  /** Preserved on save — edited from Reports format toolbar, not here. */
  reportPrintProfiles?: StoredReportPrintProfiles;
};

const DEFAULTS: PrintSettingsState = {
  companyName: 'شركة النيل للمقاولات والاستثمار العقاري',
  companyNameEn: 'Nile Construction & Real Estate',
  taxId: '123-456-789',
  address: 'القاهرة، مصر',
  addressEn: 'Cairo, Egypt',
  headerLogo: DEFAULT_HEADER_LOGO,
  headerLogoLeft: '',
  headerLogoRight: '',
  coverContractLabel: 'CONSTRUCTION CONTRACT',
  coverPreparedBy: '',
  coverApprovedBy: '',
  footerText: 'نظام إدارة التكاليف - جميع الحقوق محفوظة © 2026',
  footerTextEn: 'Cost Management System - All Rights Reserved © 2026',
};

type PrintSettingsPanelProps = {
  theme: AppTheme;
  cardSurface: string;
  inputCls: string;
  mutedText: string;
};

export function PrintSettingsPanel({ theme, cardSurface, inputCls, mutedText }: PrintSettingsPanelProps) {
  const { language, dir, t } = useLanguage();
  const [printSettings, setPrintSettings] = useState<PrintSettingsState>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        if (isLocalBackend) {
          const res = await settingsApi.getCompanyInfo();
          if (res.value) {
            setPrintSettings({ ...DEFAULTS, ...res.value });
          } else {
            setPrintSettings(DEFAULTS);
          }
          return;
        }
        const settingsDoc = await getDoc(doc(db, 'settings', 'company_info'));
        if (settingsDoc.exists()) {
          setPrintSettings({ ...DEFAULTS, ...(settingsDoc.data() as PrintSettingsState) });
        } else {
          setPrintSettings(DEFAULTS);
        }
      } catch (err) {
        console.warn('Could not load company print settings:', err);
        setPrintSettings(DEFAULTS);
        toast.error(t('error_load_print_settings'));
      }
    };
    void fetchSettings();
  }, [t]);

  const handleSave = async () => {
    if (!canPersistUserPreferences()) {
      toast.error(t('error_saving'));
      return;
    }
    setLoading(true);
    try {
      if (isLocalBackend) {
        await settingsApi.putCompanyInfo(printSettings);
      } else {
        const ref = doc(db, 'settings', 'company_info');
        const snap = await getDoc(ref);
        if (snap.exists()) {
          await updateDoc(ref, printSettings);
        } else {
          await setDoc(ref, printSettings);
        }
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      toast.success(t('saved_successfully'));
    } catch (error) {
      console.error('Error saving print settings:', error);
      toast.error(t('error_saving'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={cn('rounded-2xl border p-6 space-y-6', cardSurface)} dir={dir}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Printer size={18} className="text-red-400" />
          <span className="font-bold">{t('print_settings')}</span>
          <ManualHelpButton topicId="settings.print.company" size={14} />
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={loading || !canPersistUserPreferences()}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors text-white disabled:opacity-60',
            theme === 'erp' ? 'bg-[var(--erp-primary)] hover:bg-[var(--erp-primary-hover)]' : 'bg-blue-600 hover:bg-blue-500',
          )}
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
          {saveSuccess ? t('saved_successfully') : t('save')}
        </button>
      </div>

      <p className={cn('text-xs', mutedText)}>
        {language === 'ar'
          ? 'بيانات الشركة والشعار للتذييل والترويسة. تنسيق الطباعة (اتجاه الصفحة، الهوامش، محتوى الترويسة/التذييل) من شريط التنسيق داخل موديول التقارير.'
          : 'Company details and logo for letterhead. Page layout, margins, and header/footer content are edited from the format toolbar inside Reports.'}
      </p>

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label htmlFor="gs-company-name-ar" className={cn('text-xs font-bold uppercase', mutedText)}>
              {t('company_name_ar')}
            </label>
            <input
              id="gs-company-name-ar"
              type="text"
              dir="rtl"
              className={inputCls}
              value={printSettings.companyName}
              onChange={(e) => setPrintSettings({ ...printSettings, companyName: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="gs-company-name-en" className={cn('text-xs font-bold uppercase', mutedText)}>
              {t('company_name_en')}
            </label>
            <input
              id="gs-company-name-en"
              type="text"
              dir="ltr"
              className={inputCls}
              value={printSettings.companyNameEn}
              onChange={(e) => setPrintSettings({ ...printSettings, companyNameEn: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="gs-tax-id" className={cn('text-xs font-bold uppercase', mutedText)}>
            {t('tax_id')}
          </label>
          <input
            id="gs-tax-id"
            type="text"
            className={inputCls}
            value={printSettings.taxId}
            onChange={(e) => setPrintSettings({ ...printSettings, taxId: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label htmlFor="gs-address-ar" className={cn('text-xs font-bold uppercase', mutedText)}>
              {t('address_ar')}
            </label>
            <input
              id="gs-address-ar"
              type="text"
              dir="rtl"
              className={inputCls}
              value={printSettings.address}
              onChange={(e) => setPrintSettings({ ...printSettings, address: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="gs-address-en" className={cn('text-xs font-bold uppercase', mutedText)}>
              {t('address_en')}
            </label>
            <input
              id="gs-address-en"
              type="text"
              dir="ltr"
              className={inputCls}
              value={printSettings.addressEn}
              onChange={(e) => setPrintSettings({ ...printSettings, addressEn: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-3">
          <p className={cn('text-xs font-bold uppercase', mutedText)}>
            {t('print_logos_triple')}
          </p>
          <p className={cn('text-[11px]', mutedText)}>{t('print_logos_triple_hint')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label htmlFor="gs-header-logo-left" className={cn('text-xs font-bold uppercase', mutedText)}>
                {t('company_logo_left_url')}
              </label>
              <input
                id="gs-header-logo-left"
                type="url"
                dir="ltr"
                placeholder="/branding/logo-left.png"
                className={inputCls}
                value={printSettings.headerLogoLeft}
                onChange={(e) => setPrintSettings({ ...printSettings, headerLogoLeft: e.target.value })}
              />
              {printSettings.headerLogoLeft ? (
                <img
                  src={printSettings.headerLogoLeft}
                  alt=""
                  className="h-12 w-auto max-w-full object-contain"
                  referrerPolicy="no-referrer"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : null}
            </div>
            <div className="space-y-2">
              <label htmlFor="gs-header-logo" className={cn('text-xs font-bold uppercase', mutedText)}>
                {t('company_logo_center_url')}
              </label>
              <input
                id="gs-header-logo"
                type="url"
                dir="ltr"
                placeholder="/branding/my-logo.png"
                className={inputCls}
                value={printSettings.headerLogo}
                onChange={(e) => setPrintSettings({ ...printSettings, headerLogo: e.target.value })}
              />
              <img
                src={printSettings.headerLogo || DEFAULT_HEADER_LOGO}
                alt=""
                className="h-12 w-auto max-w-full object-contain mx-auto"
                referrerPolicy="no-referrer"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="gs-header-logo-right" className={cn('text-xs font-bold uppercase', mutedText)}>
                {t('company_logo_right_url')}
              </label>
              <input
                id="gs-header-logo-right"
                type="url"
                dir="ltr"
                placeholder="/branding/logo-right.png"
                className={inputCls}
                value={printSettings.headerLogoRight}
                onChange={(e) => setPrintSettings({ ...printSettings, headerLogoRight: e.target.value })}
              />
              {printSettings.headerLogoRight ? (
                <img
                  src={printSettings.headerLogoRight}
                  alt=""
                  className="h-12 w-auto max-w-full object-contain ms-auto"
                  referrerPolicy="no-referrer"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : null}
            </div>
          </div>
          <p className={cn('text-[11px]', mutedText)}>{t('logo_preview_hint')}</p>
        </div>

        <div className="space-y-3">
          <p className={cn('text-xs font-bold uppercase', mutedText)}>
            {t('print_cover_titles')}
          </p>
          <p className={cn('text-[11px]', mutedText)}>{t('print_cover_titles_hint')}</p>
          <div className="space-y-2">
            <label htmlFor="gs-cover-contract-label" className={cn('text-xs font-bold uppercase', mutedText)}>
              {t('cover_contract_label')}
            </label>
            <input
              id="gs-cover-contract-label"
              type="text"
              dir="ltr"
              className={inputCls}
              value={printSettings.coverContractLabel}
              onChange={(e) => setPrintSettings({ ...printSettings, coverContractLabel: e.target.value })}
              placeholder="CONSTRUCTION CONTRACT"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="gs-cover-prepared" className={cn('text-xs font-bold uppercase', mutedText)}>
                {t('cover_prepared_by')}
              </label>
              <input
                id="gs-cover-prepared"
                type="text"
                dir="ltr"
                className={inputCls}
                value={printSettings.coverPreparedBy}
                onChange={(e) => setPrintSettings({ ...printSettings, coverPreparedBy: e.target.value })}
                placeholder="JLL Misr LLC"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="gs-cover-approved" className={cn('text-xs font-bold uppercase', mutedText)}>
                {t('cover_approved_by')}
              </label>
              <input
                id="gs-cover-approved"
                type="text"
                dir="ltr"
                className={inputCls}
                value={printSettings.coverApprovedBy}
                onChange={(e) => setPrintSettings({ ...printSettings, coverApprovedBy: e.target.value })}
                placeholder="Emaar Misr"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label htmlFor="gs-footer-ar" className={cn('text-xs font-bold uppercase', mutedText)}>
              {t('footer_text_ar')}
            </label>
            <input
              id="gs-footer-ar"
              type="text"
              dir="rtl"
              className={inputCls}
              value={printSettings.footerText}
              onChange={(e) => setPrintSettings({ ...printSettings, footerText: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="gs-footer-en" className={cn('text-xs font-bold uppercase', mutedText)}>
              {t('footer_text_en')}
            </label>
            <input
              id="gs-footer-en"
              type="text"
              dir="ltr"
              className={inputCls}
              value={printSettings.footerTextEn}
              onChange={(e) => setPrintSettings({ ...printSettings, footerTextEn: e.target.value })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
