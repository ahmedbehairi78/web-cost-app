import React, { useEffect, useState } from 'react';
import { Loader2, Link } from 'lucide-react';
import { cn, listKey } from '../../lib/utils';
import { useLanguage } from '../../context/LanguageContext';
import { boqMaterialsApi } from '../../services/local/modulesApi';
import { ensureLocalBoqItemExists } from '../../lib/localEntitySync';
import toast from 'react-hot-toast';
import type { AppTheme } from '../../lib/shellTheme';

type Props = {
  materialCategoryId: number;
  materialName: string;
  contractId: string;
  allBoqItems: Array<{
    id: string;
    itemCode: string;
    description: string;
    unit: string;
  }>;
  onLinked: () => void;
  onClose: () => void;
};

export function QuickLinkMaterialModal({
  materialCategoryId,
  materialName,
  contractId,
  allBoqItems,
  onLinked,
  onClose,
}: Props) {
  const { language, theme } = useLanguage();
  const [selectedBoqItemId, setSelectedBoqItemId] = useState<string>('');
  const [linking, setLinking] = useState(false);
  const [existingLinks, setExistingLinks] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    boqMaterialsApi
      .byMaterial(materialCategoryId, contractId)
      .then((rows) => setExistingLinks(new Set(rows.map((r) => r.boqItemId))))
      .catch(() => setExistingLinks(new Set()))
      .finally(() => setLoading(false));
  }, [materialCategoryId, contractId]);

  const handleLink = async () => {
    if (!selectedBoqItemId) {
      toast.error(language === 'ar' ? 'اختر بند BOQ' : 'Select BOQ item');
      return;
    }
    setLinking(true);
    try {
      await ensureLocalBoqItemExists(selectedBoqItemId);
      const currentLinks = await boqMaterialsApi.list(selectedBoqItemId);
      const currentIds = currentLinks.map((l) => l.materialCategoryId);
      if (!currentIds.includes(materialCategoryId)) {
        await boqMaterialsApi.setMaterials(selectedBoqItemId, [
          ...currentIds,
          materialCategoryId,
        ]);
      }
      toast.success(language === 'ar' ? 'تم الربط' : 'Linked');
      onLinked();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setLinking(false);
    }
  };

  const ar = language === 'ar';
  const panel = cn(
    'rounded-xl border shadow-xl max-w-md w-full flex flex-col',
    theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
  );

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
      <div className={panel}>
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div>
            <h3 className="font-bold text-lg">{ar ? 'ربط صنف ببند BOQ' : 'Link material to BOQ'}</h3>
            <p className="text-xs text-gray-500 mt-1">{materialName}</p>
          </div>
        </div>
        <div className="p-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin" />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-semibold mb-2">
                  {ar ? 'اختر بند BOQ' : 'Select BOQ item'}
                </label>
                <select
                  value={selectedBoqItemId}
                  onChange={(e) => setSelectedBoqItemId(e.target.value)}
                  className={cn(
                    'w-full border rounded-lg px-3 py-2 text-sm',
                    theme === 'dark'
                      ? 'bg-gray-800 border-gray-600 text-gray-100'
                      : 'bg-white border-gray-300 text-gray-900'
                  )}
                >
                  <option value="">{ar ? '— اختر بند —' : '— Select item —'}</option>
                  {allBoqItems.map((item, idx) => (
                    <option key={listKey(item.id, idx, 'quick-link-boq')} value={item.id}>
                      {item.itemCode} — {item.description}
                      {existingLinks.has(item.id) ? ` (${ar ? 'مربوط' : 'linked'})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-gray-500">
                {ar
                  ? 'سيسمح هذا الربط بصرف هذا الصنف على البند المختار في المستقبل.'
                  : 'This link will allow issuing this material to the selected BOQ item in the future.'}
              </p>
            </>
          )}
        </div>
        <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm rounded bg-gray-700 text-white"
          >
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleLink}
            disabled={linking || !selectedBoqItemId}
            className="px-3 py-2 text-sm rounded bg-blue-600 text-white flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {linking ? <Loader2 size={14} className="animate-spin" /> : <Link size={14} />}
            {ar ? 'ربط' : 'Link'}
          </button>
        </div>
      </div>
    </div>
  );
}
