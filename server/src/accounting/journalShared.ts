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

export function buildIpcEntries(params: {
  worksValue: number;
  vatAmount: number;
  netPayable: number;
  execGuarantee: number;
  whtAmount: number;
  labourInsurance: number;
  manpowerLevy: number;
  advancePaymentRecovery: number;
  contractName: string;
}): JournalEntryInput[] {
  const entries: JournalEntryInput[] = [
    { accountCode: AccountCodes.RECEIVABLES,                 accountName: `ح/ عملاء عقود المقاولات - ${params.contractName}`, debit: params.netPayable,      credit: 0 },
    { accountCode: AccountCodes.RETENTION_GUARANTEE,         accountName: 'ح/ محتجز ضمان الأعمال',                           debit: params.execGuarantee,   credit: 0 },
    { accountCode: AccountCodes.WHT_RECEIVABLE,              accountName: 'ح/ مصلحة الضرائب - خصم وإضافة (مدين)',            debit: params.whtAmount,       credit: 0 },
    { accountCode: AccountCodes.SOCIAL_INSURANCE_RECEIVABLE, accountName: 'ح/ التأمينات الاجتماعية - مدين',                  debit: params.labourInsurance, credit: 0 },
    { accountCode: AccountCodes.MANPOWER_LEVY_RECEIVABLE,    accountName: 'ح/ القوى العاملة (مدين)',                         debit: params.manpowerLevy,    credit: 0 },
  ];
  if (params.advancePaymentRecovery > 0) {
    entries.push({ accountCode: AccountCodes.ADVANCE_PAYMENT, accountName: 'ح/ العملاء - دفعة مقدمة (استرداد)', debit: params.advancePaymentRecovery, credit: 0 });
  }
  entries.push(
    { accountCode: AccountCodes.REVENUE,    accountName: `ح/ إيرادات عقود المقاولات - ${params.contractName}`, debit: 0, credit: params.worksValue },
    { accountCode: AccountCodes.VAT_OUTPUT, accountName: 'ح/ ضريبة القيمة المضافة - مخرجات',                   debit: 0, credit: params.vatAmount  },
  );
  return entries;
}
