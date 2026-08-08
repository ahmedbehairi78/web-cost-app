import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ManualHelpButton } from '../help/ManualHelpButton';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../context/LanguageContext';
import { formatQuantity } from '../../lib/formatQuantity';
import { consumptionAllocationTemplatesApi } from '../../services/local/modulesApi';
import {
  allocateByPercentages,
  allocateByWeights,
  roundQty,
  sumAllocatedQuantity,
  validateAllocationLines,
  type AllocationBasis,
  type AllocationLineInput,
} from '../../lib/consumptionAllocation';
import toast from 'react-hot-toast';

export type BoqAllocationRow = {
  boqItemId: string;
  itemCode: string;
  description: string;
  sectionName?: string;
  unit: string;
  tenderQty: number;
  tenderAmount: number;
  unitRateTotal: number;
};

export type AllocationLineResult = AllocationLineInput;

import type { AppTheme } from '../../lib/shellTheme';
type Theme = AppTheme;
type BasisMode = AllocationBasis | 'template';

type SavedTemplate = {
  id: number;
  name: string;
  basis: 'boq_qty' | 'boq_value' | 'manual';
  weights: Record<string, number>;
};

function inputCls(theme: Theme) {
  return cn(
    'w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500',
    theme === 'dark'
      ? 'bg-gray-800 border-gray-600 text-gray-100'
      : 'bg-white border-gray-300 text-gray-900',
  );
}

function pctOf(total: number, part: number): string {
  if (!(total > 0) || !(part > 0)) return '0';
  return roundQty((part / total) * 100).toFixed(1);
}

function percentagesFromQuantities(
  totalIssueQty: number,
  rows: BoqAllocationRow[],
  selected: Record<string, boolean>,
  qtyByBoq: Record<string, string>,
): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const row of rows) {
    if (!selected[row.boqItemId]) continue;
    const qty = Number(String(qtyByBoq[row.boqItemId] ?? '').replace(/,/g, '')) || 0;
    if (qty > 0 && totalIssueQty > 0) {
      weights[row.boqItemId] = roundQty((qty / totalIssueQty) * 100);
    }
  }
  return weights;
}

