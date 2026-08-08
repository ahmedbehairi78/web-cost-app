import React, { useCallback, useEffect, useState } from 'react';
import { CloudUpload, Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import { ApiError } from '../../lib/apiClient';
import { settingsApi, type PushToProductionPreview } from '../../services/local/modulesApi';
import { AdminSensitiveVerifyModal } from '../AdminSensitiveVerifyModal';
import { ManualHelpButton } from '../help/ManualHelpButton';

type Props = {
  language: 'ar' | 'en';
  theme: string;
  fiscalYear?: number;
};

export function PushToProductionPanel({ language, theme, fiscalYear = new Date().getFullYear() }: Props) {
  const [preview, setPreview] = useState<PushToProductionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [staleApi, setStaleApi] = useState(false);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setStaleApi(false);
    try {
      const data = await settingsApi.pushToProductionPreview(fiscalYear);
      setPreview(data);
    } catch (err) {
      setPreview(null);
      if (err instanceof ApiError && err.status === 401) return;
      if (err instanceof ApiError && err.status === 404) {
        setStaleApi(true);
        toast.error(
          language === 'ar' ? 'الخادم المحلي قديم — أعد تشغيل local:api' : 'Stale local API — restart local:api',
          {
            description:
              language === 'ar'
                ? 'أوقف العملية على المنفذ 3001 ثم npm run local:api'
                : 'Stop the process on port 3001, then run npm run local:api',
          },
        );
        return;
      }
      toast.error(
        language === 'ar' ? 'تعذر تحميل معاينة الترحيل' : 'Failed to load push preview',
        { description: err instanceof Error ? err.message : String(err) },
      );
    } finally {
      setLoading(false);
    }
  }, [fiscalYear, language]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const runPush = async () => {
    setPushing(true);
    try {
      const result = await settingsApi.pushToProduction();
      const txCount = result.counts.transactions ?? 0;
      toast.success(
        language === 'ar' ? 'تم ترحيل البيانات إلى الإنتاج' : 'Data pushed to production',
        {
          description:
            language === 'ar'
              ? `${txCount} قيد محاسبي · ${result.preview.missingOnRemote} كان ناقصاً`
              : `${txCount} GL rows processed · ${result.preview.missingOnRemote} were missing before push`,
        },
      );
      await loadPreview();
    } catch (err) {
      toast.error(
        language === 'ar' ? 'فشل الترحيل إلى الإنتاج' : 'Push to production failed',
        { description: err instanceof Error ? err.message : String(err) },
      );
    } finally {
      setPushing(false);
    }
  };

  const configured = preview?.configured ?? false;

  return (
    <div className={cn('border rounded-2xl p-5', theme === 'dark' ? 'border-amber-900/40 bg-amber-950/10' : 'border-amber-200 bg-amber-50/60')}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={cn('p-2 rounded-lg shrink-0', theme === 'dark' ? 'bg-amber-900/30 text-amber-400' : 'bg-amber-100 text-amber-700')}>
            <CloudUpload size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-bold text-sm">
                {language === 'ar' ? 'ترحيل إلى الإنتاج (Railway)' : 'Push to production (Railway)'}
              </p>
              <ManualHelpButton topicId="settings.database.push_production" size={12} />
            </div>
            <p className={cn('text-xs mt-0.5 max-w-xl', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>
              {language === 'ar'
                ? 'يدمج Postgres المحلي في قاعدة Railway — للمدير فقط. لا يستبدل مستخدمي الإنتاج.'
                : 'Merges local Postgres into Railway — admin only. Production users are not overwritten.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadPreview()}
          disabled={loading || pushing}
          className={cn(
            'p-2 rounded-lg transition-colors shrink-0',
            theme === 'dark' ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-white text-gray-500',
          )}
          title={language === 'ar' ? 'تحديث' : 'Refresh'}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {!configured && !loading && !staleApi && (
        <p className={cn('mt-4 text-sm', theme === 'dark' ? 'text-amber-300/80' : 'text-amber-800')}>
          {language === 'ar'
            ? 'أضف PRODUCTION_DATABASE_URL في ملف .env المحلي (DATABASE_PUBLIC_URL من Railway) ثم أعد تشغيل local:api.'
            : 'Add PRODUCTION_DATABASE_URL to local .env (Railway DATABASE_PUBLIC_URL), then restart local:api.'}
        </p>
      )}

      {staleApi && (
        <p className={cn('mt-4 text-sm font-medium', theme === 'dark' ? 'text-red-300' : 'text-red-700')}>
          {language === 'ar'
            ? 'المسار غير موجود على :3001 — عملية API قديمة. في PowerShell: Get-NetTCPConnection -LocalPort 3001 ثم Stop-Process، ثم npm run local:api'
            : 'Route missing on :3001 — stale API process. In PowerShell: stop the process on port 3001, then npm run local:api'}
        </p>
      )}

      {preview && configured && (
        <div className={cn('mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm')}>
          <div className={cn('p-3 rounded-xl border', theme === 'dark' ? 'border-gray-800 bg-gray-900/40' : 'border-gray-200 bg-white')}>
            <p className="text-xs text-gray-500 uppercase font-bold mb-1">{language === 'ar' ? 'محلي' : 'Local'}</p>
            <p className="font-black tabular-nums">{preview.local.transactions2026}</p>
            <p className="text-xs text-gray-500">{language === 'ar' ? `قيود ${fiscalYear}` : `${fiscalYear} entries`}</p>
          </div>
          <div className={cn('p-3 rounded-xl border', theme === 'dark' ? 'border-gray-800 bg-gray-900/40' : 'border-gray-200 bg-white')}>
            <p className="text-xs text-gray-500 uppercase font-bold mb-1">{language === 'ar' ? 'Railway' : 'Railway'}</p>
            <p className="font-black tabular-nums">{preview.remote?.transactions2026 ?? '—'}</p>
            <p className="text-xs text-gray-500 truncate" title={preview.targetHost ?? undefined}>
              {preview.targetHost ?? '—'}
            </p>
          </div>
          <div className={cn('p-3 rounded-xl border', theme === 'dark' ? 'border-amber-900/30 bg-amber-950/20' : 'border-amber-200 bg-amber-50')}>
            <p className="text-xs text-gray-500 uppercase font-bold mb-1">{language === 'ar' ? 'ناقص على Railway' : 'Missing on Railway'}</p>
            <p className="font-black tabular-nums text-amber-500">{preview.missingOnRemote}</p>
            <p className="text-xs text-gray-500">{language === 'ar' ? 'قيد GL' : 'GL entries'}</p>
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={!configured || loading || pushing}
        onClick={() => setVerifyOpen(true)}
        className={cn(
          'mt-4 w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-colors text-white',
          configured
            ? 'bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900/40 disabled:text-amber-700'
            : 'bg-gray-600 cursor-not-allowed opacity-50',
        )}
      >
        {pushing ? <Loader2 size={16} className="animate-spin" /> : <CloudUpload size={16} />}
        {language === 'ar' ? 'ترحيل الآن' : 'Push now'}
      </button>

      <AdminSensitiveVerifyModal
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        language={language}
        theme={theme}
        onVerified={runPush}
      />
    </div>
  );
}
