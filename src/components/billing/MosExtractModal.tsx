import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ManualHelpButton } from '../help/ManualHelpButton';
import { PackageCheck, Loader2, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { mosCertificatesApi } from '../../services/local/modulesApi';
import { formatQuantity } from '../../lib/formatQuantity';
import { cn } from '../../lib/utils';
import { businessTodayYmd } from '../../lib/businessCalendar';
import { BILLING_DEFAULTS } from '../../constants/billingDefaults';
import toast from 'react-hot-toast';

export interface MosBoqRow {
  id: string;
  chapterCode?: string;
  chapterName?: string;
  sectionCode?: string;
  sectionName?: string;
  itemCode: string;
  description: string;
  unit: string;
  unitRateTotal: number;
  tenderQty?: number;
}

const DEFAULT_ON_SITE_PCT = 60;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

interface RowInput {
  supplied: string;
  pct: string;
}

interface Props {
  contractId: string;
  boqItems: MosBoqRow[];
  theme: string;
  dir?: string;
  onClose: () => void;
  onCreated: () => void;
}

export function MosExtractModal({ contractId, boqItems, theme, dir, onClose, onCreated }: Props) {
  const { t, language, locale } = useLanguage();
  const isDark = theme === 'dark';
  const isAr = language === 'ar';

  const [inputs, setInputs] = useState<Record<string, RowInput>>({});
  const [priorEquivalentMap, setPriorEquivalentMap] = useState<Record<string, number>>({});
  const [deliveryNoteRef, setDeliveryNoteRef] = useState('');
  const [extractDate, setExtractDate] = useState(businessTodayYmd());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    mosCertificatesApi
      .priorSummary(contractId)
      .then((data) => {
        if (!cancelled) setPriorEquivalentMap(data.priorEquivalentByBoqItemId ?? {});
      })
      .catch(() => {
        if (!cancelled) setPriorEquivalentMap({});
      });
    return () => {
      cancelled = true;
    };
  }, [contractId]);

  const getRow = useCallback(
    (id: string): RowInput => inputs[id] ?? { supplied: '', pct: String(DEFAULT_ON_SITE_PCT) },
    [inputs],
  );

  const setSupplied = (id: string, value: string) =>
    setInputs((prev) => ({ ...prev, [id]: { ...getRow(id), supplied: value } }));
  const setPct = (id: string, value: string) =>
    setInputs((prev) => ({ ...prev, [id]: { ...getRow(id), pct: value } }));

  const computeRow = useCallback(
    (row: MosBoqRow) => {
      const r = inputs[row.id] ?? { supplied: '', pct: String(DEFAULT_ON_SITE_PCT) };
      const supplied = Number(r.supplied) || 0;
      const pct = Number(r.pct) || 0;
      const equivalent = round2(supplied * (pct / 100));
      const priorEq = priorEquivalentMap[row.id] ?? 0;
      const equivalentCumulative = round2(priorEq + equivalent);
      const claimed = round2(equivalent * (row.unitRateTotal || 0));
      const tenderQty = row.tenderQty ?? 0;
      const exceedsTender = tenderQty > 0 && equivalentCumulative > tenderQty + 0.01;
      return { supplied, pct, equivalent, equivalentCumulative, claimed, exceedsTender, priorEq };
    },
    [inputs, priorEquivalentMap],
  );

  const totals = useMemo(() => {
    let claimed = 0;
    let count = 0;
    for (const row of boqItems) {
      const { supplied, claimed: rowClaimed } = computeRow(row);
      if (supplied > 0) {
        claimed += rowClaimed;
        count += 1;
      }
    }
    return { claimed: round2(claimed), count };
  }, [boqItems, computeRow]);

  const chapters = useMemo(() => {
    const map: Record<string, MosBoqRow[]> = {};
    for (const item of boqItems) {
      const ch = item.chapterName || (isAr ? 'غير مصنف' : 'Uncategorized');
      (map[ch] ??= []).push(item);
    }
    return map;
  }, [boqItems, isAr]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const selected = boqItems
        .map((row) => ({ row, ...computeRow(row) }))
        .filter((x) => x.supplied > 0 && x.pct > 0 && x.pct <= 100);

      if (selected.length === 0) {
        toast.error(t('mos_validation_required'));
        return;
      }

      const overTender = selected.filter((x) => x.exceedsTender);
      if (overTender.length > 0) {
        toast.error(t('mos_exceeds_tender'));
        return;
      }

      setSaving(true);
      try {
        const created = await mosCertificatesApi.create({
          contractId,
          extractDate,
          deliveryNoteRef: deliveryNoteRef.trim() || undefined,
          notes: notes.trim() || undefined,
          lines: selected.map(({ row, supplied, pct }) => ({
            boqItemId: row.id,
            suppliedQtyThisPeriod: supplied,
            onSitePercentage: pct,
            unitPrice: row.unitRateTotal || 0,
          })),
        });
        toast.success(
          t('mos_certificate_saved').replace('{n}', created.certificateNo ?? ''),
        );
        onCreated();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(t('mos_create_failed'), { description: msg } as Parameters<typeof toast.error>[1]);
      } finally {
        setSaving(false);
      }
    },
    [boqItems, computeRow, contractId, deliveryNoteRef, extractDate, notes, onCreated, t],
  );

  const inputCls = cn(
    'w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 transition-colors',
    isDark ? 'bg-gray-900 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-900',
  );
  const numCls = cn(
    'w-20 border rounded py-1.5 px-2 text-center outline-none focus:border-blue-500 transition-colors font-mono',
    isDark ? 'bg-gray-900 border-gray-800 text-white' : 'bg-white border-gray-300 text-gray-900',
  );
  const labelCls = 'text-[10px] font-bold text-gray-400 uppercase';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto bg-black/60 backdrop-blur-sm"
      dir={dir}
    >
      <div
        className={cn(
          'relative w-full max-w-6xl max-h-[92vh] flex flex-col rounded-2xl border shadow-2xl',
          isDark ? 'bg-[#151619] border-gray-800' : 'bg-white border-gray-200',
        )}
      >
        <div
          className={cn(
            'shrink-0 flex items-center justify-between gap-3 p-5 border-b',
            isDark ? 'border-gray-800' : 'border-gray-200',
          )}
        >
          <div className="flex items-center gap-2">
            <PackageCheck size={22} className="text-blue-500" />
            <h3 className="text-lg font-bold">{t('mos_modal_title')}</h3>
            <ManualHelpButton topicId="technical.billing.mos" size={16} />
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-red-400 transition-colors">
            <X size={22} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>{t('mos_field_date')}</label>
                <input
                  type="date"
                  value={extractDate}
                  onChange={(e) => setExtractDate(e.target.value)}
                  className={inputCls}
                  required
                />
              </div>
              <div>
                <label className={labelCls}>{t('mos_field_delivery_note')}</label>
                <input
                  type="text"
                  value={deliveryNoteRef}
                  onChange={(e) => setDeliveryNoteRef(e.target.value)}
                  className={inputCls}
                  placeholder={isAr ? 'رقم إذن الاستلام' : 'Delivery note ref'}
                />
              </div>
              <div>
                <label className={labelCls}>{t('mos_field_notes')}</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            <p className="text-xs text-gray-500">{t('mos_supplied_this_period_hint')}</p>

            <div className="space-y-2">
              <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">
                {isAr ? 'بنود الأعمال' : 'Work Items'}
              </h4>
              <div className="overflow-x-auto border border-gray-800 rounded-xl">
                <table className={cn('w-full text-right text-[10px]', isDark ? 'bg-transparent' : 'bg-white')}>
                  <thead>
                    <tr
                      className={cn(
                        isDark
                          ? 'border-b border-gray-800 bg-gray-900/50 text-gray-500'
                          : 'border-b border-gray-200 bg-gray-50 text-gray-600',
                      )}
                    >
                      <th className="p-2">{t('mos_col_section')}</th>
                      <th className="p-2">{t('mos_col_item')}</th>
                      <th className="p-2">{t('unit')}</th>
                      <th className="p-2">{t('mos_col_tender_qty')}</th>
                      <th className="p-2">{t('mos_col_rate')}</th>
                      <th className="p-2">{t('mos_col_prior')}</th>
                      <th className="p-2">{t('mos_col_supplied_this_period')}</th>
                      <th className="p-2">{t('mos_col_percentage')}</th>
                      <th className="p-2">{t('mos_col_equivalent_qty')}</th>
                      <th className="p-2">{t('mos_col_equivalent_cumulative')}</th>
                      <th className="p-2">{t('mos_col_claimed')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {Object.entries(chapters).map(([chapterName, items], chapterIdx) => {
                      const chapterClaimed = items.reduce((s, it) => s + computeRow(it).claimed, 0);
                      return (
                        <React.Fragment key={`mos-ch-${chapterIdx}-${chapterName || '—'}`}>
                          {items.map((row, rowIdx) => {
                            const r = getRow(row.id);
                            const { equivalent, equivalentCumulative, claimed, exceedsTender, priorEq } =
                              computeRow(row);
                            return (
                              <tr
                                key={`mos-row-${chapterIdx}-${rowIdx}-${row.id}`}
                                className={exceedsTender ? 'bg-red-900/10' : undefined}
                              >
                                <td className="p-2">
                                  <div>{row.sectionName}</div>
                                  <div className="text-[8px] opacity-50">{row.sectionCode}</div>
                                </td>
                                <td className="p-2">
                                  <div className="max-w-[170px] truncate font-medium">{row.description}</div>
                                  <div className="text-[8px] text-blue-400">{row.itemCode}</div>
                                </td>
                                <td className="p-2 text-center text-gray-400">{row.unit}</td>
                                <td className="p-2 font-mono text-gray-400">
                                  {row.tenderQty?.toLocaleString(locale)}
                                </td>
                                <td className="p-2 font-mono text-gray-400">
                                  {(row.unitRateTotal || 0).toLocaleString(locale)}
                                </td>
                                <td className="p-2 font-mono text-gray-500">
                                  {formatQuantity(priorEq, language)}
                                </td>
                                <td className="p-2">
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    inputMode="decimal"
                                    value={r.supplied}
                                    onChange={(e) => setSupplied(row.id, e.target.value)}
                                    className={cn(numCls, isDark ? 'text-green-400' : 'text-green-700')}
                                  />
                                </td>
                                <td className="p-2">
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.01"
                                    inputMode="decimal"
                                    value={r.pct}
                                    onChange={(e) => setPct(row.id, e.target.value)}
                                    className={numCls}
                                  />
                                </td>
                                <td className="p-2 font-mono text-blue-400">
                                  {formatQuantity(equivalent, language)}
                                </td>
                                <td
                                  className={cn(
                                    'p-2 font-mono',
                                    exceedsTender ? 'text-red-400 font-bold' : 'text-gray-400',
                                  )}
                                >
                                  {formatQuantity(equivalentCumulative, language)}
                                </td>
                                <td className="p-2 font-mono font-bold text-green-500">
                                  {claimed.toLocaleString(locale)}
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="bg-blue-900/10 font-bold border-t border-gray-800">
                            <td
                              colSpan={10}
                              className={cn('p-3', isAr ? 'text-left' : 'text-right', 'text-gray-400')}
                            >
                              {isAr ? 'إجمالي الفصل:' : 'Chapter Total:'} {chapterName}
                            </td>
                            <td className="p-3 text-green-500 font-mono">{chapterClaimed.toLocaleString(locale)}</td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                    {boqItems.length === 0 && (
                      <tr>
                        <td colSpan={11} className="p-6 text-center text-gray-400">
                          {t('mos_empty')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div
              className={cn(
                'rounded-xl p-5 flex flex-wrap items-center justify-between gap-4 border',
                isDark ? 'bg-gray-900 border-gray-800' : 'bg-gray-50 border-gray-200',
              )}
            >
              <span className="text-sm text-gray-500">
                {t('mos_items_selected').replace('{n}', String(totals.count))}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">{t('mos_total_claimed')}</span>
                <span className="text-2xl font-black text-green-500">
                  {totals.claimed.toLocaleString(locale)} {isAr ? 'ج.م' : 'EGP'}
                </span>
              </div>
            </div>
          </div>

          <div
            className={cn(
              'shrink-0 p-4 border-t flex flex-wrap gap-3',
              isDark ? 'bg-[#151619] border-gray-800' : 'bg-white border-gray-200',
            )}
          >
            <button
              type="submit"
              disabled={saving || totals.count === 0}
              className="flex-1 min-w-[8rem] bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:opacity-60 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-white"
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : <PackageCheck size={18} />}
              {saving ? t('mos_saving') : t('mos_save')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className={cn(
                'flex-1 min-w-[8rem] py-3 rounded-xl font-bold transition-all',
                isDark ? 'bg-gray-800 hover:bg-gray-700 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700',
              )}
            >
              {t('mos_cancel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
