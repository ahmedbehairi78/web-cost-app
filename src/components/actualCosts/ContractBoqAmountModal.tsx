import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { AppTheme } from '../../lib/shellTheme';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../context/LanguageContext';
import { allocateByWeights, type AllocationBasis } from '../../lib/consumptionAllocation';
import { MONEY_TOLERANCE, roundMoney } from '../../lib/money';

export type ContractBoqRow = {
  boqItemId: string;
  itemCode: string;
  description: string;
  tenderQty: number;
  tenderAmount: number;
  unitRateTotal: number;
};

type Props = {
  open: boolean;
  totalAmount: number;
  rows: ContractBoqRow[];
  theme: AppTheme;
  onClose: () => void;
  onApply: (lines: Array<{ boqItemId: string; amount: number }>) => void;
};

export function ContractBoqAmountModal({ open, totalAmount, rows, theme, onClose, onApply }: Props) {
  const { t, language } = useLanguage();
  const [basis, setBasis] = useState<AllocationBasis>('boq_value');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [amountByBoq, setAmountByBoq] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const init: Record<string, boolean> = {};
    for (const r of rows) init[r.boqItemId] = true;
    setSelected(init);
    setAmountByBoq({});
  }, [open, rows]);

  const allocated = useMemo(() => {
    const items = rows.map((r) => ({
      boqItemId: r.boqItemId,
      selected: !!selected[r.boqItemId],
      tenderQty: r.tenderQty,
      tenderAmount: r.tenderAmount,
      unitRateTotal: r.unitRateTotal,
    }));
    const { allocations } = allocateByWeights(totalAmount, items, basis);
    return allocations;
  }, [rows, selected, totalAmount, basis]);

  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const [id, amt] of Object.entries(allocated)) {
      next[id] = String(roundMoney(amt));
    }
    setAmountByBoq(next);
  }, [allocated, open]);

  const sum = useMemo(
    () => Object.entries(amountByBoq).reduce((s, [id, v]) => (selected[id] ? s + (Number(v) || 0) : s), 0),
    [amountByBoq, selected],
  );

  if (!open) return null;

  const panelCls = cn(
    'fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50',
  );
  const boxCls = cn(
    'w-full max-w-3xl max-h-[85vh] overflow-auto rounded-2xl border p-6 shadow-xl',
    theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200',
  );

  return (
    <div className={panelCls} role="dialog">
      <div className={boxCls}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">{t('contract_expense_allocate')}</h3>
          <button type="button" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="flex gap-2 mb-4">
          {(['boq_qty', 'boq_value'] as AllocationBasis[]).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBasis(b)}
              className={cn('px-3 py-1 rounded-lg text-sm font-bold', basis === b ? 'bg-blue-600 text-white' : 'bg-gray-700/30')}
            >
              {b === 'boq_qty' ? (language === 'ar' ? 'كمية BOQ' : 'BOQ qty') : (language === 'ar' ? 'قيمة BOQ' : 'BOQ value')}
            </button>
          ))}
        </div>
        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="text-gray-500 border-b">
              <th className="py-1" />
              <th className="py-1 text-start">{t('item_code')}</th>
              <th className="py-1 text-start">{t('description')}</th>
              <th className="py-1 text-end">{t('total_amount')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.boqItemId} className="border-b border-gray-800/30">
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={!!selected[row.boqItemId]}
                    onChange={(e) => setSelected((s) => ({ ...s, [row.boqItemId]: e.target.checked }))}
                  />
                </td>
                <td className="py-2 font-mono">{row.itemCode}</td>
                <td className="py-2">{row.description}</td>
                <td className="py-2 text-end">
                  <input
                    className="w-28 border rounded px-2 py-1 text-end"
                    value={amountByBoq[row.boqItemId] ?? ''}
                    disabled={!selected[row.boqItemId]}
                    onChange={(e) => setAmountByBoq((m) => ({ ...m, [row.boqItemId]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={cn('text-sm mb-4', Math.abs(sum - totalAmount) > MONEY_TOLERANCE ? 'text-red-500' : 'text-green-600')}>
          {language === 'ar' ? `المجموع: ${roundMoney(sum)} / ${roundMoney(totalAmount)}` : `Total: ${roundMoney(sum)} / ${roundMoney(totalAmount)}`}
        </p>
        <div className="flex gap-2 justify-end">
          <button type="button" className="px-4 py-2 rounded-xl border" onClick={onClose}>{t('cancel')}</button>
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-blue-600 text-white font-bold"
            onClick={() => {
              const lines = rows
                .filter((r) => selected[r.boqItemId])
                .map((r) => ({
                  boqItemId: r.boqItemId,
                  amount: roundMoney(Number(amountByBoq[r.boqItemId]) || 0),
                }))
                .filter((l) => l.amount > 0);
              onApply(lines);
              onClose();
            }}
          >
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
