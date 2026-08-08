import React, { useEffect, useMemo, useState } from 'react';
import { ManualHelpButton } from '../help/ManualHelpButton';
import { Loader2 } from 'lucide-react';
import { cn, listKey } from '../../lib/utils';
import { useLanguage } from '../../context/LanguageContext';
import { returnOrdersApi, NetworkQueuedError } from '../../services/local/modulesApi';
import { useFormDraftAutosave } from '../../hooks/useFormDraftAutosave';
import { useOfflineUserId } from '../../hooks/useOfflineUserId';
import { FormDraftRestoreBanner } from '../offline/FormDraftRestoreBanner';
import { clearFormDraft, FORM_DRAFT_KEYS } from '../../lib/offline';
import { formatMoney as formatMoneyLib } from '../../lib/money';
import { formatQuantity } from '../../lib/formatQuantity';
import toast from 'react-hot-toast';
import type { AppTheme } from '../../lib/shellTheme';

export type ReturnOrderLineContext = {
  consumptionOrderLineId: number;
  consumptionOrderId: number;
  orderNumber: string;
  projectId: string;
  contractId: string;
  materialName: string;
  materialUnit: string;
  boqItemCode?: string;
  boqDescription?: string;
  issuedQuantity: number;
  unitCost: number;
};

type Theme = AppTheme;

const today = () => new Date().toISOString().slice(0, 10);

function fmtMoney(n: number) {
  return formatMoneyLib(n);
}

function inputCls(theme: Theme) {
  return cn(
    'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
    theme === 'dark'
      ? 'bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500'
      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400',
  );
}

type LineState = {
  selected: boolean;
  quantity: string;
  returnableQty: number | null;
  loading: boolean;
  error?: string;
};

