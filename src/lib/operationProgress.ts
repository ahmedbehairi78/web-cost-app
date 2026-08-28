/** Shared helpers for long-running UI operations (imports, backup, etc.). */

export type OperationProgressEntry = {
  id: string;
  label: string;
  message?: string;
  current: number;
  /** `null` = indeterminate (spinner bar). */
  total: number | null;
};

export function operationProgressPct(current: number, total: number | null): number | null {
  if (total == null || total <= 0) return null;
  return Math.min(100, Math.round((current / total) * 100));
}

export function formatOperationProgressCount(
  current: number,
  total: number | null,
  language: string,
): string | null {
  if (total == null || total <= 0) return null;
  const pct = operationProgressPct(current, total);
  if (language === 'ar') {
    return pct != null ? `${current} / ${total} (${pct}٪)` : `${current} / ${total}`;
  }
  return pct != null ? `${current} / ${total} (${pct}%)` : `${current} / ${total}`;
}

/** Yield so React can paint progress bar updates during long loops. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}
