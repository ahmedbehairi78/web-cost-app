/**
 * IPC money: Cover-JLL NET from to-date Sub-Total; GL legs from this period only.
 *
 * Cover: NET = Sub-Total − Σ(deductions) − Advance Recovery (to date) − Previous Payments
 * WHT = (Sub − MOS) / (1+VAT%) × WHT%
 * Qty list: previous + current = to-date (cover); period = current only (GL works).
 */
import { BILLING_DEFAULTS } from '../constants/billingDefaults';
import { buildIpcCoverWorksSplit, type IpcCoverQtyLine } from './ipcCoverFromQtyList';
import { coverWhtAmount } from './ipcCoverMath';
import {
  buildIpcCoverSheetModel,
  defaultIpcCoverSheetRates,
  type IpcCoverSheetModel,
  type IpcCoverSheetRates,
} from './ipcCoverSheet';
import { roundMoney } from './money';

export type IpcBillingAmountsInput = {
  items: IpcCoverQtyLine[];
  voCreatedBoqItemIds?: ReadonlySet<string>;
  materialsOnSite?: number;
  priceAdjustment?: number;
  rates: Partial<IpcCoverSheetRates>;
  advancePaymentTotal?: number;
  /** Cover “Recovery to Date” — cumulative. */
  advancePaymentRecovery?: number;
  /** Cover back charge to date. */
  backChargeAmount?: number;
  /** Σ netPayable of prior approved/paid IPCs. */
  previousPayments?: number;
  /**
   * Prior certificates’ stored recovery / back-charge (treated as to-date on each doc).
   * Period GL legs = current to-date − max(prior).
   */
  priorAdvanceRecoveryToDate?: number;
  priorBackChargeToDate?: number;
};

export type IpcBillingAmounts = {
  cover: IpcCoverSheetModel;
  /** Cover-JLL NET PAYMENT DUE (also stored as billing.netPayable). */
  net: number;
  subTotal: number;
  periodWorksInclVat: number;
  toDateWorksInclVat: number;
  /** Period works with embedded VAT stripped — journal revenue. */
  worksValueExVat: number;
  vat: number;
  exec: number;
  wht: number;
  insurance: number;
  levy: number;
  performanceSecurity: number;
  syndicateStamp: number;
  /** Period increment for GL. */
  backCharge: number;
  /** Period increment for GL. */
  advance: number;
};

function pctOf(base: number, pct: number): number {
  return roundMoney(base * (Number(pct || 0) / 100));
}

/**
 * Single calculator for form save, cover panel, and print.
 */
export function computeIpcBillingAmounts(input: IpcBillingAmountsInput): IpcBillingAmounts {
  const voIds = input.voCreatedBoqItemIds ?? new Set<string>();
  const mos = roundMoney(Number(input.materialsOnSite || 0));
  const priceAdjustment = roundMoney(Number(input.priceAdjustment || 0));
  const rates = defaultIpcCoverSheetRates(input.rates);
  const advancePaymentTotal = roundMoney(Number(input.advancePaymentTotal || 0));
  const advanceToDate = roundMoney(Number(input.advancePaymentRecovery || 0));
  const backChargeToDate = roundMoney(Number(input.backChargeAmount || 0));
  const previousPayments = roundMoney(Number(input.previousPayments || 0));

  const split = buildIpcCoverWorksSplit(input.items, voIds);
  const periodWorksInclVat = split.periodWorksTotal;
  const toDateWorksInclVat = split.toDateWorksTotal;

  const cover = buildIpcCoverSheetModel({
    grossBasic: split.basic.toDateValue,
    approvedVoWorks: split.additional.toDateValue,
    provisionalWorks: 0,
    materialsOnSite: mos,
    priceAdjustment,
    rates,
    advancePaymentTotal,
    advanceRecovery: advanceToDate,
    backCharge: backChargeToDate,
    previousPayments,
  });

  const vatDivisor = 100 + Number(rates.vatPct || 0);
  const vat =
    vatDivisor > 0
      ? roundMoney((periodWorksInclVat * Number(rates.vatPct || 0)) / vatDivisor)
      : 0;
  const worksValueExVat = roundMoney(periodWorksInclVat - vat);

  const exec = pctOf(periodWorksInclVat, rates.retentionPct);
  const performanceSecurity = pctOf(periodWorksInclVat, rates.performancePct);
  const insurance = pctOf(periodWorksInclVat, rates.insurancePct);
  const levy = pctOf(periodWorksInclVat, rates.manpowerPct);
  const syndicateStamp = pctOf(periodWorksInclVat, rates.syndicatePct);

  // Period WHT = to-date Cover WHT − WHT on works before this period (same MOS).
  const whtToDate = cover.deductions.find((d) => d.id === 'wht')?.amount ?? 0;
  const prevSub = roundMoney(cover.subTotal - periodWorksInclVat);
  const whtPrev =
    prevSub > 0
      ? coverWhtAmount(prevSub, mos, rates.vatPct, rates.whtPct)
      : 0;
  const wht = roundMoney(Math.max(0, whtToDate - whtPrev));

  const priorAdv = roundMoney(Number(input.priorAdvanceRecoveryToDate || 0));
  const priorBc = roundMoney(Number(input.priorBackChargeToDate || 0));
  const advance = roundMoney(Math.max(0, advanceToDate - priorAdv));
  const backCharge = roundMoney(Math.max(0, backChargeToDate - priorBc));

  return {
    cover,
    net: cover.netPayable,
    subTotal: cover.subTotal,
    periodWorksInclVat,
    toDateWorksInclVat,
    worksValueExVat,
    vat,
    exec,
    wht,
    insurance,
    levy,
    performanceSecurity,
    syndicateStamp,
    backCharge,
    advance,
  };
}

/** Defaults for empty form (tests / callers). */
export function defaultIpcBillingRates(
  overrides: Partial<IpcCoverSheetRates> = {},
): IpcCoverSheetRates {
  return defaultIpcCoverSheetRates({
    vatPct: BILLING_DEFAULTS.VAT_PCT,
    whtPct: BILLING_DEFAULTS.WHT_PCT,
    retentionPct: BILLING_DEFAULTS.EXEC_GUARANTEE_PCT,
    performancePct: BILLING_DEFAULTS.PERFORMANCE_SECURITY_PCT,
    insurancePct: BILLING_DEFAULTS.LABOUR_INSURANCE_PCT,
    manpowerPct: BILLING_DEFAULTS.MANPOWER_LEVY_PCT,
    syndicatePct: BILLING_DEFAULTS.SYNDICATE_STAMP_PCT,
    ...overrides,
  });
}
