import React, { useMemo } from 'react';
import { Layers, Loader2 } from 'lucide-react';
import { cn, listKey } from '../../lib/utils';
import { formatMoney as formatMoneyLib } from '../../lib/money';
import { isLocalBackend } from '../../lib/dataBackend';
import { useApiQuery } from '../../hooks/useApiQuery';
import { reportsApi, type BoqCostBreakdownResponse, type BoqCostLevel } from '../../services/local/modulesApi';
import { SearchableSelect } from '../ui/SearchableSelect';

type UiTokens = {
  card: string;
  borderSoft: string;
  divider: string;
  rowHover: string;
  headRow: string;
  mutedText: string;
  chipBlue: string;
  chipPurple: string;
  input: string;
};

export type BoqCostBreakdownReportProps = {
  selectedProjectId: string;
  selectedContractId: string;
  costLevel: BoqCostLevel;
  onCostLevelChange: (level: BoqCostLevel) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  theme: string;
  language: string;
  dir: string;
  locale: string;
  ui: UiTokens;
  t: (key: string) => string;
  /** When letterhead already shows the report title. */
  hideDocTitle?: boolean;
};

function formatMoney(value: number, locale: string) {
  return formatMoneyLib(value, locale);
}

export function BoqCostBreakdownReport({
  selectedProjectId,
  selectedContractId,
  costLevel,
  onCostLevelChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  theme,
  language,
  dir,
  locale,
  ui,
  t,
  hideDocTitle = false,
}: BoqCostBreakdownReportProps) {
  const isAr = language === 'ar';

  const { data, loading, error } = useApiQuery<BoqCostBreakdownResponse>(
    () =>
      reportsApi
        .boqCostBreakdown({
          projectId: selectedProjectId,
          contractId: selectedContractId,
          level: costLevel,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        })
        .then((response) => [response]),
    [selectedProjectId, selectedContractId, costLevel, dateFrom, dateTo],
    { enabled: isLocalBackend },
  );

  const report = data[0];
  const rows = report?.rows ?? [];
  const totals = report?.totals ?? { directCost: 0, indirectCost: 0, totalCost: 0 };

  const levelOptions = useMemo(
    () => [
      { value: 'project' as const, label: t('report_level_project') },
      { value: 'contract' as const, label: t('report_level_contract') },
      { value: 'boq_item' as const, label: t('report_level_boq_item') },
    ],
    [t],
  );

  if (!isLocalBackend) {
    return (
      <div className="p-8">
        <p className={cn('text-sm', ui.mutedText)}>{t('report_cost_local_only')}</p>
      </div>
    );
  }

  return (
    <div className="p-8" dir={dir}>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {!hideDocTitle ? (
          <div className="flex items-center gap-3 mb-2 w-full">
            <Layers className="text-violet-500" size={32} />
            <h3 className="text-2xl font-black">{t('report_cost_breakdown')}</h3>
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-3 w-full">
          <div>
            <label className={cn('block text-[10px] font-bold uppercase mb-1', ui.mutedText)}>
              {t('report_cost_level')}
            </label>
            <SearchableSelect
              value={costLevel}
              onChange={(v) => onCostLevelChange(v as BoqCostLevel)}
              theme={theme}
              dir={dir}
              className="w-52"
              options={levelOptions.map((o) => ({ value: o.value, label: o.label }))}
            />
          </div>
          <div>
            <label className={cn('block text-[10px] font-bold uppercase mb-1', ui.mutedText)}>
              {isAr ? 'من تاريخ' : 'From'}
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              className={cn('rounded-lg border px-3 py-2 text-sm', ui.input)}
            />
          </div>
          <div>
            <label className={cn('block text-[10px] font-bold uppercase mb-1', ui.mutedText)}>
              {isAr ? 'إلى تاريخ' : 'To'}
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              className={cn('rounded-lg border px-3 py-2 text-sm', ui.input)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3 w-full mt-2">
          <div className={cn('px-4 py-3 rounded-xl border text-sm', ui.chipBlue)}>
            <span className={cn('text-[10px] font-bold uppercase block', ui.mutedText)}>{t('report_direct_costs')}</span>
            <span className="font-mono font-bold tabular-nums">{formatMoney(totals.directCost, locale)}</span>
          </div>
          <div className={cn('px-4 py-3 rounded-xl border text-sm', ui.chipPurple)}>
            <span className={cn('text-[10px] font-bold uppercase block', ui.mutedText)}>{t('report_indirect_allocated')}</span>
            <span className="font-mono font-bold tabular-nums">{formatMoney(totals.indirectCost, locale)}</span>
          </div>
          <div className={cn('px-4 py-3 rounded-xl border text-sm', theme === 'dark' ? 'border-gray-700' : 'border-gray-200')}>
            <span className={cn('text-[10px] font-bold uppercase block', ui.mutedText)}>{t('report_total_costs')}</span>
            <span className="font-mono font-bold tabular-nums">{formatMoney(totals.totalCost, locale)}</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 gap-3 text-gray-500">
          <Loader2 className="animate-spin" size={28} />
          <span>{isAr ? 'جاري التحميل...' : 'Loading...'}</span>
        </div>
      ) : error ? (
        <p className="text-red-500 text-sm">{String(error)}</p>
      ) : rows.length === 0 ? (
        <p className={cn('text-sm py-8 text-center', ui.mutedText)}>{t('report_cost_empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse min-w-[48rem]">
            <thead>
              <tr className={cn('border-b-2', ui.borderSoft, ui.headRow)}>
                {(costLevel === 'project' || costLevel === 'contract' || costLevel === 'boq_item') && (
                  <th className={cn('px-4 py-3 text-xs font-black uppercase', ui.mutedText)}>{t('project')}</th>
                )}
                {(costLevel === 'contract' || costLevel === 'boq_item') && (
                  <th className={cn('px-4 py-3 text-xs font-black uppercase', ui.mutedText)}>{isAr ? 'العقد' : 'Contract'}</th>
                )}
                {costLevel === 'boq_item' && (
                  <>
                    <th className={cn('px-4 py-3 text-xs font-black uppercase', ui.mutedText)}>{isAr ? 'كود البند' : 'Item code'}</th>
                    <th className={cn('px-4 py-3 text-xs font-black uppercase', ui.mutedText)}>{isAr ? 'وصف البند' : 'Description'}</th>
                  </>
                )}
                <th className={cn('px-4 py-3 text-xs font-black uppercase text-end', ui.mutedText)}>{t('report_direct_costs')}</th>
                <th className={cn('px-4 py-3 text-xs font-black uppercase text-end', ui.mutedText)}>{t('report_indirect_allocated')}</th>
                <th className={cn('px-4 py-3 text-xs font-black uppercase text-end', ui.mutedText)}>{t('report_total_costs')}</th>
              </tr>
            </thead>
            <tbody className={cn('divide-y', ui.divider)}>
              {rows.map((row, ri) => {
                const key =
                  costLevel === 'project'
                    ? listKey(row.projectId, ri, 'boq-cost-project')
                    : costLevel === 'contract'
                      ? listKey(row.contractId, ri, `boq-cost-contract-${row.projectId ?? ''}`)
                      : listKey(`${row.contractId}-${row.boqItemId}`, ri, 'boq-cost-item');
                return (
                  <tr key={key} className={cn('text-sm transition-colors', ui.rowHover)}>
                    <td className="px-4 py-3 font-bold whitespace-nowrap">
                      {row.projectName}
                      {row.projectCode ? (
                        <span className={cn('block text-[10px] font-normal', ui.mutedText)}>{row.projectCode}</span>
                      ) : null}
                    </td>
                    {(costLevel === 'contract' || costLevel === 'boq_item') && (
                      <td className="px-4 py-3 whitespace-nowrap">
                        {row.contractName || row.contractNumber}
                        {row.contractNumber ? (
                          <span className={cn('block text-[10px] font-mono', ui.mutedText)}>{row.contractNumber}</span>
                        ) : null}
                      </td>
                    )}
                    {costLevel === 'boq_item' && (
                      <>
                        <td className="px-4 py-3 font-mono text-xs">{row.itemCode}</td>
                        <td className="px-4 py-3 max-w-xs truncate" title={row.boqDescription}>{row.boqDescription}</td>
                      </>
                    )}
                    <td className="px-4 py-3 font-mono tabular-nums text-end text-blue-500">{formatMoney(row.directCost, locale)}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-end text-violet-500">{formatMoney(row.indirectCost, locale)}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-end font-bold">{formatMoney(row.totalCost, locale)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className={cn('border-t-2 font-black', ui.headRow)}>
                <td
                  className="px-4 py-3"
                  colSpan={
                    costLevel === 'project' ? 1 : costLevel === 'contract' ? 2 : 4
                  }
                >
                  {isAr ? 'الإجمالي' : 'Total'}
                </td>
                <td className="px-4 py-3 font-mono tabular-nums text-end text-blue-500">{formatMoney(totals.directCost, locale)}</td>
                <td className="px-4 py-3 font-mono tabular-nums text-end text-violet-500">{formatMoney(totals.indirectCost, locale)}</td>
                <td className="px-4 py-3 font-mono tabular-nums text-end">{formatMoney(totals.totalCost, locale)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className={cn('text-xs mt-6', ui.mutedText)}>{t('report_cost_breakdown_hint')}</p>
    </div>
  );
}
