import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { shellModulePageCls } from '../lib/erpShell';
import { shellTheme, type AppTheme } from '../lib/shellTheme';
import { useLanguage } from '../context/LanguageContext';
import { usePermissions } from '../context/PermissionsContext';
import { MODULE_LABELS } from '../constants/modules';
import {
  consumePendingManualTopic,
  getManualTopic,
  resolveManualTopics,
  type ManualTopic,
  type ManualTopicId,
} from '../lib/operationsManual';
import { ManualTopicContent } from './help/ManualTopicContent';

function moduleLabel(topic: ManualTopic, language: 'ar' | 'en'): string {
  const fromLabels = MODULE_LABELS[topic.moduleId];
  if (fromLabels) return language === 'ar' ? fromLabels.ar : fromLabels.en;
  return topic.moduleId;
}

export function OperationsManual() {
  const { t, language, theme, dir } = useLanguage();
  const { permissions, isAdmin } = usePermissions();
  const isDark = theme === 'dark';

  const [query, setQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<ManualTopicId | null>(null);

  const visibleTopics = useMemo(
    () =>
      resolveManualTopics({
        permissions,
        isAdmin,
        query,
        moduleId: moduleFilter === 'all' ? undefined : moduleFilter,
      }),
    [permissions, isAdmin, query, moduleFilter],
  );

  const moduleOptions = useMemo(() => {
    const ids = new Set(visibleTopics.map((topic) => topic.moduleId));
    return Array.from(ids).sort();
  }, [visibleTopics]);

  useEffect(() => {
    const pending = consumePendingManualTopic();
    if (pending) setSelectedId(pending);
  }, []);

  useEffect(() => {
    if (selectedId && !visibleTopics.some((topic) => topic.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, visibleTopics]);

  useEffect(() => {
    if (!selectedId && visibleTopics.length > 0) {
      setSelectedId(visibleTopics[0].id);
    }
  }, [selectedId, visibleTopics]);

  const selectedTopic = selectedId ? getManualTopic(selectedId) : undefined;

  const pageCls = shellModulePageCls(
    theme as AppTheme,
    cn('p-6 overflow-y-auto h-full', isDark ? 'bg-[#0f0f0f] text-gray-100' : 'bg-white text-gray-900'),
  );

  return (
    <div dir={dir} className={pageCls}>
      <header className="mb-6 flex flex-wrap items-start gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen size={22} className="text-blue-500 shrink-0" />
          <div>
            <h1 className="text-xl font-bold">{t('manual_title')}</h1>
            <p className={cn('text-sm mt-0.5', isDark ? 'text-gray-400' : 'text-gray-600')}>
              {t('manual_subtitle')}
            </p>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={16}
            className={cn(
              'absolute top-1/2 -translate-y-1/2 pointer-events-none',
              dir === 'rtl' ? 'right-3' : 'left-3',
              isDark ? 'text-gray-500' : 'text-gray-400',
            )}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('manual_search_placeholder')}
            className={cn(
              'w-full rounded-xl border py-2 text-sm',
              dir === 'rtl' ? 'pr-9 pl-3' : 'pl-9 pr-3',
              isDark ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200',
            )}
          />
        </div>
        <select
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          className={cn(
            'rounded-xl border px-3 py-2 text-sm min-w-[160px]',
            isDark ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200',
          )}
        >
          <option value="all">{t('manual_filter_all')}</option>
          {moduleOptions.map((id) => (
            <option key={id} value={id}>
              {MODULE_LABELS[id]
                ? language === 'ar'
                  ? MODULE_LABELS[id].ar
                  : MODULE_LABELS[id].en
                : id}
            </option>
          ))}
        </select>
      </div>

      {visibleTopics.length === 0 ? (
        <p className={cn('text-sm', isDark ? 'text-gray-400' : 'text-gray-600')}>
          {t('manual_no_results')}
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,280px)_1fr] gap-4 min-h-0">
          <nav
            className={cn(
              'rounded-xl border overflow-y-auto max-h-[min(60vh,520px)] p-2 space-y-1',
              isDark ? 'border-gray-800 bg-gray-900/50' : 'border-gray-200 bg-gray-50',
            )}
          >
            {visibleTopics.map((topic) => (
              <button
                key={topic.id}
                type="button"
                onClick={() => setSelectedId(topic.id)}
                className={cn(
                  'w-full text-start rounded-lg px-3 py-2 text-sm transition-colors',
                  selectedId === topic.id
                    ? 'bg-blue-600 text-white'
                    : isDark
                      ? 'text-gray-200 hover:bg-gray-800'
                      : 'text-gray-800 hover:bg-white',
                )}
              >
                <div className="font-semibold leading-snug">{t(topic.labelKey)}</div>
                <div
                  className={cn(
                    'text-xs mt-0.5 truncate',
                    selectedId === topic.id ? 'text-blue-100' : isDark ? 'text-gray-500' : 'text-gray-500',
                  )}
                >
                  {moduleLabel(topic, language)}
                </div>
              </button>
            ))}
          </nav>

          <article
            className={cn(
              'rounded-xl border p-4 overflow-y-auto max-h-[min(60vh,520px)]',
              isDark ? 'border-gray-800 bg-gray-900/30' : 'border-gray-200 bg-white',
            )}
          >
            {selectedTopic ? (
              <>
                <h2 className={cn('text-lg font-bold mb-3', isDark ? 'text-white' : 'text-gray-900')}>
                  {t(selectedTopic.labelKey)}
                </h2>
                <ManualTopicContent topic={selectedTopic} t={t} theme={theme} />
              </>
            ) : (
              <p className={cn('text-sm', isDark ? 'text-gray-400' : 'text-gray-600')}>
                {t('manual_select_topic_hint')}
              </p>
            )}
          </article>
        </div>
      )}
    </div>
  );
}
