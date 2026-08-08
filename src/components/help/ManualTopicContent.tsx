import React from 'react';
import { cn } from '../../lib/utils';
import type { ManualTopic } from '../../lib/operationsManual';

interface ManualTopicContentProps {
  topic: ManualTopic;
  t: (key: string) => string;
  theme: string;
  compact?: boolean;
}

export function ManualTopicContent({ topic, t, theme, compact = false }: ManualTopicContentProps) {
  const isDark = theme === 'dark';
  const muted = isDark ? 'text-gray-400' : 'text-gray-600';
  const heading = isDark ? 'text-gray-100' : 'text-gray-900';
  const panel = isDark ? 'bg-gray-900/60 border-gray-700' : 'bg-gray-50 border-gray-200';

  return (
    <div className={cn('space-y-3', compact ? 'text-sm' : 'text-sm')}>
      <p className={cn('leading-relaxed', muted)}>{t(topic.summaryKey)}</p>

      {topic.beforeYouStartKey && (
        <section>
          <h4 className={cn('font-bold mb-1', heading)}>{t('manual_before_you_start')}</h4>
          <p className={cn('leading-relaxed', muted)}>{t(topic.beforeYouStartKey)}</p>
        </section>
      )}

      <section>
        <h4 className={cn('font-bold mb-2', heading)}>{t('manual_steps')}</h4>
        <ol className="space-y-2 list-none counter-reset-manual">
          {topic.steps.map((step, index) => (
            <li
              key={`${topic.id}-step-${index}`}
              className={cn('rounded-lg border p-3', panel)}
            >
              <div className={cn('font-semibold mb-1', heading)}>
                {index + 1}. {t(step.titleKey)}
              </div>
              <p className={cn('leading-relaxed', muted)}>{t(step.bodyKey)}</p>
            </li>
          ))}
        </ol>
      </section>

      {topic.commonMistakesKey && (
        <section>
          <h4 className={cn('font-bold mb-1', heading)}>{t('manual_common_mistakes')}</h4>
          <p className={cn('leading-relaxed', muted)}>{t(topic.commonMistakesKey)}</p>
        </section>
      )}
    </div>
  );
}
