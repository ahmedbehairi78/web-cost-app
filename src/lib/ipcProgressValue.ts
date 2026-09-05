/**
 * Unified IPC works value: cumulative qty × rate × manual completion %.
 * Used by client billing and subcontractor works IPCs.
 * Cover-JLL consumes the resulting totals — it does not re-derive the formula.
 */
import { roundMoney } from './money';

export type IpcProgressLine = {
  previousQty?: number | null;
  currentQty?: number | null;
  totalQty?: number | null;
  rate?: number | null;
  /** Manual to-date completion % for this certificate (0–100). */
  completionPct?: number | null;
  /**
   * Completion % as of the end of the prior approved certificate for this line.
   * Used to compute prior to-date value / period increment.
   * Defaults to 0 when omitted (first certificate).
   */
  previousCompletionPct?: number | null;
};

/** Clamp / coerce a completion percentage to 0–100. */
export function normalizeCompletionPct(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

export function ipcLineTotalQty(line: {
  previousQty?: number | null;
  currentQty?: number | null;
  totalQty?: number | null;
}): number {
  if (line.totalQty != null && Number.isFinite(Number(line.totalQty))) {
    return Number(line.totalQty);
  }
  return Number(line.previousQty || 0) + Number(line.currentQty || 0);
}

/**
 * To-date works value = totalQty × rate × (completionPct / 100).
 * When completionPct is null/undefined, treat as 100% (legacy qty×rate behaviour).
 */
export function ipcLineToDateValue(line: IpcProgressLine): number {
  const qty = ipcLineTotalQty(line);
  const rate = Number(line.rate || 0);
  const hasPct = line.completionPct != null && Number.isFinite(Number(line.completionPct));
  const pct = hasPct ? normalizeCompletionPct(line.completionPct, 100) : 100;
  return roundMoney(qty * rate * (pct / 100));
}

/**
 * Prior to-date value at the start of this certificate
 * = previousQty × rate × (previousCompletionPct / 100).
 * When previousCompletionPct omitted, 0 (nothing billed yet at %).
 * Legacy: if previousCompletionPct is null/undefined AND completionPct is also
 * omitted, fall back to previousQty × rate (100%).
 */
export function ipcLinePriorToDateValue(line: IpcProgressLine): number {
  const qty = Number(line.previousQty || 0);
  const rate = Number(line.rate || 0);
  const hasPrevPct =
    line.previousCompletionPct != null && Number.isFinite(Number(line.previousCompletionPct));
  const hasCurrPct =
    line.completionPct != null && Number.isFinite(Number(line.completionPct));
  if (!hasPrevPct && !hasCurrPct) {
    return roundMoney(qty * rate);
  }
  const pct = hasPrevPct ? normalizeCompletionPct(line.previousCompletionPct, 0) : 0;
  return roundMoney(qty * rate * (pct / 100));
}

/**
 * Period works = to-date this certificate − prior to-date.
 * Never negative (clamp at 0) for posting / summaries.
 */
export function ipcLinePeriodValue(line: IpcProgressLine, priorToDateValue?: number): number {
  const toDate = ipcLineToDateValue(line);
  const prior =
    priorToDateValue != null && Number.isFinite(Number(priorToDateValue))
      ? roundMoney(Number(priorToDateValue))
      : ipcLinePriorToDateValue(line);
  return roundMoney(Math.max(0, toDate - prior));
}

export function sumIpcPeriodValues(lines: IpcProgressLine[]): number {
  return roundMoney(lines.reduce((s, line) => s + ipcLinePeriodValue(line), 0));
}

export function sumIpcToDateValues(lines: IpcProgressLine[]): number {
  return roundMoney(lines.reduce((s, line) => s + ipcLineToDateValue(line), 0));
}
