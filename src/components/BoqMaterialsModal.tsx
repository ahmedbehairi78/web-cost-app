import React, { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';
import { boqMaterialsApi, materialsApi, type MaterialCategory } from '../services/local/modulesApi';
import { ensureLocalBoqItemExists } from '../lib/localEntitySync';
import { isLocalBackend } from '../lib/dataBackend';
import toast from 'react-hot-toast';

type Props = {
  boqItemId: string;
  itemLabel: string;
  boqHint?: {
    projectId?: string;
    contractId?: string;
    itemCode?: string;
    description?: string;
    unit?: string;
    chapterCode?: string;
    chapterName?: string;
    workTypeCode?: string;
    sectionCode?: string;
    sectionName?: string;
    tenderQty?: number;
    unitRateTotal?: number;
    tenderAmount?: number;
    expectedDuration?: number;
    startDate?: string;
  };
  onClose: () => void;
};

export function BoqMaterialsModal({ boqItemId, itemLabel, boqHint, onClose }: Props) {
  const { language, theme } = useLanguage();
  const [allCategories, setAllCategories] = useState<MaterialCategory[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [consumedQty, setConsumedQty] = useState<number>(0);

  useEffect(() => {
    if (!isLocalBackend) return;
    (async () => {
      setLoading(true);
      try {
        await ensureLocalBoqItemExists(boqItemId, boqHint);
        const [cats, linked, consumed] = await Promise.all([
          materialsApi.listCategories(),
          boqMaterialsApi.list(boqItemId),
          boqMaterialsApi.getConsumedQuantity(boqItemId).catch(() => ({ consumedQuantity: 0 })),
        ]);
        setAllCategories(cats);
        setSelected(new Set(linked.map((l) => l.materialCategoryId)));
        setConsumedQty(consumed.consumedQuantity);
      } catch (e: unknown) {
        toast.error(
          e instanceof Error
            ? e.message
            : (language === 'ar' ? 'فشل التحميل' : 'Load failed'),
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [boqItemId, boqHint, language]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await ensureLocalBoqItemExists(boqItemId, boqHint);
      await boqMaterialsApi.setMaterials(boqItemId, [...selected]);
      toast.success(language === 'ar' ? 'تم الحفظ' : 'Saved');
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  if (!isLocalBackend) return null;

  const panel = cn(
    'rounded-xl border shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col',
    theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
      <div className={panel}>
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <BoqMaterialsModalHeader language={language} itemLabel={itemLabel} />
        </div>
        {consumedQty > 0 && (
          <div className="mx-4 mt-4 p-3 bg-amber-500/20 border border-amber-500/30 rounded-lg text-sm">
            <p className="font-semibold text-amber-400">
              {language === 'ar' ? '⚠️ تنبيه: كمية منصرفة سابقاً' : '⚠️ Warning: Previously consumed'}
            </p>
            <p className="text-amber-300 text-xs mt-1">
              {language === 'ar'
                ? `هذا البند له ${consumedQty.toFixed(2)} وحدة منصرفة. تعديل الأصناف لن يؤثر على الصرف السابق.`
                : `This item has ${consumedQty.toFixed(2)} units consumed. Changing materials won't affect past consumption.`}
            </p>
          </div>
        )}
        <div className="p-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin" />
            </div>
          ) : (
            <div className="space-y-1">
              {allCategories.map((c, idx) => (
                <label key={c.id || `cat-${c.code}-${idx}`} className="flex items-center gap-2 py-1.5 cursor-pointer text-sm">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                  <span className="font-mono text-xs text-gray-500">{c.code}</span>
                  <span>{c.name}</span>
                  <span className="text-gray-500">({c.unit})</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded bg-gray-700 text-white">
            {language === 'ar' ? 'إلغاء' : 'Cancel'}
          </button>
          <button type="button" onClick={save} disabled={saving} className="px-3 py-2 text-sm rounded bg-blue-600 text-white flex items-center gap-1">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {language === 'ar' ? 'حفظ' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BoqMaterialsModalHeader({ language, itemLabel }: { language: string; itemLabel: string }) {
  return (
    <div>
      <h3 className="font-bold">{language === 'ar' ? 'أصناف مسموحة للبند' : 'Allowed materials'}</h3>
      <p className="text-xs text-gray-500 mt-1">{itemLabel}</p>
    </div>
  );
}
