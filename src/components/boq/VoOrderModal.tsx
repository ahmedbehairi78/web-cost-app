import React, { useCallback, useMemo, useState } from 'react';
import { ManualHelpButton } from '../help/ManualHelpButton';
import { FileDiff, Loader2, X, Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { variationOrdersApi, boqMaterialsApi } from '../../services/local/modulesApi';
import { cn, listKey } from '../../lib/utils';
import type { VoLineType } from '../../types';
import toast from 'react-hot-toast';
import { isLocalBackend } from '../../lib/dataBackend';

export interface VoBoqRow {
  id: string;
  itemCode: string;
  description: string;
  unit: string;
  tenderQty: number;
  unitRateTotal: number;
  chapterCode?: string;
  chapterName?: string;
  workTypeCode?: string;
  sectionCode?: string;
  sectionName?: string;
}

type DraftLine = {
  key: string;
  lineType: VoLineType;
  boqItemId?: string;
  itemCode?: string;
  description?: string;
  unit?: string;
  chapterCode?: string;
  chapterName?: string;
  workTypeCode?: string;
  sectionCode?: string;
  sectionName?: string;
  tenderQty?: string;
  unitRateTotal?: string;
  newTenderQty?: string;
  newUnitRate?: string;
};

function roundMoney(v: number): number {
  return Math.round(v);
}

interface Props {
  contractId: string;
  boqItems: VoBoqRow[];
  theme: string;
  dir?: string;
  onClose: () => void;
  onCreated: () => void;
}

export function VoOrderModal({ contractId, boqItems, theme, dir, onClose, onCreated }: Props) {
  const { t, formatMoney } = useLanguage();
  const isDark = theme === 'dark';

  const [voDate, setVoDate] = useState(new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [lineKeySeq, setLineKeySeq] = useState(0);

  const addLine = (lineType: VoLineType) => {
    setLineKeySeq((n) => n + 1);
    setLines((prev) => [...prev, { key: `line-${lineKeySeq + 1}`, lineType }]);
  };

  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const patchLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const onBoqPick = (key: string, boqItemId: string) => {
    const boq = boqItems.find((b) => b.id === boqItemId);
    if (!boq) return;
    patchLine(key, {
      boqItemId,
      newTenderQty: String(boq.tenderQty),
      newUnitRate: String(boq.unitRateTotal),
    });
  };

  const previewTotal = useMemo(() => {
    let total = 0;
    for (const line of lines) {
      if (line.lineType === 'new_item') {
        const qty = Number(line.tenderQty) || 0;
        const rate = Number(line.unitRateTotal) || 0;
        total += roundMoney(qty * rate);
      } else if (line.boqItemId) {
        const boq = boqItems.find((b) => b.id === line.boqItemId);
        if (!boq) continue;
        const oldAmt = roundMoney(boq.tenderQty * boq.unitRateTotal);
        if (line.lineType === 'delete_item') {
          total -= oldAmt;
        } else {
          const newQty = line.newTenderQty != null && line.newTenderQty !== '' ? Number(line.newTenderQty) : boq.tenderQty;
          const newRate = line.newUnitRate != null && line.newUnitRate !== '' ? Number(line.newUnitRate) : boq.unitRateTotal;
          total += roundMoney(newQty * newRate) - oldAmt;
        }
      }
    }
    return roundMoney(total);
  }, [lines, boqItems]);

  const handleSave = useCallback(async () => {
    if (lines.length === 0) {
      toast.error(t('vo_lines_required'));
      return;
    }

    for (const line of lines) {
      if (line.lineType === 'new_item') {
        const qty = Number(line.tenderQty);
        const rate = Number(line.unitRateTotal);
        if (!line.itemCode?.trim() || !line.description?.trim() || !line.unit?.trim()) {
          toast.error(t('vo_new_item_fields_required'));
          return;
        }
        if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(rate) || rate < 0) {
          toast.error(t('vo_new_item_qty_rate_invalid'));
          return;
        }
      } else if (!line.boqItemId) {
        toast.error(t('vo_boq_item_required'));
        return;
      }
    }

    const payload = lines.map((line) => {
      const base = { lineType: line.lineType };
      if (line.lineType === 'new_item') {
        return {
          ...base,
          itemCode: line.itemCode?.trim(),
          description: line.description?.trim(),
          unit: line.unit?.trim(),
          chapterCode: line.chapterCode?.trim(),
          chapterName: line.chapterName?.trim(),
          workTypeCode: line.workTypeCode?.trim(),
          sectionCode: line.sectionCode?.trim(),
          sectionName: line.sectionName?.trim(),
          tenderQty: Number(line.tenderQty),
          unitRateTotal: Number(line.unitRateTotal),
        };
      }
      return {
        ...base,
        boqItemId: line.boqItemId,
        newTenderQty: line.newTenderQty !== '' && line.newTenderQty != null ? Number(line.newTenderQty) : undefined,
        newUnitRate: line.newUnitRate !== '' && line.newUnitRate != null ? Number(line.newUnitRate) : undefined,
      };
    });

    setSaving(true);
    try {
      const result = await variationOrdersApi.create({
        contractId,
        voDate,
        title: title.trim(),
        notes: notes.trim() || undefined,
        lines: payload,
      });
      
      // وراثة روابط الأصناف للبنود الجديدة في VO من البند الأصلي المختار
      if (isLocalBackend && result.newBoqItemIds && Array.isArray(result.newBoqItemIds)) {
        let inheritedCount = 0;
        const newItemLines = lines.filter(l => l.lineType === 'new_item');
        for (let i = 0; i < result.newBoqItemIds.length && i < newItemLines.length; i++) {
          const newItemId = result.newBoqItemIds[i];
          const line = newItemLines[i];
          // إذا كان البند الجديد مبني على بند موجود (للمقارنة)، ننسخ الروابط
          if (line.boqItemId) {
            try {
              const inherited = await boqMaterialsApi.inheritLinks(newItemId, line.boqItemId);
              inheritedCount += inherited.inherited;
            } catch (err) {
              console.warn('VO inherit links failed:', err);
            }
          }
        }
        if (inheritedCount > 0) {
          toast.success(
            t('vo_created') + ` • ${inheritedCount} ${t('vo_inherited_materials') || 'material link(s) inherited'}`
          );
        } else {
          toast.success(t('vo_created'));
        }
      } else {
        toast.success(t('vo_created'));
      }
      
      onCreated();
      onClose();
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : t('vo_create_failed');
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [contractId, lines, notes, onClose, onCreated, t, title, voDate]);

  const inputCls = cn(
    'w-full rounded-lg border px-2 py-1.5 text-sm',
    isDark ? 'bg-[#0a0a0a] border-gray-700' : 'bg-white border-gray-300',
  );

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" dir={dir}>
      <div
        className={cn(
          'border rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col',
          isDark ? 'bg-[#151619] border-gray-800' : 'bg-white border-gray-200',
        )}
      >
        <div className={cn('p-4 border-b flex justify-between items-center shrink-0', isDark ? 'border-gray-800' : 'border-gray-200')}>
          <div className="flex items-center gap-2">
            <FileDiff size={20} className="text-blue-500" />
            <h3 className="font-bold">{t('vo_modal_title')}</h3>
            <ManualHelpButton topicId="technical.boq.vo" size={14} />
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-red-500">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-sm">
              <span className="text-gray-500 block mb-1">{t('vo_date')}</span>
              <input type="date" className={inputCls} value={voDate} onChange={(e) => setVoDate(e.target.value)} />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="text-gray-500 block mb-1">{t('vo_title')}</span>
              <input type="text" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
          </div>
          <label className="text-sm block">
            <span className="text-gray-500 block mb-1">{t('vo_notes')}</span>
            <textarea className={cn(inputCls, 'min-h-[60px]')} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => addLine('new_item')} className="text-xs px-3 py-1.5 rounded-lg border border-blue-500/40 text-blue-500">
              + {t('vo_line_new_item')}
            </button>
            <button type="button" onClick={() => addLine('adjust')} className="text-xs px-3 py-1.5 rounded-lg border border-amber-500/40 text-amber-600">
              + {t('vo_line_adjust')}
            </button>
            <button type="button" onClick={() => addLine('delete_item')} className="text-xs px-3 py-1.5 rounded-lg border border-red-500/40 text-red-500">
              + {t('vo_line_delete_item')}
            </button>
          </div>

          {lines.map((line, li) => (
            <div key={listKey(line.key, li, 'vo-line')} className={cn('rounded-xl border p-3 space-y-2', isDark ? 'border-gray-800' : 'border-gray-200')}>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase text-gray-500">
                  {line.lineType === 'new_item'
                    ? t('vo_line_new_item')
                    : line.lineType === 'adjust'
                      ? t('vo_line_adjust')
                      : t('vo_line_delete_item')}
                </span>
                <button type="button" onClick={() => removeLine(line.key)} className="text-gray-500 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>

              {line.lineType === 'new_item' ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <input placeholder={t('vo_item_code')} className={inputCls} value={line.itemCode ?? ''} onChange={(e) => patchLine(line.key, { itemCode: e.target.value })} />
                  <input placeholder={t('vo_description')} className={cn(inputCls, 'md:col-span-2')} value={line.description ?? ''} onChange={(e) => patchLine(line.key, { description: e.target.value })} />
                  <input placeholder={t('vo_unit')} className={inputCls} value={line.unit ?? ''} onChange={(e) => patchLine(line.key, { unit: e.target.value })} />
                  <input type="number" step="0.01" placeholder={t('vo_qty')} className={inputCls} value={line.tenderQty ?? ''} onChange={(e) => patchLine(line.key, { tenderQty: e.target.value })} />
                  <input type="number" step="1" placeholder={t('vo_rate')} className={inputCls} value={line.unitRateTotal ?? ''} onChange={(e) => patchLine(line.key, { unitRateTotal: e.target.value })} />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <select
                    className={inputCls}
                    value={line.boqItemId ?? ''}
                    onChange={(e) => onBoqPick(line.key, e.target.value)}
                  >
                    <option value="">{t('vo_pick_boq_item')}</option>
                    {boqItems.map((b, bi) => (
                      <option key={b.id || `boq-opt-${b.itemCode}-${bi}`} value={b.id}>
                        {b.itemCode} — {b.description}
                      </option>
                    ))}
                  </select>
                  {line.lineType === 'adjust' ? (
                    <>
                      <input type="number" step="0.01" placeholder={t('vo_new_qty')} className={inputCls} value={line.newTenderQty ?? ''} onChange={(e) => patchLine(line.key, { newTenderQty: e.target.value })} />
                      <input type="number" step="1" placeholder={t('vo_new_rate')} className={inputCls} value={line.newUnitRate ?? ''} onChange={(e) => patchLine(line.key, { newUnitRate: e.target.value })} />
                    </>
                  ) : null}
                </div>
              )}
            </div>
          ))}

          {lines.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">{t('vo_add_line_hint')}</p>
          ) : null}
        </div>

        <div className={cn('p-4 border-t flex justify-between items-center shrink-0', isDark ? 'border-gray-800' : 'border-gray-200')}>
          <div className="text-sm">
            <span className="text-gray-500">{t('vo_total_value')}: </span>
            <span className="font-bold text-blue-500">{formatMoney(previewTotal)}</span>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-500/30">
              {t('cancel')}
            </button>
            <button
              type="button"
              disabled={saving || lines.length === 0}
              onClick={() => void handleSave()}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {t('vo_save_draft')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