export function ReturnOrderModal({
  projectId,
  contractId,
  candidateLines,
  seedLineIds,
  onClose,
  onSaved,
}: {
  projectId: string;
  contractId: string;
  candidateLines: ReturnOrderLineContext[];
  /** Pre-select these consumption line ids when opening. */
  seedLineIds?: number[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { language, theme, t } = useLanguage();
  const ar = language === 'ar';

  const scopedLines = useMemo(
    () =>
      candidateLines.filter(
        (l) => l.projectId === projectId && l.contractId === contractId,
      ),
    [candidateLines, projectId, contractId],
  );

  const [lineState, setLineState] = useState<Record<number, LineState>>({});
  const [reason, setReason] = useState('');
  const [returnDate, setReturnDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const offlineUserId = useOfflineUserId();
  const returnDraftKey = FORM_DRAFT_KEYS.returnOrder(projectId, contractId);
  const returnDraftValue = useMemo(
    () => ({ lineState, reason, returnDate, notes }),
    [lineState, reason, returnDate, notes],
  );
  const {
    restorePrompt: returnRestore,
    acceptRestore: acceptReturnRestore,
    dismissRestore: dismissReturnRestore,
  } = useFormDraftAutosave({
    userId: offlineUserId,
    draftKey: returnDraftKey,
    value: returnDraftValue,
    enabled: true,
    isEmpty: (v) =>
      !String(v.notes || '').trim()
      && !String(v.reason || '').trim()
      && !Object.values(v.lineState || {}).some((s) => s.selected || String(s.quantity || '').trim()),
  });

  useEffect(() => {
    const seed = new Set(seedLineIds ?? []);
    const initial: Record<number, LineState> = {};
    for (const line of scopedLines) {
      initial[line.consumptionOrderLineId] = {
        selected: seed.size === 0 ? false : seed.has(line.consumptionOrderLineId),
        quantity: '',
        returnableQty: null,
        loading: true,
      };
    }
    setLineState(initial);

    let cancelled = false;
    void (async () => {
      await Promise.all(
        scopedLines.map(async (line) => {
          try {
            const res = await returnOrdersApi.returnable(line.consumptionOrderLineId);
            const returnableQty = Number(res.line.returnableQuantity ?? 0);
            if (cancelled) return;
            setLineState((prev) => ({
              ...prev,
              [line.consumptionOrderLineId]: {
                ...(prev[line.consumptionOrderLineId] ?? {
                  selected: seed.has(line.consumptionOrderLineId),
                  quantity: '',
                }),
                returnableQty,
                loading: false,
                selected:
                  prev[line.consumptionOrderLineId]?.selected ??
                  seed.has(line.consumptionOrderLineId),
                quantity:
                  prev[line.consumptionOrderLineId]?.quantity ||
                  (seed.has(line.consumptionOrderLineId) && returnableQty > 0
                    ? String(returnableQty)
                    : ''),
              },
            }));
          } catch {
            if (cancelled) return;
            setLineState((prev) => ({
              ...prev,
              [line.consumptionOrderLineId]: {
                ...(prev[line.consumptionOrderLineId] ?? { selected: false, quantity: '' }),
                returnableQty: 0,
                loading: false,
                error: ar ? 'فشل التحميل' : 'Load failed',
              },
            }));
          }
        }),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [scopedLines, seedLineIds, ar]);

  const selectedTotal = useMemo(() => {
    let total = 0;
    for (const line of scopedLines) {
      const st = lineState[line.consumptionOrderLineId];
      if (!st?.selected) continue;
      const qty = Number(String(st.quantity).replace(/,/g, '')) || 0;
      total += qty * line.unitCost;
    }
    return total;
  }, [scopedLines, lineState]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines: Array<{ consumptionOrderLineId: number; quantity: number; reason?: string }> = [];
    for (const line of scopedLines) {
      const st = lineState[line.consumptionOrderLineId];
      if (!st?.selected) continue;
      const qty = Number(String(st.quantity).replace(/,/g, '')) || 0;
      if (!(qty > 0)) continue;
      if (st.returnableQty != null && qty > st.returnableQty + 0.01) {
        toast.error(
          `${line.materialName}: ${
            ar
              ? `الكمية تتجاوز المتاح (${formatQuantity(st.returnableQty, language)})`
              : `exceeds returnable (${formatQuantity(st.returnableQty, language)})`
          }`,
        );
        return;
      }
      lines.push({
        consumptionOrderLineId: line.consumptionOrderLineId,
        quantity: qty,
        reason: reason.trim() || undefined,
      });
    }
    if (lines.length === 0) {
      toast.error(t('return_order_need_line'));
      return;
    }

    setSaving(true);
    try {
      await returnOrdersApi.createAndConfirm({
        contractId,
        projectId,
        returnDate,
        notes: notes.trim() || undefined,
        lines,
      });
      toast.success(ar ? 'تم تأكيد الإرجاع وتحديث المخزن وBOQ' : 'Return confirmed — inventory and BOQ updated');
      if (offlineUserId) await clearFormDraft(offlineUserId, returnDraftKey);
      onSaved();
      onClose();
    } catch (err: unknown) {
      if (err instanceof NetworkQueuedError) return;
      toast.error(err instanceof Error ? err.message : ar ? 'حدث خطأ' : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  const modalCard = cn(
    'rounded-xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto',
    theme === 'dark' ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900',
  );

  const anyLoading = scopedLines.some((l) => lineState[l.consumptionOrderLineId]?.loading);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className={modalCard}>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-lg font-bold">{t('return_order_multi_title')}</h3>
          <ManualHelpButton topicId="inventory.return" size={16} />
        </div>
        <FormDraftRestoreBanner
          show={!!returnRestore}
          updatedAt={returnRestore?.updatedAt}
          onRestore={() => {
            if (!returnRestore) return;
            const p = returnRestore.payload;
            if (p.lineState) setLineState(p.lineState);
            if (typeof p.reason === 'string') setReason(p.reason);
            if (p.returnDate) setReturnDate(p.returnDate);
            if (typeof p.notes === 'string') setNotes(p.notes);
            acceptReturnRestore();
          }}
          onDiscard={() => {
            void dismissReturnRestore();
          }}
        />
        <p className={cn('text-xs mb-4', theme === 'dark' ? 'text-gray-500' : 'text-gray-500')}>
          {t('return_order_multi_hint')}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">{t('return_order_date')}</label>
            <input
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              className={inputCls(theme)}
              required
            />
          </div>

          <div>
            <p className="text-xs font-medium mb-2">{t('return_order_select_lines')}</p>
            {scopedLines.length === 0 ? (
              <p className="text-sm text-amber-600">{t('return_order_no_lines')}</p>
            ) : (
              <ul
                className={cn(
                  'rounded-lg border divide-y max-h-64 overflow-auto',
                  theme === 'dark' ? 'border-gray-700 divide-gray-700' : 'border-gray-200 divide-gray-100',
                )}
              >
                {scopedLines.map((line, idx) => {
                  const st = lineState[line.consumptionOrderLineId];
                  const returnable = st?.returnableQty ?? null;
                  const disabled = returnable === 0 || st?.loading;
                  return (
                    <li
                      key={listKey(String(line.consumptionOrderLineId), idx, 'ret')}
                      className={cn('p-3 space-y-2', disabled && 'opacity-50')}
                    >
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={Boolean(st?.selected)}
                          disabled={disabled}
                          onChange={(e) =>
                            setLineState((prev) => ({
                              ...prev,
                              [line.consumptionOrderLineId]: {
                                ...(prev[line.consumptionOrderLineId] ?? {
                                  quantity: '',
                                  returnableQty: null,
                                  loading: false,
                                }),
                                selected: e.target.checked,
                                quantity:
                                  e.target.checked &&
                                  !prev[line.consumptionOrderLineId]?.quantity &&
                                  returnable != null &&
                                  returnable > 0
                                    ? String(returnable)
                                    : prev[line.consumptionOrderLineId]?.quantity ?? '',
                              },
                            }))
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{line.materialName}</p>
                          <p className={cn('text-xs font-mono', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
                            {line.orderNumber}
                            {line.boqItemCode ? ` · BOQ ${line.boqItemCode}` : ''}
                          </p>
                          <p className="text-xs mt-0.5">
                            {st?.loading ? (
                              <span className="inline-flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin" />
                              </span>
                            ) : (
                              <>
                                {ar ? 'متاح:' : 'Returnable:'}{' '}
                                <span className="font-mono text-green-600">
                                  {formatQuantity(returnable ?? 0, language)}
                                </span>{' '}
                                {line.materialUnit}
                                {' · '}@ {fmtMoney(line.unitCost)}
                              </>
                            )}
                          </p>
                        </div>
                      </label>
                      {st?.selected && (
                        <div className="ps-6">
                          <label className="block text-[10px] mb-0.5">{t('return_order_qty')}</label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={st.quantity}
                            onChange={(e) =>
                              setLineState((prev) => ({
                                ...prev,
                                [line.consumptionOrderLineId]: {
                                  ...prev[line.consumptionOrderLineId]!,
                                  quantity: e.target.value,
                                },
                              }))
                            }
                            className={inputCls(theme)}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {selectedTotal > 0 && (
            <p className={cn('text-xs', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
              {ar ? 'إجمالي قيمة الإرجاع:' : 'Return value:'}{' '}
              <span className="font-mono font-semibold">{fmtMoney(selectedTotal)}</span>
            </p>
          )}

          <div>
            <label className="block text-xs font-medium mb-1">{t('return_order_reason')}</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={ar ? 'فائض / تالف / غير مستخدم...' : 'Surplus / damaged / unused...'}
              className={inputCls(theme)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t('return_order_notes')}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={inputCls(theme)}
            />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className={cn(
                'px-4 py-2 rounded-lg text-sm border transition-colors',
                theme === 'dark'
                  ? 'border-gray-600 text-gray-300 hover:bg-gray-800'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50',
              )}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={saving || anyLoading || scopedLines.length === 0}
              className="px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('return_order_confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
