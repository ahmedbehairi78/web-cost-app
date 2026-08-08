import { cn, listKey } from '../../lib/utils';
import type { ProjectCompareRow } from '../../lib/dashboardMetrics';

type SortKey = keyof Pick<
  ProjectCompareRow,
  | 'projectName'
  | 'budget'
  | 'spent'
  | 'billed'
  | 'ipcCollected'
  | 'advances'
  | 'retention'
  | 'uncollected'
  | 'collectionPct'
  | 'cashBanks'
  | 'progressPct'
>;

interface Props {
  rows: ProjectCompareRow[];
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  theme: string;
  language: string;
  t: (key: string) => string;
  formatMoney: (n: number) => string;
}

const COLUMNS: { key: SortKey; labelKey: string; align?: 'start' | 'end' }[] = [
  { key: 'projectName', labelKey: 'dashboard_col_project', align: 'start' },
  { key: 'progressPct', labelKey: 'dashboard_col_progress' },
  { key: 'budget', labelKey: 'dashboard_col_budget' },
  { key: 'spent', labelKey: 'dashboard_col_spent' },
  { key: 'billed', labelKey: 'dashboard_col_billed' },
  { key: 'ipcCollected', labelKey: 'cash_collections' },
  { key: 'advances', labelKey: 'dashboard_col_advances' },
  { key: 'retention', labelKey: 'dashboard_col_retention' },
  { key: 'uncollected', labelKey: 'dashboard_col_uncollected' },
  { key: 'collectionPct', labelKey: 'dashboard_col_collection_pct' },
  { key: 'cashBanks', labelKey: 'dashboard_col_cash_banks' },
];

function progressLabelKey(status: ProjectCompareRow['progressStatus']): string {
  if (status === 'done') return 'dashboard_progress_done';
  if (status === 'not_started') return 'dashboard_progress_not_started';
  return 'dashboard_progress_running';
}

export function ProjectCompareTable({
  rows,
  sortKey,
  sortDir,
  onSort,
  selectedProjectId,
  onSelectProject,
  theme,
  language,
  t,
  formatMoney,
}: Props) {
  const theadCls =
    theme === 'dark' ? 'bg-gray-900/80 border-gray-800' : 'bg-gray-50 border-gray-200';
  const rowHover =
    theme === 'dark' ? 'hover:bg-gray-900/60' : 'hover:bg-blue-50/60';
  const borderCls = theme === 'dark' ? 'border-gray-800' : 'border-gray-100';

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp =
      typeof av === 'string' && typeof bv === 'string'
        ? av.localeCompare(bv, language === 'ar' ? 'ar' : 'en')
        : Number(av) - Number(bv);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <div
      className={cn(
        'border rounded-xl overflow-hidden',
        theme === 'dark' ? 'bg-[#151619] border-gray-800' : 'bg-white border-gray-200',
      )}
    >
      <div className="px-5 py-3 border-b border-inherit flex justify-between items-center">
        <h3 className="text-sm font-bold">{t('dashboard_compare_title')}</h3>
        <span className="text-[10px] text-gray-500">{t('dashboard_compare_hint')}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className={cn('border-b text-[10px] font-black uppercase text-gray-400', theadCls)}>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-3 py-2.5 cursor-pointer select-none whitespace-nowrap',
                    col.align === 'start' ? 'text-start' : 'text-end',
                  )}
                  onClick={() => onSort(col.key)}
                >
                  {t(col.labelKey)}
                  {sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-5 py-10 text-center text-gray-500">
                  {t('dashboard_compare_empty')}
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => {
                const selected = selectedProjectId === row.projectId;
                return (
                  <tr
                    key={listKey(row.projectId, i, 'cmp')}
                    className={cn(
                      'border-b transition-colors',
                      borderCls,
                      row.isUnallocated
                        ? theme === 'dark'
                          ? 'bg-gray-900/40'
                          : 'bg-gray-50'
                        : cn('cursor-pointer', rowHover),
                      selected && !row.isUnallocated
                        ? theme === 'dark'
                          ? 'bg-blue-950/40'
                          : 'bg-blue-50'
                        : '',
                    )}
                    onClick={() => {
                      if (row.isUnallocated) return;
                      onSelectProject(
                        selectedProjectId === row.projectId ? 'all' : row.projectId,
                      );
                    }}
                  >
                    <td
                      className={cn(
                        'px-3 py-2.5 font-bold text-start',
                        row.isUnallocated && 'text-gray-500 italic',
                      )}
                      title={row.isUnallocated ? t('dashboard_unallocated_hint') : undefined}
                    >
                      {row.projectName}
                    </td>
                    <td className="px-3 py-2.5 text-end min-w-[120px]">
                      <div className="flex flex-col items-end gap-1">
                        <span className="font-mono text-xs">{row.progressPct}%</span>
                        <span
                          className={cn(
                            'text-[9px] font-bold uppercase',
                            row.progressStatus === 'done'
                              ? 'text-green-500'
                              : row.progressStatus === 'not_started'
                                ? 'text-gray-400'
                                : 'text-blue-500',
                          )}
                        >
                          {t(progressLabelKey(row.progressStatus))}
                        </span>
                        <div
                          className={cn(
                            'w-full h-1.5 rounded-full overflow-hidden',
                            theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100',
                          )}
                        >
                          <div
                            className={cn(
                              'h-full rounded-full',
                              row.progressStatus === 'done' ? 'bg-green-500' : 'bg-blue-500',
                            )}
                            style={{ width: `${Math.min(row.progressPct, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-end font-mono">{formatMoney(row.budget)}</td>
                    <td className="px-3 py-2.5 text-end font-mono text-red-400">
                      {formatMoney(row.spent)}
                    </td>
                    <td className="px-3 py-2.5 text-end font-mono">{formatMoney(row.billed)}</td>
                    <td className="px-3 py-2.5 text-end font-mono text-green-500">
                      {formatMoney(row.ipcCollected)}
                    </td>
                    <td className="px-3 py-2.5 text-end font-mono text-blue-400">
                      {formatMoney(row.advances)}
                    </td>
                    <td className="px-3 py-2.5 text-end font-mono text-orange-400">
                      {formatMoney(row.retention)}
                    </td>
                    <td className="px-3 py-2.5 text-end font-mono text-red-400">
                      {formatMoney(row.uncollected)}
                    </td>
                    <td className="px-3 py-2.5 text-end font-mono">{row.collectionPct}%</td>
                    <td
                      className={cn(
                        'px-3 py-2.5 text-end font-mono',
                        row.cashBanks >= 0 ? 'text-green-500' : 'text-red-500',
                      )}
                    >
                      {formatMoney(row.cashBanks)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export type { SortKey as ProjectCompareSortKey };
