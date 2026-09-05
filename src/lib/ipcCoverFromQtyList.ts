/**
 * IPC cover aggregates from a single quantities list (same rows as the IPC form).
 * Basic = original contract BOQ lines (primary scope); Optional = optional-scope lines;
 * Additional = VO-created BOQ lines.
 *
 * Works values come from the IPC progress formula (qty × rate × manual %).
 * Cover-JLL does not re-derive deductions from raw qty alone.
 */
import { roundMoney } from './money';
import { type BoqScopeType, BOQ_SCOPE_OPTIONAL, normalizeBoqScopeType } from './boqScopeType';
import {
  ipcLinePeriodValue,
  ipcLinePriorToDateValue,
  ipcLineToDateValue,
} from './ipcProgressValue';

export type IpcQtyLineKind = 'basic' | 'optional' | 'additional';

export type IpcCoverQtyLine = {
  boqItemId: string;
  rate: number;
  previousQty: number;
  currentQty: number;
  /** Manual to-date completion % (0–100). */
  completionPct?: number;
  /** Completion % at end of prior approved certificate. */
  previousCompletionPct?: number;
  /** To-date amount — optional; cover prefers qty×rate×% via ipcProgressValue. */
  amount?: number;
};

export type IpcCoverWorkBucket = {
  previousValue: number;
  currentValue: number;
  toDateValue: number;
};

export type IpcCoverWorksSplit = {
  basic: IpcCoverWorkBucket;
  optional: IpcCoverWorkBucket;
  additional: IpcCoverWorkBucket;
  /** previous + current for all lines (should match worksValueExVat when amount = current only). */
  periodWorksTotal: number;
  toDateWorksTotal: number;
};

export type VoCreatedBoqRef = {
  createdBoqItemId?: string | null;
};

/** Collect BOQ item ids created by approved variation orders (`new_item`). */
export function collectVoCreatedBoqItemIds(
  orders: Array<{ status?: string; lines?: VoCreatedBoqRef[] }>,
): Set<string> {
  const ids = new Set<string>();
  for (const order of orders) {
    if (order.status && order.status !== 'approved') continue;
    for (const line of order.lines ?? []) {
      const id = line.createdBoqItemId ? String(line.createdBoqItemId).trim() : '';
      if (id) ids.add(id);
    }
  }
  return ids;
}

export function classifyIpcQtyLineKind(
  boqItemId: string,
  voCreatedBoqItemIds: ReadonlySet<string>,
  boqScopeByItemId?: ReadonlyMap<string, BoqScopeType>,
): IpcQtyLineKind {
  const id = String(boqItemId || '').trim();
  if (id && voCreatedBoqItemIds.has(id)) return 'additional';
  const scope = boqScopeByItemId?.get(id);
  if (scope === BOQ_SCOPE_OPTIONAL || normalizeBoqScopeType(scope) === BOQ_SCOPE_OPTIONAL) {
    return 'optional';
  }
  return 'basic';
}

function linePreviousValue(line: IpcCoverQtyLine): number {
  return ipcLinePriorToDateValue(line);
}

/** Period works for this line (to-date − prior), respecting manual completion %. */
function lineCurrentValue(line: IpcCoverQtyLine): number {
  return ipcLinePeriodValue(line);
}

/**
 * To-date executed value for the qty list / print «القيمة» column:
 * totalQty × rate × (completionPct/100). Without completionPct → legacy 100%.
 */
export function ipcLineToDateAmount(line: {
  rate: number;
  previousQty?: number;
  currentQty?: number;
  totalQty?: number;
  completionPct?: number;
  previousCompletionPct?: number;
}): number {
  return ipcLineToDateValue(line);
}

function emptyBucket(): IpcCoverWorkBucket {
  return { previousValue: 0, currentValue: 0, toDateValue: 0 };
}

/**
 * Sum previous / current / to-date work values split by basic / optional / VO-additional lines.
 * Cover sheet reads these totals only — quantities stay on the single list.
 */
export function buildIpcCoverWorksSplit(
  lines: IpcCoverQtyLine[],
  voCreatedBoqItemIds: ReadonlySet<string>,
  boqScopeByItemId?: ReadonlyMap<string, BoqScopeType>,
): IpcCoverWorksSplit {
  const basic = emptyBucket();
  const optional = emptyBucket();
  const additional = emptyBucket();

  for (const line of lines) {
    const prev = linePreviousValue(line);
    const curr = lineCurrentValue(line);
    const kind = classifyIpcQtyLineKind(line.boqItemId, voCreatedBoqItemIds, boqScopeByItemId);
    const bucket =
      kind === 'additional' ? additional : kind === 'optional' ? optional : basic;
    bucket.previousValue = roundMoney(bucket.previousValue + prev);
    bucket.currentValue = roundMoney(bucket.currentValue + curr);
    bucket.toDateValue = roundMoney(bucket.previousValue + bucket.currentValue);
  }

  return {
    basic,
    optional,
    additional,
    periodWorksTotal: roundMoney(
      basic.currentValue + optional.currentValue + additional.currentValue,
    ),
    toDateWorksTotal: roundMoney(
      basic.toDateValue + optional.toDateValue + additional.toDateValue,
    ),
  };
}
