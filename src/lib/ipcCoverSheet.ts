/**
 * Single source for Cover-JLL numbers — screen panel and print must call this.
 * BOQ rates are VAT-inclusive; Sub-Total = sum of visible work lines (no extra VAT).
 */
import { BILLING_DEFAULTS } from '../constants/billingDefaults';
import { roundMoney } from './money';
import {
  buildIpcCoverWorkDoneBlock,
  coverWhtAmount,
  coverWhtBaseExVat,
} from './ipcCoverMath';

export type IpcCoverSheetRates = {
  vatPct: number;
  whtPct: number;
  retentionPct: number;
  performancePct: number;
  insurancePct: number;
  manpowerPct: number;
  syndicatePct: number;
};

export type IpcCoverSheetInput = {
  /** To-date basic works (qty×rate, VAT-inclusive). */
  grossBasic: number;
  approvedVoWorks?: number;
  provisionalWorks?: number;
  materialsOnSite?: number;
  priceAdjustment?: number;
  rates: IpcCoverSheetRates;
  advancePaymentTotal?: number;
  advanceRecovery?: number;
  backCharge?: number;
  previousPayments?: number;
  /**
   * @deprecated Ignored — NET is always computed:
   * Sub-Total − Σ(deductions) − Advance Recovery − Previous Payments.
   */
  netPayable?: number;
};

export type IpcCoverSheetDeduction = {
  id: string;
  labelAr: string;
  labelEn: string;
  pct: number | null;
  base: number | null;
  amount: number;
  isDeduction: boolean;
};

export type IpcCoverSheetModel = {
  vatPct: number;
  grossBasic: number;
  provisionalWorks: number;
  approvedVoWorks: number;
  materialsOnSite: number;
  priceAdjustment: number;
  subTotal: number;
  whtBase: number;
  deductions: IpcCoverSheetDeduction[];
  advancePaymentTotal: number;
  advanceRecovery: number;
  advanceNet: number;
  previousPayments: number;
  netPayable: number;
};

export function defaultIpcCoverSheetRates(
  overrides: Partial<IpcCoverSheetRates> = {},
): IpcCoverSheetRates {
  return {
    vatPct: BILLING_DEFAULTS.VAT_PCT,
    whtPct: BILLING_DEFAULTS.WHT_PCT,
    retentionPct: BILLING_DEFAULTS.EXEC_GUARANTEE_PCT,
    performancePct: BILLING_DEFAULTS.PERFORMANCE_SECURITY_PCT,
    insurancePct: BILLING_DEFAULTS.LABOUR_INSURANCE_PCT,
    manpowerPct: BILLING_DEFAULTS.MANPOWER_LEVY_PCT,
    syndicatePct: BILLING_DEFAULTS.SYNDICATE_STAMP_PCT,
    ...overrides,
  };
}

/**
 * Cover-JLL sheet model. Deduction % amounts use **Sub-Total** (Excel), not period works.
 * WHT = (Sub − MOS) / (1+VAT%) × WHT%.
 * NET = Sub-Total − Σ(deductions) − Advance Recovery − Previous Payments
 * (Total Advance Payment is display-only; only Recovery reduces NET).
 */
export function buildIpcCoverSheetModel(input: IpcCoverSheetInput): IpcCoverSheetModel {
  const rates = input.rates;
  const workDone = buildIpcCoverWorkDoneBlock({
    grossBasic: input.grossBasic,
    provisionalWorks: input.provisionalWorks,
    approvedVoWorks: input.approvedVoWorks,
    materialsOnSite: input.materialsOnSite,
    priceAdjustment: input.priceAdjustment,
    vatPct: rates.vatPct,
  });
  const { subTotal, materialsOnSite: mos } = workDone;
  const whtBase = coverWhtBaseExVat(subTotal, mos, rates.vatPct);
  const whtAmount = coverWhtAmount(subTotal, mos, rates.vatPct, rates.whtPct);

  const pctAmount = (pct: number) => roundMoney(subTotal * (Number(pct || 0) / 100));

  const deductions: IpcCoverSheetDeduction[] = [
    {
      id: 'retention',
      labelAr: 'حجز ضمان أعمال',
      labelEn: 'Retention Withheld',
      pct: rates.retentionPct,
      base: subTotal,
      amount: pctAmount(rates.retentionPct),
      isDeduction: true,
    },
    {
      id: 'performance',
      labelAr: 'ضمان أداء',
      labelEn: 'Performance Security',
      pct: rates.performancePct,
      base: subTotal,
      amount: pctAmount(rates.performancePct),
      isDeduction: true,
    },
    {
      id: 'wht',
      labelAr: 'خصم وإضافة',
      labelEn: 'Less Withholding Taxes',
      pct: rates.whtPct,
      base: whtBase,
      amount: whtAmount,
      isDeduction: true,
    },
    {
      id: 'insurance',
      labelAr: 'التأمينات الاجتماعية',
      labelEn: 'Less Social Insurances',
      pct: rates.insurancePct,
      base: subTotal,
      amount: pctAmount(rates.insurancePct),
      isDeduction: true,
    },
    {
      id: 'manpower',
      labelAr: 'القوى العاملة',
      labelEn: 'Less Labour Force',
      pct: rates.manpowerPct,
      base: subTotal,
      amount: pctAmount(rates.manpowerPct),
      isDeduction: true,
    },
    {
      id: 'syndicate',
      labelAr: 'دمغة نقابة المهندسين',
      labelEn: 'Egyptian Syndicate of Engineering stamp duties',
      pct: rates.syndicatePct,
      base: subTotal,
      amount: pctAmount(rates.syndicatePct),
      isDeduction: true,
    },
    {
      id: 'back_charge',
      labelAr: 'خصومات ومبالغ محتجزة',
      labelEn: 'Back Charge & Withheld Amounts',
      pct: null,
      base: null,
      amount: roundMoney(Number(input.backCharge || 0)),
      isDeduction: true,
    },
  ];

  const advancePaymentTotal = roundMoney(Number(input.advancePaymentTotal || 0));
  const advanceRecovery = roundMoney(Number(input.advanceRecovery || 0));
  const previousPayments = roundMoney(Number(input.previousPayments || 0));
  const deductionTotal = roundMoney(
    deductions.reduce((sum, row) => sum + (row.isDeduction ? row.amount : 0), 0),
  );
  const netPayable = roundMoney(subTotal - deductionTotal - advanceRecovery - previousPayments);

  return {
    vatPct: workDone.vatPct,
    grossBasic: workDone.grossBasic,
    provisionalWorks: workDone.provisionalWorks,
    approvedVoWorks: workDone.approvedVoWorks,
    materialsOnSite: workDone.materialsOnSite,
    priceAdjustment: workDone.priceAdjustment,
    subTotal: workDone.subTotal,
    whtBase,
    deductions,
    advancePaymentTotal,
    advanceRecovery,
    advanceNet: roundMoney(advancePaymentTotal - advanceRecovery),
    previousPayments,
    netPayable,
  };
}
