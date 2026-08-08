import { cn } from '../../lib/utils';
import { SearchableSelect } from '../ui/SearchableSelect';
import type { DashboardDatePreset, DashboardFilterState } from '../../lib/dashboardMetrics';
import { Filter } from 'lucide-react';

interface ProjectOpt {
  id: string;
  projectName?: string;
}

interface ContractOpt {
  id: string;
  projectId: string;
  contractName?: string;
  contractNumber?: string;
}

interface Props {
  filters: DashboardFilterState;
  onChange: (next: DashboardFilterState) => void;
  onPreset: (preset: DashboardDatePreset) => void;
  projects: ProjectOpt[];
  contracts: ContractOpt[];
  theme: string;
  language: string;
  t: (key: string) => string;
}

export function DashboardFilterBar({
  filters,
  onChange,
  onPreset,
  projects,
  contracts,
  theme,
  language,
  t,
}: Props) {
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  const inputCls = cn(
    'w-full px-3 py-2 rounded-lg text-sm border',
    theme === 'dark'
      ? 'bg-gray-900 border-gray-700 text-gray-100'
      : theme === 'soft'
        ? 'bg-white border-[#cfd8dc] text-[#37474f]'
        : 'bg-white border-gray-200 text-gray-900',
  );
  const chipCls = cn(
    'w-full px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors text-start',
    theme === 'dark'
      ? 'bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-500'
      : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300',
  );

  const projectOptions = [
    { value: 'all', label: t('dashboard_filter_all_projects') },
    ...projects.map((p) => ({
      value: p.id,
      label: p.projectName || p.id,
    })),
  ];

  const scopedContracts =
    filters.projectId === 'all'
      ? contracts
      : contracts.filter((c) => c.projectId === filters.projectId);

  const contractOptions = [
    { value: '', label: t('dashboard_filter_all_contracts') },
    ...scopedContracts.map((c) => ({
      value: c.id,
      label: c.contractNumber || c.contractName || c.id,
      secondary: c.contractName,
    })),
  ];

  return (
    <aside
      className={cn(
        'w-full lg:w-64 xl:w-72 shrink-0 border rounded-xl p-4 space-y-4 h-fit lg:sticky lg:top-4',
        theme === 'dark'
          ? 'bg-[#151619] border-gray-800'
          : theme === 'soft'
            ? 'bg-white border-[#cfd8dc]'
            : 'bg-white border-gray-200 shadow-sm',
      )}
      dir={dir}
    >
      <div className="flex items-center gap-2 text-sm font-bold">
        <Filter size={16} className="text-blue-500" />
        {t('dashboard_filters_title')}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-gray-500 font-bold">
          {t('dashboard_filter_period')}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {([
            ['month', 'dashboard_preset_month'],
            ['quarter', 'dashboard_preset_quarter'],
            ['year', 'dashboard_preset_year'],
            ['all', 'dashboard_preset_all'],
          ] as const).map(([preset, key]) => (
            <button key={preset} type="button" className={chipCls} onClick={() => onPreset(preset)}>
              {t(key)}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-xs text-gray-500 font-medium">
        {t('dashboard_filter_date_from')}
        <input
          type="date"
          className={inputCls}
          value={filters.dateFrom}
          onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-500 font-medium">
        {t('dashboard_filter_date_to')}
        <input
          type="date"
          className={inputCls}
          value={filters.dateTo}
          onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-500 font-medium">
        {t('dashboard_filter_project')}
        <SearchableSelect
          options={projectOptions}
          value={filters.projectId}
          onChange={(projectId) =>
            onChange({
              ...filters,
              projectId,
              contractId:
                projectId === 'all' ||
                contracts.some((c) => c.id === filters.contractId && c.projectId === projectId)
                  ? filters.contractId
                  : '',
            })
          }
          theme={theme}
          dir={dir}
          placeholder={t('dashboard_filter_all_projects')}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-500 font-medium">
        {t('dashboard_filter_contract')}
        <SearchableSelect
          options={contractOptions}
          value={filters.contractId}
          onChange={(contractId) => onChange({ ...filters, contractId })}
          theme={theme}
          dir={dir}
          placeholder={t('dashboard_filter_all_contracts')}
        />
      </label>
    </aside>
  );
}
