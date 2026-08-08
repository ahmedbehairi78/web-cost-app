import React, { useMemo } from 'react';
import { Search, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../context/LanguageContext';
import type { JournalAccountScope, JournalQueryFilters } from '../../lib/journalFilters';
import type { Account } from '../../services/accountingService';
import { SearchableSelect } from '../ui/SearchableSelect';
import { chartLeafAccountOptions } from '../../lib/chartOfAccountsPicker';
import { ManualHelpButton } from '../help/ManualHelpButton';

interface Project { id: string; projectName: string; projectCode: string; projectNameEn?: string }

interface Props {
  filters: JournalQueryFilters;
  onChange: (next: JournalQueryFilters) => void;
  onApply: () => void;
  onReset: () => void;
  projects: Project[];
  accounts: Account[];
  theme: string;
  applied: boolean;
  variant?: 'journal' | 'statement';
  layout?: 'sidebar' | 'bar';
}

export function JournalFilterPanel({
  filters,
  onChange,
  onApply,
  onReset,
  projects,
  accounts,
  theme,
  applied,
  variant = 'journal',
  layout = 'bar',
}: Props) {
  const { language, t, dir } = useLanguage();
  const isAr = language === 'ar';
  const isStatement = variant === 'statement';
  const isSidebar = layout === 'sidebar';
  const accountScope: JournalAccountScope = filters.accountScope ?? 'single';
  const isRangeScope = accountScope === 'range';

  const leafAccountOptions = useMemo(
    () =>
      chartLeafAccountOptions(accounts, isAr ? 'ar' : 'en', {
        value: '',
        label: t('gl_journal_account_any'),
        secondary: '',
      }),
    [accounts, isAr, t],
  );

  const cardCls = cn(
    'rounded-xl border transition-colors',
    isSidebar ? 'p-4 space-y-4' : 'p-5 mb-6 shadow-lg',
    theme === 'dark' ? 'bg-[#151619] border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200',
  );

  const inputCls = cn(
    'w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark'
      ? 'bg-gray-900 border-gray-800 text-gray-100'
      : theme === 'soft'
        ? 'bg-white border-[#cfd8dc] text-[#37474f]'
        : 'bg-white border-gray-300 text-gray-900',
  );

  const labelCls = cn(
    'block text-xs font-bold mb-1.5',
    theme === 'dark' ? 'text-gray-400' : 'text-gray-500',
  );

  const sectionTitleCls = 'text-xs font-bold uppercase tracking-wide text-gray-500';

  const btnSmCls = cn(
    'inline-flex items-center justify-center gap-1 rounded-lg text-xs font-bold transition-colors',
    theme === 'dark' ? 'border-gray-700' : 'border-gray-200',
  );

  const toggleProject = (id: string) => {
    const set = new Set(filters.projectIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange({ ...filters, projectIds: [...set] });
  };

  const setAccountScope = (scope: JournalAccountScope) => {
    if (scope === 'single') {
      onChange({ ...filters, accountScope: scope, accountTo: '' });
    } else {
      onChange({ ...filters, accountScope: scope });
    }
  };

  const filterTitle = isStatement ? t('gl_statement_filter_title') : t('gl_journal_filter_title');
  const applyLabel = isStatement ? t('gl_statement_apply_filters') : t('gl_journal_apply_filters');
  const helpTopic = isStatement ? 'ledger.statement' : 'ledger.journal.filters';

  const accountFromLabel = isRangeScope
    ? t('gl_journal_account_from')
    : (isStatement ? t('gl_statement_account_label') : t('gl_journal_account_single_label'));

  const inner = (
    <>
      <div className={cn('flex flex-wrap items-center justify-between gap-3', !isSidebar && 'mb-4')}>
        <div className="flex items-center gap-2">
          <h3 className={cn('font-black text-blue-500', isSidebar ? 'text-sm font-bold' : 'text-sm')}>{filterTitle}</h3>
          <ManualHelpButton topicId={helpTopic} size={14} />
        </div>
        {applied && (
          <span className={cn('text-xs', theme === 'dark' ? 'text-emerald-400' : 'text-emerald-700')}>
            {t('gl_journal_filter_applied')}
          </span>
        )}
      </div>

      {!applied && !isSidebar && (
        <p className={cn('text-sm mb-4', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>
          {isStatement ? t('gl_statement_filter_hint') : t('gl_journal_filter_hint')}
        </p>
      )}

      <div className={cn(
        isSidebar ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4',
      )}>
        <div className="min-w-0">
          <label className={labelCls} htmlFor="journal-date-from">{t('gl_journal_date_from')}</label>
          <input
            id="journal-date-from"
            type="date"
            className={inputCls}
            value={filters.dateFrom}
            onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
          />
        </div>
        <div className="min-w-0">
          <label className={labelCls} htmlFor="journal-date-to">{t('gl_journal_date_to')}</label>
          <input
            id="journal-date-to"
            type="date"
            className={inputCls}
            value={filters.dateTo}
            onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
          />
        </div>
        {!isSidebar && (
          <>
            <div>
              <label className={labelCls}>{t('gl_journal_account_from')}</label>
              <SearchableSelect
                value={filters.accountFrom}
                onChange={(v) => onChange({ ...filters, accountFrom: v })}
                theme={theme}
                dir={dir}
                placeholder={t('gl_journal_account_any')}
                options={leafAccountOptions}
              />
            </div>
            <div>
              <label className={labelCls}>{t('gl_journal_account_to')}</label>
              <SearchableSelect
                value={filters.accountTo}
                onChange={(v) => onChange({ ...filters, accountTo: v })}
                theme={theme}
                dir={dir}
                placeholder={t('gl_journal_account_any')}
                options={leafAccountOptions}
              />
            </div>
          </>
        )}
      </div>

      {isSidebar && (
        <>
          <div className={cn('pt-3 border-t space-y-2.5', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
            <p className={sectionTitleCls}>{t('gl_journal_account_scope')}</p>
            <div className="grid grid-cols-2 gap-2">
              {(['single', 'range'] as const).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => setAccountScope(scope)}
                  className={cn(
                    btnSmCls,
                    'border py-2 px-2',
                    accountScope === scope
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : theme === 'dark'
                        ? 'border-gray-700 text-gray-300 hover:bg-gray-800'
                        : 'border-gray-200 text-gray-700 hover:bg-gray-50',
                  )}
                >
                  {scope === 'single' ? t('gl_journal_account_single') : t('gl_journal_account_range')}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="min-w-0">
              <label className={labelCls}>{accountFromLabel}</label>
              <SearchableSelect
                value={filters.accountFrom}
                onChange={(v) => onChange({ ...filters, accountFrom: v })}
                theme={theme}
                dir={dir}
                placeholder={t('gl_journal_account_any')}
                options={leafAccountOptions}
              />
            </div>
            <div className={cn('min-w-0 transition-opacity', !isRangeScope && 'opacity-40 pointer-events-none')}>
              <label className={labelCls}>{t('gl_journal_account_to')}</label>
              <SearchableSelect
                value={filters.accountTo}
                onChange={(v) => onChange({ ...filters, accountTo: v })}
                theme={theme}
                dir={dir}
                placeholder={t('gl_journal_account_any')}
                options={leafAccountOptions}
              />
            </div>
          </div>
        </>
      )}

      <div className={isSidebar ? undefined : 'mb-4'}>
        <p className={labelCls}>{t('gl_journal_projects')}</p>
        {!isSidebar && (
          <p className={cn('text-xs mb-2', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
            {t('gl_journal_projects_hint')}
          </p>
        )}
        <div
          className={cn(
            'flex flex-wrap gap-2 overflow-y-auto p-3 rounded-lg border',
            isSidebar ? 'max-h-24' : 'max-h-32',
            theme === 'dark' ? 'border-gray-800 bg-gray-900/40' : theme === 'soft' ? 'border-[#cfd8dc] bg-[#eceff1]/50' : 'border-gray-200 bg-gray-50',
          )}
        >
          {projects.length === 0 ? (
            <span className="text-xs text-gray-500">{t('gl_journal_no_projects')}</span>
          ) : (
            projects.map((p, pi) => {
              const checked = filters.projectIds.includes(p.id);
              const name = isAr ? p.projectName : (p.projectNameEn || p.projectName);
              return (
                <label
                  key={p.id || `proj-filter-${p.projectCode}-${pi}`}
                  className={cn(
                    'inline-flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer border transition-colors',
                    checked
                      ? 'bg-blue-600/15 border-blue-500/50 text-blue-500'
                      : theme === 'dark'
                        ? 'border-gray-700 text-gray-400 hover:border-gray-600'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300',
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => toggleProject(p.id)}
                  />
                  <span className="font-mono text-[10px] opacity-70">{p.projectCode}</span>
                  <span className="truncate max-w-[8rem]">{name}</span>
                </label>
              );
            })
          )}
        </div>
      </div>

      <div className={cn('flex flex-wrap gap-2', isSidebar && cn('pt-3 border-t', theme === 'dark' ? 'border-gray-800' : 'border-gray-200'))}>
        <button
          type="button"
          onClick={onApply}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-colors"
        >
          <Search size={16} />
          {applyLabel}
        </button>
        <button
          type="button"
          onClick={onReset}
          className={cn(
            'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold border transition-colors',
            theme === 'dark'
              ? 'border-gray-700 text-gray-300 hover:bg-gray-800'
              : 'border-gray-300 text-gray-700 hover:bg-gray-100',
          )}
        >
          <RotateCcw size={16} />
          {t('gl_journal_reset_filters')}
        </button>
      </div>
    </>
  );

  if (isSidebar) {
    return (
      <aside
        className={cn(
          cardCls,
          'w-full md:flex-[2] md:min-w-[17rem] md:max-w-[24rem] shrink-0 md:sticky md:top-4 order-1 md:order-none',
        )}
      >
        {inner}
      </aside>
    );
  }

  return <div className={cardCls}>{inner}</div>;
}