export function ConsumptionAllocationModal({
  open,
  contractId,
  materialCategoryId,
  totalIssueQty,
  unit,
  rows,
  loading,
  theme,
  onClose,
  onApply,
}: {
  open: boolean;
  contractId: string;
  materialCategoryId: number | '';
  totalIssueQty: number;
  unit: string;
  rows: BoqAllocationRow[];
  loading?: boolean;
  theme: Theme;
  onClose: () => void;
  onApply: (lines: AllocationLineResult[]) => void;
}) {
  const { t, language } = useLanguage();
  const [basis, setBasis] = useState<BasisMode>('boq_qty');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [qtyByBoq, setQtyByBoq] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('');
  const [templateName, setTemplateName] = useState('Default');
  const [savingTemplate, setSavingTemplate] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextSelected: Record<string, boolean> = {};
    const nextQty: Record<string, string> = {};
    for (const row of rows) {
      nextSelected[row.boqItemId] = true;
      nextQty[row.boqItemId] = '';
    }
    setSelected(nextSelected);
    setQtyByBoq(nextQty);
    setBasis('boq_qty');
    setSelectedTemplateId('');
    setTemplateName('Default');
  }, [open, rows]);

  useEffect(() => {
    if (!open || !contractId || !materialCategoryId) {
      setTemplates([]);
      return;
    }
    setLoadingTemplates(true);
    consumptionAllocationTemplatesApi
      .list(contractId, Number(materialCategoryId))
      .then((list) => setTemplates(Array.isArray(list) ? list : []))
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTemplates(false));
  }, [open, contractId, materialCategoryId]);

  const activeLines = useMemo(
    () =>
      rows
        .filter((row) => selected[row.boqItemId])
        .map((row) => ({
          boqItemId: row.boqItemId,
          quantity: Number(String(qtyByBoq[row.boqItemId] ?? '').replace(/,/g, '')) || 0,
        }))
        .filter((line) => line.quantity > 0),
    [rows, selected, qtyByBoq],
  );

  const validation = useMemo(
    () =>
      validateAllocationLines({
        totalIssued: totalIssueQty,
        lines: activeLines,
        maxAvailable: Number.POSITIVE_INFINITY,
      }),
    [totalIssueQty, activeLines],
  );

  const allocatedTotal = useMemo(
    () =>
      sumAllocatedQuantity(
        rows.map((row) => ({
          quantity: Number(String(qtyByBoq[row.boqItemId] ?? '').replace(/,/g, '')) || 0,
        })),
      ),
    [rows, qtyByBoq],
  );

  const remaining = roundQty(totalIssueQty - allocatedTotal);
  const totalsMatch = Math.abs(remaining) <= 0.01;

  const applyAllocations = useCallback((allocations: Record<string, number>) => {
    setQtyByBoq((prev) => {
      const next = { ...prev };
      for (const row of rows) {
        const qty = allocations[row.boqItemId] ?? 0;
        next[row.boqItemId] = qty > 0 ? String(qty) : '';
      }
      return next;
    });
    setSelected((prev) => {
      const next = { ...prev };
      for (const row of rows) {
        const qty = allocations[row.boqItemId] ?? 0;
        next[row.boqItemId] = qty > 0;
      }
      return next;
    });
  }, [rows]);

  const runAutoDistribute = useCallback(() => {
    const weightItems = rows.map((row) => ({
      boqItemId: row.boqItemId,
      selected: !!selected[row.boqItemId],
      tenderQty: row.tenderQty,
      tenderAmount: row.tenderAmount,
      unitRateTotal: row.unitRateTotal,
    }));
    const allocBasis: AllocationBasis = basis === 'template' ? 'boq_qty' : basis;
    const { allocations, error } = allocateByWeights(totalIssueQty, weightItems, allocBasis);
    if (error) return;
    applyAllocations(allocations);
  }, [rows, selected, basis, totalIssueQty, applyAllocations]);

  const applyTemplateById = (templateId: number) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    const nextSelected: Record<string, boolean> = {};
    for (const row of rows) {
      nextSelected[row.boqItemId] = Object.prototype.hasOwnProperty.call(template.weights, row.boqItemId);
    }
    setSelected(nextSelected);
    const { allocations, error } = allocateByPercentages(totalIssueQty, template.weights);
    if (error) return;
    applyAllocations(allocations);
    toast.success(t('consume_alloc_template_applied'));
  };

  const handleSaveTemplate = async () => {
    if (!contractId || !materialCategoryId) return;
    const weights = percentagesFromQuantities(totalIssueQty, rows, selected, qtyByBoq);
    if (Object.keys(weights).length === 0) {
      toast.error(t('consume_alloc_mismatch'));
      return;
    }
    setSavingTemplate(true);
    try {
      await consumptionAllocationTemplatesApi.save({
        contractId,
        materialCategoryId: Number(materialCategoryId),
        name: templateName.trim() || 'Default',
        basis: basis === 'template' ? 'manual' : basis,
        weights,
      });
      const list = await consumptionAllocationTemplatesApi.list(contractId, Number(materialCategoryId));
      setTemplates(Array.isArray(list) ? list : []);
      toast.success(t('consume_alloc_template_saved'));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('toast_boq_import_error'));
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleApply = () => {
    if (!validation.ok) return;
    onApply(activeLines);
    onClose();
  };

  if (!open) return null;

  const panelCls = cn(
    'rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col',
    theme === 'dark' ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900',
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className={panelCls}>
        <div className="p-4 border-b border-gray-700/30 shrink-0">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold">{t('consume_alloc_title')}</h3>
            <ManualHelpButton topicId="inventory.consumption.multi_boq" size={16} />
          </div>
          <div className="flex flex-wrap items-center gap-4 mt-3 text-sm">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="consume-alloc-basis"
                checked={basis === 'boq_qty'}
                onChange={() => setBasis('boq_qty')}
              />
              {t('consume_alloc_basis_qty')}
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="consume-alloc-basis"
                checked={basis === 'boq_value'}
                onChange={() => setBasis('boq_value')}
              />
              {t('consume_alloc_basis_value')}
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="consume-alloc-basis"
                checked={basis === 'template'}
                onChange={() => setBasis('template')}
              />
              {t('consume_alloc_basis_template')}
            </label>
            {basis !== 'template' && (
              <button
                type="button"
                onClick={runAutoDistribute}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs"
              >
                {t('consume_alloc_auto')}
              </button>
            )}
          </div>
          {basis === 'template' && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1">
                <label className="block text-xs mb-1">{t('consume_alloc_template_select')}</label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : '';
                    setSelectedTemplateId(id);
                    if (id) applyTemplateById(id);
                  }}
                  className={inputCls(theme)}
                  disabled={loadingTemplates}
                >
                  <option value="">{t('consume_alloc_template_select')}</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-40">
              <label className="block text-xs mb-1">{t('consume_alloc_template_name')}</label>
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                className={inputCls(theme)}
              />
            </div>
            <button
              type="button"
              onClick={handleSaveTemplate}
              disabled={savingTemplate || !validation.ok}
              className="px-3 py-2 rounded-lg border text-xs disabled:opacity-50"
            >
              {savingTemplate ? <Loader2 className="w-4 h-4 animate-spin inline" /> : t('consume_alloc_template_save')}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-500 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-amber-600">{t('consume_alloc_no_boq')}</p>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className={cn('text-xs uppercase', theme === 'dark' ? 'bg-gray-800' : 'bg-gray-50')}>
                  <tr>
                    <th className="p-2 text-center">{t('consume_alloc_col_select')}</th>
                    <th className="p-2 text-start">{t('consume_alloc_col_section')}</th>
                    <th className="p-2 text-start">{t('consume_alloc_col_item')}</th>
                    <th className="p-2 text-center">{t('consume_alloc_col_unit')}</th>
                    <th className="p-2 text-end">{t('consume_alloc_col_tender_qty')}</th>
                    <th className="p-2 text-end">{t('consume_alloc_col_pct')}</th>
                    <th className="p-2 text-end">{t('consume_alloc_col_qty')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/20">
                  {rows.map((row, idx) => {
                    const qty = Number(String(qtyByBoq[row.boqItemId] ?? '').replace(/,/g, '')) || 0;
                    return (
                      <tr key={row.boqItemId || `alloc-row-${idx}`}>
                        <td className="p-2 text-center">
                          <input
                            type="checkbox"
                            checked={!!selected[row.boqItemId]}
                            onChange={(e) =>
                              setSelected((prev) => ({ ...prev, [row.boqItemId]: e.target.checked }))
                            }
                          />
                        </td>
                        <td className="p-2">{row.sectionName || '—'}</td>
                        <td className="p-2">
                          <div className="font-medium">{row.description}</div>
                          <div className="text-xs text-blue-500">{row.itemCode}</div>
                        </td>
                        <td className="p-2 text-center">{row.unit}</td>
                        <td className="p-2 text-end font-mono">{formatQuantity(row.tenderQty, language)}</td>
                        <td className="p-2 text-end font-mono">{pctOf(totalIssueQty, qty)}%</td>
                        <td className="p-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            disabled={!selected[row.boqItemId]}
                            value={qtyByBoq[row.boqItemId] ?? ''}
                            onChange={(e) =>
                              setQtyByBoq((prev) => ({ ...prev, [row.boqItemId]: e.target.value }))
                            }
                            className={inputCls(theme)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div
          className={cn(
            'p-4 border-t shrink-0 flex flex-wrap items-center justify-between gap-3',
            theme === 'dark' ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50',
          )}
        >
          <div className="text-sm flex flex-wrap gap-4">
            <span>
              {t('consume_alloc_issued')}:{' '}
              <strong className="font-mono">{formatQuantity(totalIssueQty, language)}</strong> {unit}
            </span>
            <span>
              {t('consume_alloc_allocated')}:{' '}
              <strong className="font-mono">{formatQuantity(allocatedTotal, language)}</strong>
            </span>
            <span className={totalsMatch ? 'text-green-600' : 'text-red-600'}>
              {t('consume_alloc_remaining')}:{' '}
              <strong className="font-mono">{formatQuantity(remaining, language)}</strong>
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className={cn(
                'px-4 py-2 rounded-lg border text-sm',
                theme === 'dark' ? 'border-gray-600 hover:bg-gray-700' : 'border-gray-300 hover:bg-white',
              )}
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!validation.ok || rows.length === 0}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50"
            >
              {t('consume_alloc_apply')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
