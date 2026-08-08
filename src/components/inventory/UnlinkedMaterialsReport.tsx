import React, { useEffect, useState } from 'react';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import { cn, listKey } from '../../lib/utils';
import { useLanguage } from '../../context/LanguageContext';
import { boqMaterialsApi } from '../../services/local/modulesApi';
import toast from 'react-hot-toast';
import type { AppTheme } from '../../lib/shellTheme';

type Props = {
  contractId: string;
  contractLabel: string;
  onClose: () => void;
};

export function UnlinkedMaterialsReport({ contractId, contractLabel, onClose }: Props) {
  const { language, theme } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [unlinkedItems, setUnlinkedItems] = useState<
    Array<{ id: string; itemCode: string; description: string; unit: string }>
  >([]);
  const [unusedMaterials, setUnusedMaterials] = useState<
    Array<{ id: number; code: string; name: string; unit: string }>
  >([]);

  useEffect(() => {
    setLoading(true);
    boqMaterialsApi
      .getUnlinkedReport(contractId)
      .then((data) => {
        setUnlinkedItems(data.unlinkedItems);
        setUnusedMaterials(data.unusedMaterials);
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : 'Error loading report');
      })
      .finally(() => setLoading(false));
  }, [contractId]);

  const ar = language === 'ar';
  const panel = cn(
    'rounded-xl border shadow-xl max-w-4xl w-full max-h-[85vh] flex flex-col',
    theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
      <div className={panel}>
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div>
            <h3 className="font-bold text-lg flex items-center gap-2">
              <AlertTriangle className="text-amber-500" size={20} />
              {ar ? 'تقرير الربط - بنود وأصناف' : 'Linking Report - Items & Materials'}
            </h3>
            <p className="text-xs text-gray-500 mt-1">{contractLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200"
            aria-label={ar ? 'إغلاق' : 'Close'}
          >
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-12">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <div className="p-4 overflow-y-auto flex-1 space-y-6">
            {/* بنود BOQ غير مربوطة */}
            <div>
              <h4 className="font-bold text-sm mb-3 flex items-center gap-2">
                <span
                  className={cn(
                    'px-2 py-1 rounded text-xs font-mono',
                    unlinkedItems.length === 0
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  )}
                >
                  {unlinkedItems.length}
                </span>
                {ar ? 'بنود BOQ غير مربوطة بأصناف' : 'BOQ items without material links'}
              </h4>
              {unlinkedItems.length === 0 ? (
                <p className="text-sm text-green-400">
                  {ar ? '✓ كل البنود مربوطة' : '✓ All items are linked'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr
                        className={cn(
                          'border-b',
                          theme === 'dark' ? 'border-gray-700' : 'border-gray-200'
                        )}
                      >
                        <th className="text-right p-2 font-semibold">
                          {ar ? 'كود البند' : 'Item code'}
                        </th>
                        <th className="text-right p-2 font-semibold">{ar ? 'الوصف' : 'Description'}</th>
                        <th className="text-right p-2 font-semibold w-20">{ar ? 'الوحدة' : 'Unit'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unlinkedItems.map((item, idx) => (
                        <tr
                          key={listKey(item.id, idx, 'unlinked-item')}
                          className={cn(
                            'border-b',
                            theme === 'dark'
                              ? 'border-gray-800 hover:bg-gray-800/30'
                              : 'border-gray-100 hover:bg-gray-50'
                          )}
                        >
                          <td className="p-2 font-mono text-xs">{item.itemCode}</td>
                          <td className="p-2">{item.description}</td>
                          <td className="p-2 text-center">{item.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* أصناف غير مستخدمة */}
            <div>
              <h4 className="font-bold text-sm mb-3 flex items-center gap-2">
                <span
                  className={cn(
                    'px-2 py-1 rounded text-xs font-mono',
                    unusedMaterials.length === 0
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-amber-500/20 text-amber-400'
                  )}
                >
                  {unusedMaterials.length}
                </span>
                {ar ? 'أصناف غير مربوطة بأي بند' : 'Materials not linked to any item'}
              </h4>
              {unusedMaterials.length === 0 ? (
                <p className="text-sm text-green-400">
                  {ar ? '✓ كل الأصناف مربوطة' : '✓ All materials are linked'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr
                        className={cn(
                          'border-b',
                          theme === 'dark' ? 'border-gray-700' : 'border-gray-200'
                        )}
                      >
                        <th className="text-right p-2 font-semibold w-24">
                          {ar ? 'كود الصنف' : 'Material code'}
                        </th>
                        <th className="text-right p-2 font-semibold">{ar ? 'اسم الصنف' : 'Material name'}</th>
                        <th className="text-right p-2 font-semibold w-20">{ar ? 'الوحدة' : 'Unit'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unusedMaterials.map((material, idx) => (
                        <tr
                          key={listKey(material.id, idx, 'unused-material')}
                          className={cn(
                            'border-b',
                            theme === 'dark'
                              ? 'border-gray-800 hover:bg-gray-800/30'
                              : 'border-gray-100 hover:bg-gray-50'
                          )}
                        >
                          <td className="p-2 font-mono text-xs">{material.code}</td>
                          <td className="p-2">{material.name}</td>
                          <td className="p-2 text-center">{material.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {unlinkedItems.length === 0 && unusedMaterials.length === 0 && (
              <div className="text-center py-8 text-green-400">
                <p className="text-lg font-bold">✓ {ar ? 'كل شيء مربوط بشكل صحيح!' : 'Everything is properly linked!'}</p>
                <p className="text-sm mt-2 opacity-80">
                  {ar
                    ? 'لا توجد بنود أو أصناف غير مربوطة.'
                    : 'No unlinked items or materials found.'}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="p-4 border-t border-gray-700 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded bg-gray-700 text-white hover:bg-gray-600"
          >
            {ar ? 'إغلاق' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
