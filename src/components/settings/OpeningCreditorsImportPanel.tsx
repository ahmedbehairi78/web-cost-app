import React, { useRef, useState } from 'react';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { cn } from '../../lib/utils';
import { businessTodayYmd } from '../../lib/businessCalendar';
import { useLanguage } from '../../context/LanguageContext';
import { usePermissions } from '../../context/PermissionsContext';
import { isLocalBackend } from '../../lib/dataBackend';
import { suppliersApi } from '../../services/local/modulesApi';
import { exportCreditorsOpeningTemplate, parseCreditorsOpeningWorkbook } from '../../lib/creditorsOpeningExcel';
import { ApiError } from '../../lib/apiClient';
import toast from 'react-hot-toast';

export function OpeningCreditorsImportPanel({ onImported }: { onImported?: () => void }) {
  const { language, theme, t } = useLanguage();
  const { can } = usePermissions();
  const canImport = can('suppliers').create || can('costs').create || can('ledger').create;
  const [openingImportDate, setOpeningImportDate] = useState(() => businessTodayYmd());
  const [openingImportLoading, setOpeningImportLoading] = useState(false);
  const openingImportInputRef = useRef<HTMLInputElement>(null);

  if (!isLocalBackend || !canImport) return null;

  const handleOpeningTemplate = () => {
    exportCreditorsOpeningTemplate(language === 'ar' ? 'ar' : 'en');
  };

  const handleOpeningImportFile = async (file: File | null) => {
    if (!file) return;
    setOpeningImportLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const rows = parseCreditorsOpeningWorkbook(buffer);
      if (rows.length === 0) {
        toast.error(t('creditors_opening_empty_file'));
        return;
      }
      const result = await suppliersApi.importOpening({
        date: openingImportDate,
        rows: rows.map((r) => ({
          type: r.type,
          name: r.name,
          nameEn: r.nameEn,
          taxNumber: r.taxNumber,
          phone: r.phone,
          address: r.address,
          accountCode: r.accountCode,
          openingBalance: r.openingBalance,
        })),
      });
      onImported?.();
      const summary = t('creditors_opening_result')
        .replace('{created}', String(result.created))
        .replace('{skipped}', String(result.skipped))
        .replace('{posted}', String(result.openingPosted));
      if (result.created > 0 || result.openingPosted > 0) {
        toast.success(
          result.reference
            ? `${t('creditors_opening_success')} — ${summary} — ${t('creditors_opening_gl_ref').replace('{reference}', result.reference)}`
            : `${t('creditors_opening_success')} — ${summary}`,
        );
      } else {
        toast(summary || t('creditors_opening_none'), { icon: 'ℹ️' });
      }
      if (result.errors.length > 0) {
        toast.error(
          `${t('creditors_opening_errors').replace('{count}', String(result.errors.length))}: ${result.errors.slice(0, 3).join(' · ')}`,
        );
      }
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : t('creditors_opening_failed');
      toast.error(msg);
    } finally {
      setOpeningImportLoading(false);
      if (openingImportInputRef.current) openingImportInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2 mb-6">
      <label className={cn('block text-[10px] font-bold', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
        {t('creditors_opening_date')}
      </label>
      <input
        type="date"
        value={openingImportDate}
        onChange={(e) => setOpeningImportDate(e.target.value)}
        className={cn(
          'w-full max-w-xs rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-500',
          theme === 'dark' ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900',
        )}
      />
      <p className={cn('text-[10px] leading-snug max-w-xl', theme === 'dark' ? 'text-gray-500' : 'text-gray-500')}>
        {t('creditors_opening_hint')}
      </p>
      <div className="flex gap-2 max-w-xl">
        <button
          type="button"
          onClick={handleOpeningTemplate}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium border transition-colors',
            theme === 'dark'
              ? 'border-gray-600 text-gray-200 hover:bg-gray-800'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50',
          )}
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          {t('creditors_opening_template')}
        </button>
        <button
          type="button"
          onClick={() => openingImportInputRef.current?.click()}
          disabled={openingImportLoading}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-colors"
        >
          {openingImportLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {t('creditors_opening_import')}
        </button>
      </div>
      <input
        ref={openingImportInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => void handleOpeningImportFile(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}
