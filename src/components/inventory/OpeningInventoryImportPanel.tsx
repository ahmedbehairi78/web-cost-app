import React, { useRef, useState } from 'react';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { cn } from '../../lib/utils';
import { businessTodayYmd } from '../../lib/businessCalendar';
import { useLanguage } from '../../context/LanguageContext';
import { inventoryApi } from '../../services/local/modulesApi';
import {
  exportOpeningInventoryTemplate,
  parseOpeningInventoryWorkbook,
} from '../../lib/inventoryOpeningExcel';
import { ApiError } from '../../lib/apiClient';
import toast from 'react-hot-toast';

export function OpeningInventoryImportPanel({
  projectId,
  hasWarehouse,
  onImported,
}: {
  projectId: string;
  hasWarehouse: boolean;
  onImported: () => void;
}) {
  const { language, theme, t } = useLanguage();
  const ar = language === 'ar';
  const [openingImportDate, setOpeningImportDate] = useState(() => businessTodayYmd());
  const [openingImportLoading, setOpeningImportLoading] = useState(false);
  const openingImportInputRef = useRef<HTMLInputElement>(null);

  const handleOpeningTemplate = () => {
    exportOpeningInventoryTemplate(language === 'ar' ? 'ar' : 'en');
  };

  const handleOpeningImportFile = async (file: File | null) => {
    if (!file) return;
    if (!projectId) {
      toast.error(t('inventory_opening_need_project'));
      return;
    }
    if (!hasWarehouse) {
      toast.error(t('inventory_opening_need_warehouse'));
      return;
    }
    setOpeningImportLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseOpeningInventoryWorkbook(buffer);
      if (parsed.isMaterialsTreeFile) {
        toast.error(t('inventory_opening_wrong_file'));
        return;
      }
      if (parsed.rows.length === 0) {
        toast.error(t('inventory_opening_empty_file'));
        return;
      }
      const result = await inventoryApi.importOpeningBalances(projectId, {
        date: openingImportDate,
        rows: parsed.rows.map((r) => ({
          materialCategoryCode: r.materialCategoryCode,
          quantity: r.quantity,
          avgUnitCost: r.avgUnitCost,
        })),
      });
      onImported();
      const summary = t('inventory_opening_result')
        .replace('{imported}', String(result.imported))
        .replace('{skipped}', String(result.skipped));
      if (result.imported > 0) {
        toast.success(
          result.reference
            ? `${t('inventory_opening_success')} — ${summary} — ${t('inventory_opening_gl_ref').replace('{reference}', result.reference)}`
            : `${t('inventory_opening_success')} — ${summary}`,
        );
      } else {
        toast(summary || t('inventory_opening_none'), { icon: 'ℹ️' });
      }
      if (result.errors.length > 0) {
        toast.error(
          `${t('inventory_opening_errors').replace('{count}', String(result.errors.length))}: ${result.errors.slice(0, 3).join(' · ')}`,
        );
      }
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : ar
              ? 'فشل استيراد الأرصدة'
              : 'Failed to import opening balances';
      toast.error(msg);
    } finally {
      setOpeningImportLoading(false);
      if (openingImportInputRef.current) openingImportInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <label className={cn('block text-[10px] font-bold', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
        {t('inventory_opening_date')}
      </label>
      <input
        type="date"
        value={openingImportDate}
        onChange={(e) => setOpeningImportDate(e.target.value)}
        className={cn(
          'w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-500',
          theme === 'dark' ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900',
        )}
      />
      <p className={cn('text-[10px] leading-snug', theme === 'dark' ? 'text-gray-500' : 'text-gray-500')}>
        {t('inventory_opening_hint')}
      </p>
      {!hasWarehouse && (
        <p className="text-[11px] font-medium text-amber-600">
          {t('inventory_opening_need_warehouse')}
        </p>
      )}
      <div className="flex gap-2">
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
          {t('inventory_opening_template')}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!hasWarehouse) {
              toast.error(t('inventory_opening_need_warehouse'));
              return;
            }
            openingImportInputRef.current?.click();
          }}
          disabled={openingImportLoading || !hasWarehouse}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-colors"
        >
          {openingImportLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {t('inventory_opening_import')}
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
