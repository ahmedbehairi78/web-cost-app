import { AccountCodes } from './accountCodes.js';
import { isMoneyBalanced, roundMoney } from '../lib/money.js';

export interface JournalEntryInput {
  accountCode: string;
  accountName?: string;
  debit: number;
  credit: number;
  costCenterId?: string;
}

export type JournalKind = 'fiscal_pl_close' | 'fiscal_opening';

export interface TransactionInput {
  id?: string;
  date: string;
  description: string;
  reference?: string;
  projectId?: string;
  costCenterId?: string;
  reversesReference?: string;
  undoesReversalOfReference?: string;
  entries: JournalEntryInput[];
  /** Maintenance/backfill scripts only — skip locked-period enforcement. */
  skipPeriodLock?: boolean;
  /** fiscal_opening is excluded from rolling BS/IS aggregations (avoids double-count). */
  journalKind?: JournalKind | null;
  /**
   * Stamp `date` from the server business calendar (Africa/Cairo by default),
   * ignoring any client/device-supplied date.
   */
  stampBusinessToday?: boolean;
}

/** A persisted journal transaction as returned to API callers. */
export type TransactionRecord = { id: string } & Record<string, unknown>;

export function assertBalanced(entries: JournalEntryInput[]) {
  const debit = entries.reduce((s, e) => s + roundMoney(Number(e.debit) || 0), 0);
  const credit = entries.reduce((s, e) => s + roundMoney(Number(e.credit) || 0), 0);
  if (!entries.some((e) => e.debit > 0) || !entries.some((e) => e.credit > 0)) {
    throw new Error('Journal must contain at least one debit and one credit line.');
  }
  if (!isMoneyBalanced(debit, credit)) {
    throw new Error(`Unbalanced journal: debit=${debit}, credit=${credit}`);
  }
}

export type IpcJournalParams = {
  worksValue: number;
  vatAmount: number;
  netPayable: number;
  execGuarantee: number;
  whtAmount: number;
  labourInsurance: number;
  manpowerLevy: number;
  advancePaymentRecovery: number;
  performanceSecurity?: number;
  syndicateStamp?: number;
  backCharge?: number;
  contractName: string;
};

/**
 * Client IPC journal — round each leg to 2dp, then set receivables (net) as residual
 * so Dr === Cr. Cover-JLL deductions: retention, performance security, WHT, insurance,
 * labour force, syndicate stamp, back charge, advance recovery.
 * `params.netPayable` is advisory; GL uses the derived residual.
 */
export function buildIpcEntries(params: IpcJournalParams): JournalEntryInput[] {
  const worksValue = roundMoney(params.worksValue);
  const vatAmount = roundMoney(params.vatAmount);
  const execGuarantee = roundMoney(params.execGuarantee);
  const whtAmount = roundMoney(params.whtAmount);
  const labourInsurance = roundMoney(params.labourInsurance);
  const manpowerLevy = roundMoney(params.manpowerLevy);
  const advancePaymentRecovery = roundMoney(params.advancePaymentRecovery);
  const performanceSecurity = roundMoney(params.performanceSecurity ?? 0);
  const syndicateStamp = roundMoney(params.syndicateStamp ?? 0);
  const backCharge = roundMoney(params.backCharge ?? 0);

  const creditTotal = roundMoney(worksValue + vatAmount);
  const otherDebits = roundMoney(
    execGuarantee +
      performanceSecurity +
      whtAmount +
      labourInsurance +
      manpowerLevy +
      syndicateStamp +
      backCharge +
      advancePaymentRecovery,
  );
  const netPayable = roundMoney(creditTotal - otherDebits);

  const entries: JournalEntryInput[] = [
    { accountCode: AccountCodes.RECEIVABLES, accountName: `ح/ عملاء عقود المقاولات - ${params.contractName}`, debit: netPayable, credit: 0 },
    { accountCode: AccountCodes.RETENTION_GUARANTEE, accountName: 'ح/ محتجز ضمان الأعمال', debit: execGuarantee, credit: 0 },
    { accountCode: AccountCodes.PERFORMANCE_SECURITY_RECEIVABLE, accountName: 'ح/ ضمان أداء - محتجز عملاء', debit: performanceSecurity, credit: 0 },
    { accountCode: AccountCodes.WHT_RECEIVABLE, accountName: 'ح/ مصلحة الضرائب - خصم وإضافة (مدين)', debit: whtAmount, credit: 0 },
    { accountCode: AccountCodes.SOCIAL_INSURANCE_RECEIVABLE, accountName: 'ح/ التأمينات الاجتماعية - مدين', debit: labourInsurance, credit: 0 },
    { accountCode: AccountCodes.MANPOWER_LEVY_RECEIVABLE, accountName: 'ح/ القوى العاملة (مدين)', debit: manpowerLevy, credit: 0 },
    { accountCode: AccountCodes.SYNDICATE_STAMP_RECEIVABLE, accountName: 'ح/ دمغة نقابة المهندسين (مدين)', debit: syndicateStamp, credit: 0 },
    { accountCode: AccountCodes.BACK_CHARGE_RECEIVABLE, accountName: 'ح/ مبالغ محتجزة وخصومات أخرى', debit: backCharge, credit: 0 },
  ];
  if (advancePaymentRecovery > 0) {
    entries.push({
      accountCode: AccountCodes.ADVANCE_PAYMENT,
      accountName: 'ح/ العملاء - دفعة مقدمة (استرداد)',
      debit: advancePaymentRecovery,
      credit: 0,
    });
  }
  entries.push(
    { accountCode: AccountCodes.REVENUE, accountName: `ح/ إيرادات عقود المقاولات - ${params.contractName}`, debit: 0, credit: worksValue },
    { accountCode: AccountCodes.VAT_OUTPUT, accountName: 'ح/ ضريبة القيمة المضافة - مخرجات', debit: 0, credit: vatAmount },
  );
  return entries.filter((e) => e.debit > 0 || e.credit > 0);
}
