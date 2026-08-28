import { Loader2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';
import { useOperationProgress } from '../context/OperationProgressContext';
import { CONCORD_ORANGE } from '../lib/concordPlusBrand';
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

  const bar = (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] flex justify-center px-4 pt-2"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex w-1/2 min-w-[240px] max-w-xl items-center gap-3 rounded-lg border border-[#F58220]/45 bg-[#2a1f14]/95 px-4 py-2 text-xs text-amber-50 shadow-xl backdrop-blur-md">
        <Loader2 size={16} className="shrink-0 animate-spin text-[#F58220]" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-bold text-amber-100">{active.label}</span>
            {active.message ? (
              <span className="truncate font-mono text-[11px] text-amber-200/85">{active.message}</span>
            ) : null}
          </div>
          <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/25">
            {pct != null ? (
              <div
                className="h-full rounded-full transition-[width] duration-200 ease-out"
                style={{ width: `${pct}%`, backgroundColor: CONCORD_ORANGE }}
              />
            ) : (
              <motion.div
                className="absolute inset-y-0 w-2/5 rounded-full"
                style={{ backgroundColor: CONCORD_ORANGE }}
                animate={{ x: ['-40%', '260%'] }}
                transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
              />
            )}
          </div>
        </div>
        {countLabel ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-amber-200/90">
            {countLabel}
          </span>
        ) : null}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return bar;
  return createPortal(bar, document.body);
}
