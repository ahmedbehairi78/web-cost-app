import { Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';
import { useOperationProgress } from '../context/OperationProgressContext';
import {
  formatOperationProgressCount,
  operationProgressPct,
} from '../lib/operationProgress';

export function GlobalOperationBar() {
  const { active } = useOperationProgress();
  const { language } = useLanguage();

  if (!active) return null;

  const pct = operationProgressPct(active.current, active.total);
  const countLabel = formatOperationProgressCount(active.current, active.total, language);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[85] border-b border-blue-500/25 bg-blue-950/90 text-blue-50 shadow-lg backdrop-blur-md dark:border-blue-400/20 dark:bg-[#0a1628]/95"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 text-xs">
        <Loader2 size={16} className="shrink-0 animate-spin text-blue-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-bold text-blue-100">{active.label}</span>
            {active.message ? (
              <span className="truncate font-mono text-[11px] text-blue-300/90">{active.message}</span>
            ) : null}
          </div>
          <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-blue-900/60">
            {pct != null ? (
              <div
                className="h-full rounded-full bg-blue-400 transition-[width] duration-200 ease-out"
                style={{ width: `${pct}%` }}
              />
            ) : (
              <motion.div
                className="absolute inset-y-0 w-2/5 rounded-full bg-blue-400"
                animate={{ x: ['-40%', '260%'] }}
                transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
              />
            )}
          </div>
        </div>
        {countLabel ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-blue-200">{countLabel}</span>
        ) : null}
      </div>
    </div>
  );
}
