import React, { useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { shellTheme, shellFocusRing, type AppTheme } from '../../lib/shellTheme';
import { useLanguage } from '../../context/LanguageContext';
import { playTap } from '../../lib/uiSound';
import { ShellAnchoredDropdown } from '../ShellAnchoredDropdown';
import {
  getManualTopic,
  isManualTopicAllowed,
  requestOpenManual,
  type ManualTopicId,
} from '../../lib/operationsManual';
import { usePermissions } from '../../context/PermissionsContext';
import { ManualTopicContent } from './ManualTopicContent';

interface ManualHelpButtonProps {
  topicId: ManualTopicId;
  size?: number;
  className?: string;
}

export function ManualHelpButton({ topicId, size = 18, className }: ManualHelpButtonProps) {
  const { t, theme, dir } = useLanguage();
  const { permissions, isAdmin } = usePermissions();
  const shell = shellTheme(theme as AppTheme);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const topic = getManualTopic(topicId);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      // The portal renders into document.body, so check by data-attribute instead of DOM ancestry
      if (target.closest('[data-help-panel]') || anchorRef.current?.contains(target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick, true);
    return () => document.removeEventListener('mousedown', onDocClick, true);
  }, [open]);

  if (!topic || !isManualTopicAllowed(topic, permissions, isAdmin)) return null;

  const isDark = theme === 'dark';
  const bgCls = isDark
    ? 'bg-gray-900 border-gray-700 text-gray-100'
    : 'bg-white border-gray-200 text-gray-900';

  return (
    <div className={cn('inline-flex', className)}>
      <button
        ref={anchorRef}
        type="button"
        title={t('manual_help_aria')}
        aria-label={t('manual_help_aria')}
        aria-expanded={open}
        onClick={() => {
          playTap();
          setOpen((v) => !v);
        }}
        className={cn(
          'inline-flex items-center justify-center rounded-full p-1 transition-colors',
          isDark ? 'text-blue-300 hover:bg-blue-900/40' : 'text-blue-600 hover:bg-blue-50',
          shellFocusRing(theme as AppTheme),
        )}
      >
        <HelpCircle size={size} />
      </button>

      <ShellAnchoredDropdown
        open={open}
        anchorRef={anchorRef}
        dir={dir}
        theme={theme}
        align="end"
        className={cn('w-[min(420px,calc(100vw-24px))]', bgCls)}
        role="dialog"
      >
        {/* data-help-panel carries overflow-y-auto so scrollbar clicks stay inside the check */}
        <div data-help-panel="true" className="max-h-[min(70vh,520px)] overflow-y-auto p-4">
          <h3 className={cn('font-bold text-base mb-2', isDark ? 'text-white' : 'text-gray-900')}>
            {t(topic.labelKey)}
          </h3>
          <ManualTopicContent topic={topic} t={t} theme={theme} compact />
          <div className="mt-4">
            <button
              type="button"
              onClick={() => {
                playTap();
                setOpen(false);
                requestOpenManual(topicId);
              }}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-bold',
                isDark ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-blue-600 text-white hover:bg-blue-700',
              )}
            >
              {t('manual_open_full')}
            </button>
          </div>
        </div>
      </ShellAnchoredDropdown>
    </div>
  );
}
