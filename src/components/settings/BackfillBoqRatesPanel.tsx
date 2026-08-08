import React, { useCallback, useEffect, useState } from 'react';
import { Layers, Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import { ApiError } from '../../lib/apiClient';
import {
  settingsApi,
  type BoqRateBackfillPreview,
  type BoqRateBackfillReport,
} from '../../services/local/modulesApi';
import { AdminSensitiveVerifyModal } from '../AdminSensitiveVerifyModal';
import { ManualHelpButton } from '../help/ManualHelpButton';

type Props = {
  language: 'ar' | 'en';
  theme: string;
};

export function BackfillBoqRatesPanel({ language, theme }: Props) {
  const [preview, setPreview] = useState<BoqRateBackfillPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [lastReport, setLastReport] = useState<BoqRateBackfillReport | null>(null);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    try {
      const data = await settingsApi.boqRateBackfillPreview();
      setPreview(data);
    } catch (err) {
      setPreview(null);
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(
        language === 'ar' ? 'تعذّر تحميل معاينة أسعار BOQ' : 'Failed to load BOQ rate preview',
      );
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [language]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const runBackfill = async () => {
    setRunning(true);
    try {
      const report = await settingsApi.boqRateBackfillRun();
      setLastReport(report);
      toast.success(
        language === 'ar'
          ? `تم تحديث ${report.updated} بنداً من Firestore`
          : `Updated ${report.updated} BOQ items from Firestore`,
      );
      await loadPreview();
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        toast.error(
          language === 'ar'
            ? 'أضف FIREBASE_SERVICE_ACCOUNT_JSON على خادم Railway ثم أعد المحاولة'
            : 'Set FIREBASE_SERVICE_ACCOUNT_JSON on the Railway API service, then retry',
          { duration: 8000 },
        );
      } else {
        toast.error(language === 'ar' ? 'فشل استيراد أسعار BOQ' : 'BOQ rate backfill failed');
      }
      console.error(err);
    } finally {
      setRunning(false);
      setVerifyOpen(false);
    }
  };

  const cardCls = cn(
    'border rounded-2xl p-5 space-y-4',
    theme === 'dark' ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-white',
  );

  return (
    <div className={cardCls}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-900/20 text-amber-500">
            <Layers size={20} />
          </div>
          <div>
            <h4 className="font-bold">
              {language === 'ar' ? 'استيراد أسعار BOQ من Firestore' : 'Import BOQ rates from Firestore'}
            </h4>
            <p className={cn('text-sm mt-1', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
              {language === 'ar'
                ? 'بعد migration الأعمدة الجديدة، Postgres قد يعرض المواد/العمالة = 0 رغم وجود الأسعار في Firestore. هذا الزر ينسخ التفاصيل إلى قاعدة البيانات الحالية.'
                : 'After the rate-column migration, Postgres may show materials/labour as 0 while Firestore still has the breakdown. This copies rates into the active database.'}
            </p>
          </div>
        </div>
        <ManualHelpButton topicId="settings.database.backup" size={14} />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin" />
          {language === 'ar' ? 'جاري التحميل…' : 'Loading…'}
        </div>
      ) : preview ? (
        <ul className={cn('text-sm space-y-1 font-mono', theme === 'dark' ? 'text-gray-300' : 'text-gray-700')}>
          <li>
            {language === 'ar' ? 'بنود تحتاج أسعار:' : 'Rows needing rates:'}{' '}
            <strong>{preview.postgresRowsNeedingRates}</strong>
          </li>
          <li>
            Firestore SA:{' '}
            <strong>{preview.firestoreConfigured ? (language === 'ar' ? 'مضبوط' : 'configured') : (language === 'ar' ? 'غير مضبوط' : 'missing')}</strong>
          </li>
        </ul>
      ) : null}

      {lastReport ? (
        <pre
          className={cn(
            'text-xs p-3 rounded-lg overflow-x-auto',
            theme === 'dark' ? 'bg-black/30 text-green-400' : 'bg-gray-50 text-gray-800',
          )}
        >
          {JSON.stringify(lastReport, null, 2)}
        </pre>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={loading || running}
          onClick={() => void loadPreview()}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-sm border',
            theme === 'dark' ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-200 hover:bg-gray-50',
          )}
        >
          <RefreshCw size={14} />
          {language === 'ar' ? 'تحديث' : 'Refresh'}
        </button>
        <button
          type="button"
          disabled={loading || running || !preview?.firestoreConfigured || preview.postgresRowsNeedingRates === 0}
          onClick={() => setVerifyOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
        >
          {running ? <Loader2 size={16} className="animate-spin" /> : <Layers size={16} />}
          {language === 'ar' ? 'استيراد من Firestore' : 'Import from Firestore'}
        </button>
      </div>

      <AdminSensitiveVerifyModal
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        onVerified={async () => {
          await runBackfill();
        }}
        language={language}
        theme={theme}
      />
    </div>
  );
}
