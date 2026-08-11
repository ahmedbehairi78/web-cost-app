/**
 * IPC cover aggregates from a single quantities list (same rows as the IPC form).
 * Basic = original contract BOQ lines; Additional = VO-created BOQ lines.
 */
import { roundMoney } from './money';

export type IpcQtyLineKind = 'basic' | 'additional';

export type IpcCoverQtyLine = {
  boqItemId: string;
  rate: number;
  previousQty: number;
  currentQty: number;
  /** Period amount — optional; cover math never trusts this (uses qty×rate). */
  amount?: number;
};

export type IpcCoverWorkBucket = {
  previousValue: number;
  currentValue: number;
  toDateValue: number;
};

export type IpcCoverWorksSplit = {
  basic: IpcCoverWorkBucket;
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
): IpcQtyLineKind {
  const id = String(boqItemId || '').trim();
  if (id && voCreatedBoqItemIds.has(id)) return 'additional';
  return 'basic';
}

function linePreviousValue(line: IpcCoverQtyLine): number {
  return roundMoney(Number(line.previousQty || 0) * Number(line.rate || 0));
}

/**
 * Period value = current qty × rate only.
 * Never trust stored `amount` here — imports once used totalQty×rate and inflated works.
 */
function lineCurrentValue(line: IpcCoverQtyLine): number {
  return roundMoney(Number(line.currentQty || 0) * Number(line.rate || 0));
}

/**
 * To-date executed value for the qty list / print «القيمة» column:
 * totalQty × rate (previous + current). Prefer explicit totalQty when set.
 */
export function ipcLineToDateAmount(line: {
  rate: number;
  previousQty?: number;
  currentQty?: number;
  totalQty?: number;
}): number {
  const total =
    line.totalQty != null && Number.isFinite(Number(line.totalQty))
      ? Number(line.totalQty)
      : Number(line.previousQty || 0) + Number(line.currentQty || 0);
  return roundMoney(total * Number(line.rate || 0));
}

function emptyBucket(): IpcCoverWorkBucket {
  return { previousValue: 0, currentValue: 0, toDateValue: 0 };
}

/**
 * Sum previous / current / to-date work values split by basic vs VO-additional lines.
 * Cover sheet reads these totals only — quantities stay on the single list.
 */
export function buildIpcCoverWorksSplit(
  lines: IpcCoverQtyLine[],
  voCreatedBoqItemIds: ReadonlySet<string>,
): IpcCoverWorksSplit {
  const basic = emptyBucket();
  const additional = emptyBucket();

  for (const line of lines) {
    const prev = linePreviousValue(line);
    const curr = lineCurrentValue(line);
    const bucket =
      classifyIpcQtyLineKind(line.boqItemId, voCreatedBoqItemIds) === 'additional'
        ? additional
        : basic;
    bucket.previousValue = roundMoney(bucket.previousValue + prev);
    bucket.currentValue = roundMoney(bucket.currentValue + curr);
    bucket.toDateValue = roundMoney(bucket.previousValue + bucket.currentValue);
  }

  return {
    basic,
    additional,
    periodWorksTotal: roundMoney(basic.currentValue + additional.currentValue),
    toDateWorksTotal: roundMoney(basic.toDateValue + additional.toDateValue),
  };
}
