import { BILLING_DEFAULTS } from '../constants/billingDefaults';
import { roundMoney } from './money';

export type IpcCoverWorkDoneInput = {
  /** To-date basic-scope works — BOQ rates are VAT-inclusive (do not uplift again). */
  grossBasic: number;
  /** To-date optional-scope works (non-VO). */
  optionalWorks?: number;
  provisionalWorks?: number;
  approvedVoWorks?: number;
  materialsOnSite?: number;
  priceAdjustment?: number;
  vatPct?: number;
};

/**
 * Cover-JLL “WORK DONE…” block — Excel / Concord:
 * - Line amounts from the qty list are **already VAT-inclusive** (rates include VAT)
 * - VAT row = “Included” (label only — never add VAT on top)
 * - **Sub-Total = sum of visible money lines**
 */
export function buildIpcCoverWorkDoneBlock(input: IpcCoverWorkDoneInput): {
  vatPct: number;
  grossBasic: number;
  optionalWorks: number;
  provisionalWorks: number;
  approvedVoWorks: number;
  materialsOnSite: number;
  priceAdjustment: number;
  subTotal: number;
} {
  const vatPct = Number(input.vatPct ?? BILLING_DEFAULTS.VAT_PCT);
  const grossBasic = roundMoney(Number(input.grossBasic || 0));
  const optionalWorks = roundMoney(Number(input.optionalWorks || 0));
  const provisionalWorks = roundMoney(Number(input.provisionalWorks || 0));
  const approvedVoWorks = roundMoney(Number(input.approvedVoWorks || 0));
  const priceAdjustment = roundMoney(Number(input.priceAdjustment || 0));
  const materialsOnSite = roundMoney(Number(input.materialsOnSite || 0));
  const subTotal = roundMoney(
    grossBasic +
      optionalWorks +
      provisionalWorks +
      approvedVoWorks +
      materialsOnSite +
      priceAdjustment,
  );
  return {
    vatPct,
    grossBasic,
    optionalWorks,
    provisionalWorks,
    approvedVoWorks,
    materialsOnSite,
    priceAdjustment,
    subTotal,
  };
}

/** Sub-Total only — same rules as `buildIpcCoverWorkDoneBlock`. */
export function coverWorkDoneSubTotal(input: IpcCoverWorkDoneInput): number {
  return buildIpcCoverWorkDoneBlock(input).subTotal;
}

/**
 * @deprecated Alias — name implied VAT uplift; rates already include VAT.
 * Use `coverWorkDoneSubTotal` / `buildIpcCoverWorkDoneBlock`.
 */
export function coverWorkDoneSubTotalInclVat(input: {
  grossBasic: number;
  approvedVoWorks?: number;
  provisionalWorks?: number;
  materialsOnSite?: number;
  priceAdjustment?: number;
  vatPct?: number;
}): number {
  return coverWorkDoneSubTotal(input);
}

/**
 * Less Withholding Taxes base (strip VAT — no tax on tax):
 * (Sub-Total − Materials On Site) / (1 + VAT%)
 */
export function coverWhtBaseExVat(
  subTotalVatInclusive: number,
  materialsOnSite: number,
  vatPct: number = BILLING_DEFAULTS.VAT_PCT,
): number {
  const divisor = 1 + Number(vatPct || 0) / 100;
  if (!(divisor > 0)) return 0;
  return roundMoney((Number(subTotalVatInclusive || 0) - Number(materialsOnSite || 0)) / divisor);
}

/** WHT amount = base × (whtPct / 100). */
export function coverWhtAmount(
  subTotalVatInclusive: number,
  materialsOnSite: number,
  vatPct: number = BILLING_DEFAULTS.VAT_PCT,
  whtPct: number = BILLING_DEFAULTS.WHT_PCT,
): number {
  const base = coverWhtBaseExVat(subTotalVatInclusive, materialsOnSite, vatPct);
  return roundMoney(base * (Number(whtPct || 0) / 100));
}
