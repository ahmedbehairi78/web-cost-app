import {
  collection,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
  getDocs,
  getDoc,
  Timestamp,
  limit,
  writeBatch,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { CHART_OF_ACCOUNTS_SEED } from '../data/chartOfAccountsSeed';
import { isLocalBackend } from '../lib/dataBackend';
import { ensureCoaForJournalEntries } from '../lib/localCoaSync';
import { prepareLocalJournalPost } from '../lib/localJournalPost';
import { nullIfEmpty } from '../lib/localEntitySync';
import { chartOfAccountsApi, billingApi, glApi, purchaseTransactionsApi } from './local/modulesApi';
import { ApiError } from '../lib/apiClient';
import { isMoneyBalanced, roundMoney } from '../lib/money';
import { businessTodayYmd } from '../lib/businessCalendar';

// ── COA validation cache ───────────────────────────────────────────────────────
// Refreshed at most once every 5 minutes or whenever a new account is created.
let _coaValidCodes: Set<string> | null = null;
let _coaCacheAt = 0;
const COA_CACHE_TTL = 5 * 60 * 1000; // 5 min

/** Local Postgres: Express session (password or Google). Cloud legacy: Firebase user required. */
function assertJournalWriteAuth(): void {
  if (isLocalBackend) return;
  if (!auth.currentUser) throw new Error('User not authenticated');
}

async function getValidAccountCodes(): Promise<Set<string>> {
  if (_coaValidCodes && Date.now() - _coaCacheAt < COA_CACHE_TTL) {
    return _coaValidCodes;
  }
  if (isLocalBackend) {
    let accounts = (await chartOfAccountsApi.list()) as Account[];
    if (accounts.length === 0) {
      try {
        await chartOfAccountsApi.ensureMissing({});
        accounts = (await chartOfAccountsApi.list()) as Account[];
      } catch {
        // GL server upserts COA on journal post; Firestore merge below covers validation.
      }
    }
    const codes = new Set(
      accounts
        .filter(a => !a.isGroup && a.status !== 'disabled')
        .map(a => a.accountCode)
        .filter(Boolean),
    );
    _coaValidCodes = codes;
  } else {
    const snap = await getDocs(collection(db, 'chart_of_accounts'));
    _coaValidCodes = new Set(
      snap.docs
        .map(d => d.data())
        .filter(a => !a.isGroup && a.status !== 'disabled')
        .map(a => a.accountCode as string)
        .filter(Boolean),
    );
  }
  _coaCacheAt = Date.now();
  return _coaValidCodes;
}

async function addMissingSeedAccounts(
  accountCodes: string[],
  entryHints?: JournalEntry[],
): Promise<Set<string>> {
  const missingCodes = [...new Set(accountCodes.map(String).filter(Boolean))];
  if (missingCodes.length === 0) return getValidAccountCodes();

  try {
    if (isLocalBackend) {
      const hintEntries =
        entryHints ??
        missingCodes.map((code) => ({
          accountCode: code,
          accountName: code,
          debit: 0,
          credit: 0,
        }));
      await ensureCoaForJournalEntries(hintEntries);
    } else {
      const seedByCode = new Map(CHART_OF_ACCOUNTS_SEED.map((account) => [account.accountCode, account]));
      const seedMissing = missingCodes.filter((code) => seedByCode.has(code));
      if (seedMissing.length === 0) return getValidAccountCodes();
      const missingSeedAccounts = seedMissing
        .map((code) => seedByCode.get(code))
        .filter((account): account is (typeof CHART_OF_ACCOUNTS_SEED)[number] => Boolean(account));
      const batch = writeBatch(db);
      const colRef = collection(db, 'chart_of_accounts');
      for (const account of missingSeedAccounts) {
        batch.set(doc(colRef), { ...account, createdAt: serverTimestamp() });
      }
      await batch.commit();
    }
    invalidateCoaCache();
  } catch (error) {
    console.warn('Failed to auto-patch missing COA accounts:', error);
  }

  return getValidAccountCodes();
}

/** Call this after adding a new account to chart_of_accounts to force re-fetch. */
export function invalidateCoaCache(): void {
  _coaValidCodes = null;
  _coaCacheAt = 0;
}

export { bootstrapLocalCoaFromFirestore } from '../lib/localCoaSync';

export enum AccountCodes {
  // ─── الأصول المتداولة (مستوى 5 — 8 أرقام) ─────────────────────
  BANK                        = '12101001', // البنك التجاري الدولي
  CASH                        = '12102001', // عهدة نقدية
  RECEIVABLES                 = '12201001', // العملاء - مستخلصات تحت التحصيل
  RETENTION_GUARANTEE         = '12202001', // محتجزات الضمان - عملاء
  PERFORMANCE_SECURITY_RECEIVABLE = '12202002', // ضمان أداء - محتجز عملاء (Cover-JLL)
  /** وسيط استلام الشيك الوارد — مدين عند الاستلام، دائن عند التحصيل البنكي */
  RECEIVED_CHEQUES_CLEARING   = '12203001',
  BACK_CHARGE_RECEIVABLE      = '12204001', // مبالغ محتجزة / Back charge
  ADVANCE_TO_SUPPLIERS        = '12301001', // مقدمات للموردين
  ADVANCE_TO_SUBCONTRACTORS   = '12302001', // مقدمات لمقاولي الباطن
  EMPLOYEE_ADVANCES           = '12303001', // سلف العاملين (تُستردّ بخصم من الراتب)
  VAT_INPUT                   = '12401001', // ضريبة القيمة المضافة - مدخلات
  WHT_RECEIVABLE              = '12401002', // ضريبة الخصم والإضافة - مدين (محتجز من العميل)
  SOCIAL_INSURANCE_RECEIVABLE = '12402001', // التأمينات الاجتماعية - مدين
  MANPOWER_LEVY_RECEIVABLE    = '12403001', // القوى العاملة - مدين
  SYNDICATE_STAMP_RECEIVABLE  = '12404001', // دمغة نقابة المهندسين - مدين
  /** مخزون مشروع — ورقة تحت 127 بكود 8 أرقام */
  PROJECT_INVENTORY           = '12701001', // مخزون مشروع — نموذج / افتراضي
  // ─── الخصوم المتداولة (مستوى 5 — 8 أرقام، كلها تبدأ بـ 21) ──
  SUPPLIERS                   = '21101001', // الموردون (حساب المورد يُنشأ عند إضافته في المشتريات)
  SUBCONTRACTORS              = '21102001', // مقاولو الباطن (حساب المقاول يُنشأ عند إضافته)
  RETENTION_PAYABLE           = '21201001', // محتجزات ضمان الأعمال - مقاولون
  ADVANCE_PAYMENT             = '21301001', // دفعات مقدمة من العملاء
  VAT_OUTPUT                  = '21401001', // ضريبة القيمة المضافة - مخرجات
  WHT_PAYABLE                 = '21402001', // مصلحة الضرائب - خصم وإضافة (دائن)
  SOCIAL_INSURANCE_PAYABLE    = '21403001', // التأمينات الاجتماعية - دائن
  MANPOWER_LEVY_PAYABLE       = '21404001', // القوى العاملة - دائن
  PAYROLL_TAX_PAYABLE         = '21405001', // ضريبة كسب العمل - دائن
  ACCRUED_EXPENSES            = '21501001', // مصروفات مستحقة
  PAYROLL_PENALTIES_WITHHELD  = '21501002', // جزاءات وخصومات محتجزة
  SALARIES_PAYABLE            = '21501003', // رواتب وأجور مستحقة الدفع (صافي)
  /** شيكات دفع (صادرة) — دائن عند التحرير، مدين عند صرف البنك (21601001) */
  ISSUED_CHEQUES_PAYABLE      = '21601001',
  /** الأرباح المحتجزة — هدف إقفال قائمة الدخل */
  RETAINED_EARNINGS           = '31301001',
  /** جاري الشركاء — دائن أرصدة المخزون الافتتاحية */
  PARTNERS_CURRENT            = '31401001',
  // ─── الإيرادات ────────────────────────────────────────────
  REVENUE                     = '41101001', // إيرادات عقود المقاولات
  // ─── تكاليف العقود المباشرة ───────────────────────────────
  EXPENSE_MATERIALS           = '51101001', // مواد البناء
  EXPENSE_LABOUR              = '51102001', // عمالة مباشرة
  EXPENSE_SUBCONTRACTOR       = '51103001', // مقاولو الباطن - تكاليف
  EXPENSE_EQUIPMENT           = '51104001', // معدات وآلات
  // ─── مصروفات تشغيلية ──────────────────────────────────────
  EXPENSE_ADMIN               = '52101001', // رواتب وأجور إدارية
  // ─── مصروفات تمويلية ──────────────────────────────────────
  BANK_CHARGES                = '53102001', // رسوم بنكية
}

export interface JournalEntry {
  accountCode: string;
  accountName?: string;
  debit: number;
  credit: number;
  costCenterId?: string;
}

export interface Account {
  id: string;
  accountCode: string;
  accountName: string;
  accountNameEn?: string;
  parentCode: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  isGroup: boolean;
  statementType?: 'balance_sheet' | 'income_statement';
  status?: 'active' | 'disabled';
  /** When set on a 127… 8-digit leaf, links warehouse COA to a Firestore project. */
  projectId?: string;
  /** Floor for site custody 12102… leaves — used by cash budget replenish. */
  minBalance?: number;
  /** Linked suppliers directory row (creditor leaves 21101/21102). */
  supplierId?: string;
}

export interface Transaction {
  id?: string;
  date: string;
  description: string;
  descriptionEn?: string | null;
  reference?: string;
  projectId?: string;
  costCenterId?: string;
  entries: JournalEntry[];
  createdAt?: any;
  createdBy?: string;
  isDeleted?: boolean;
  /** If set, this journal reverses the entry whose `reference` equals this value */
  reversesReference?: string;
  /** If set, this journal undoes the reversal whose `reference` equals this value */
  undoesReversalOfReference?: string;
}

export interface IpcEntryParams {
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
}

/** Build the balanced journal lines for a client IPC (revenue side). Pure — used for preview + posting. */
export function buildIpcEntries(params: IpcEntryParams): JournalEntry[] {
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

  // Receivables absorbs 2dp rounding so Dr === Cr (same rule as server journalShared).
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

  const entries: JournalEntry[] = [
    { accountCode: AccountCodes.RECEIVABLES, accountName: `ح/ عملاء عقود المقاولات - ${params.contractName}`, debit: netPayable, credit: 0 },
    { accountCode: AccountCodes.RETENTION_GUARANTEE, accountName: 'ح/ محتجز ضمان الأعمال', debit: execGuarantee, credit: 0 },
    { accountCode: AccountCodes.PERFORMANCE_SECURITY_RECEIVABLE, accountName: 'ح/ ضمان أداء - محتجز عملاء', debit: performanceSecurity, credit: 0 },
    { accountCode: AccountCodes.WHT_RECEIVABLE, accountName: 'ح/ مصلحة الضرائب – خصم وإضافة (مدين)', debit: whtAmount, credit: 0 },
    { accountCode: AccountCodes.SOCIAL_INSURANCE_RECEIVABLE, accountName: 'ح/ التأمينات الاجتماعية – عمالة غير منتظمة', debit: labourInsurance, credit: 0 },
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
    { accountCode: AccountCodes.VAT_OUTPUT, accountName: 'ح/ ضريبة القيمة المضافة – مخرجات', debit: 0, credit: vatAmount },
  );
  return entries.filter((e) => e.debit > 0 || e.credit > 0);
}

export interface SubcontractorIpcEntryParams {
  worksValue: number;
  vatAmount: number;
  netPayable: number;
  execGuarantee: number;
  whtAmount: number;
  labourInsurance: number;
  manpowerLevy: number;
  advancePaymentRecovery: number;
  supplierName: string;
  supplierAccountCode?: string;
}

/** Build the balanced journal lines for a subcontractor IPC (expense side). Pure — used for preview + posting. */
export function buildSubcontractorIpcEntries(params: SubcontractorIpcEntryParams): JournalEntry[] {
  const subcontractorCode = params.supplierAccountCode || AccountCodes.SUBCONTRACTORS;
  const worksValue = roundMoney(params.worksValue);
  const vatAmount = roundMoney(params.vatAmount);
  const execGuarantee = roundMoney(params.execGuarantee);
  const whtAmount = roundMoney(params.whtAmount);
  const labourInsurance = roundMoney(params.labourInsurance);
  const manpowerLevy = roundMoney(params.manpowerLevy);
  const advancePaymentRecovery = roundMoney(params.advancePaymentRecovery);

  const expenseInclVat = roundMoney(worksValue + vatAmount);
  const otherCredits = roundMoney(
    execGuarantee + whtAmount + labourInsurance + manpowerLevy + advancePaymentRecovery,
  );
  const netPayable = roundMoney(expenseInclVat - otherCredits);

  const entries: JournalEntry[] = [
    { accountCode: AccountCodes.EXPENSE_SUBCONTRACTOR, accountName: `تكاليف مقاولو الباطن - ${params.supplierName}`, debit: expenseInclVat, credit: 0 },
    { accountCode: subcontractorCode, accountName: `مقاولو الباطن - ${params.supplierName}`, debit: 0, credit: netPayable },
    { accountCode: AccountCodes.RETENTION_PAYABLE, accountName: 'محتجز ضمان الأعمال - مقاولون', debit: 0, credit: execGuarantee },
    { accountCode: AccountCodes.WHT_PAYABLE, accountName: 'مصلحة الضرائب - خصم وإضافة (دائن)', debit: 0, credit: whtAmount },
    { accountCode: AccountCodes.SOCIAL_INSURANCE_PAYABLE, accountName: 'التأمينات الاجتماعية (دائن)', debit: 0, credit: labourInsurance },
    { accountCode: AccountCodes.MANPOWER_LEVY_PAYABLE, accountName: 'القوى العاملة (دائن)', debit: 0, credit: manpowerLevy },
  ];
  if (advancePaymentRecovery > 0) {
    entries.push({
      accountCode: AccountCodes.ADVANCE_PAYMENT,
      accountName: 'استرداد دفعة مقدمة',
      debit: 0,
      credit: advancePaymentRecovery,
    });
  }
  return entries.filter((e) => e.debit > 0 || e.credit > 0);
}

/** Business calendar today (Africa/Cairo). Prefer server stamp via `stampBusinessToday` when posting. */
function localISODate(): string {
  return businessTodayYmd();
}

/** Firestore rejects `undefined` in document data (unlike `null`). */
function omitUndefinedKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Journal / transaction payloads: omit undefined on top-level and each entry line. */
function sanitizeTransactionFirestoreData(data: { entries: JournalEntry[] } & Record<string, unknown>): Record<string, unknown> {
  const { entries, ...rest } = data;
  return omitUndefinedKeys({
    ...rest,
    entries: entries.map((e) =>
      omitUndefinedKeys({
        accountCode: e.accountCode,
        accountName: e.accountName,
        debit: e.debit,
        credit: e.credit,
      } as Record<string, unknown>),
    ),
  } as Record<string, unknown>);
}

function invertJournalEntries(entries: JournalEntry[]): JournalEntry[] {
  return entries.map((e) => {
    const inverted: JournalEntry = {
      accountCode: e.accountCode,
      accountName: e.accountName,
      debit: Number(e.credit),
      credit: Number(e.debit),
    };
    // Preserve entry-level cost center — critical for distributed journals
    // (OHA, payroll, consumption) where each line carries a different costCenterId.
    if (e.costCenterId) inverted.costCenterId = e.costCenterId;
    return inverted;
  });
}

function normalizeLoadedTransaction(tx: Transaction & { id?: string }): (Transaction & { id: string }) {
  return {
    ...tx,
    id: String(tx.id),
    entries: (tx.entries ?? []).map((e) => ({
      accountCode: String(e.accountCode ?? '').trim(),
      accountName: e.accountName,
      debit: Number(e.debit) || 0,
      credit: Number(e.credit) || 0,
    })),
  };
}

async function loadLocalTransactionById(id: string): Promise<(Transaction & { id: string }) | null> {
  try {
    const tx = await glApi.getTransaction(id);
    if (!tx || tx.isDeleted) return null;
    return normalizeLoadedTransaction(tx);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

async function loadLocalTransactionByReference(reference: string): Promise<(Transaction & { id: string }) | null> {
  try {
    const tx = await glApi.transactionByReference(reference);
    if (!tx || tx.isDeleted) return null;
    return normalizeLoadedTransaction(tx);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

async function findTransactionDocByReference(reference: string): Promise<(Transaction & { id: string }) | null> {
  const ref = reference.trim();
  if (!ref) return null;

  if (isLocalBackend) {
    const local = await loadLocalTransactionByReference(ref);
    if (local) return local;
  }

  const q = query(
    collection(db, 'transactions'),
    where('reference', '==', ref),
    limit(5),
  );
  const snap = await getDocs(q);
  const active = snap.docs
    .map((d) => ({ ...d.data(), id: d.id } as Transaction & { id: string }))
    .filter((t) => !t.isDeleted);
  if (active.length === 0) return null;
  if (active.length > 1) {
    throw new Error(
      'يوجد أكثر من قيد بنفس المرجع — صحّح التكرار يدوياً. / Multiple journal entries share this reference.',
    );
  }
  return active[0]!;
}

async function assertNoActiveReversal(origKey: string): Promise<void> {
  if (isLocalBackend) {
    const { exists } = await glApi.hasActiveReversal(origKey);
    if (exists) {
      throw new Error(
        'يوجد قيد عكس مرتبط بهذا المرجع بالفعل. / A reversing entry already exists for this reference.',
      );
    }
  }
  const revQ = query(
    collection(db, 'transactions'),
    where('reversesReference', '==', origKey),
    limit(20),
  );
  const revSnap = await getDocs(revQ);
  if (revSnap.docs.some((d) => !d.data().isDeleted)) {
    throw new Error(
      'يوجد قيد عكس مرتبط بهذا المرجع بالفعل. / A reversing entry already exists for this reference.',
    );
  }
}

async function postReversalForTransaction(orig: Transaction & { id: string }): Promise<string> {
  if (orig.reversesReference?.trim()) {
    throw new Error(
      'هذا المرجع لقيد عكسي — استخدم «إعادة عكس القيد» بمرجع قيد العكس. / This is a reversing entry. Use "Undo reversal" with the reversal reference.',
    );
  }
  const origKey = orig.reference?.trim() || orig.id;
  await assertNoActiveReversal(origKey);
  const today = localISODate();
  const refLabel = orig.reference?.trim() || orig.id;
  return createTransaction({
    date: today,
    stampBusinessToday: true,
    description: `عكس قيد — ${refLabel} / Reversal of ${refLabel}`,
    projectId: orig.projectId,
    costCenterId: orig.costCenterId,
    entries: invertJournalEntries(orig.entries ?? []),
    reversesReference: origKey,
  });
}

function consumptionJournalReference(orderNumber?: string | null, orderId?: number): string {
  const raw = String(orderNumber ?? orderId ?? '').trim();
  if (!raw) return `CON-${orderId ?? '0'}`;
  return raw.startsWith('CON-') ? raw : `CON-${raw}`;
}

/** Expense account from the GL entry posted for a consumption order (when SQLite header is empty). */
async function findConsumptionExpenseFromJournal(
  orderNumber: string
): Promise<{ accountCode: string; accountName: string } | null> {
  const ref = consumptionJournalReference(orderNumber);
  const tx = await findTransactionDocByReference(ref);
  if (!tx?.entries?.length) return null;
  const expense = tx.entries.find((e) => {
    const code = String(e.accountCode ?? '').trim();
    return code.startsWith('5') && code.length === 8 && Number(e.debit) > 0;
  });
  if (!expense) return null;
  return {
    accountCode: String(expense.accountCode).trim(),
    accountName: String(expense.accountName ?? '').trim() || 'مصروف',
  };
}

/**
 * Purchase / fixed-asset / inventory invoice: Dr (base+VAT) · Cr supplier net · Cr WHT.
 * Amounts to 2 decimals; supplier credit = (base+VAT)−WHT for an exact balance.
 * Exported so local invoice post can send entries in one atomic API call (no orphan GL).
 */
export function buildPurchaseWithholdingJournalLines(args: {
  debitAccountCode: string;
  debitAccountName: string;
  supplierAccountCode: string;
  supplierLabel: string;
  baseAmount: number;
  vatAmount: number;
  whtAmount: number;
  costCenterId?: string;
}): JournalEntry[] {
  const base = roundMoney(args.baseAmount);
  const vat = roundMoney(args.vatAmount);
  const wht = roundMoney(args.whtAmount);
  const debitInclVat = roundMoney(base + vat);
  const supplierCredit = roundMoney(debitInclVat - wht);

  const debitLine: JournalEntry = {
    accountCode: args.debitAccountCode,
    accountName: args.debitAccountName,
    debit: debitInclVat,
    credit: 0,
  };
  if (args.costCenterId) debitLine.costCenterId = args.costCenterId;

  return [
    debitLine,
    {
      accountCode: args.supplierAccountCode,
      accountName: args.supplierLabel,
      debit: 0,
      credit: supplierCredit,
    },
    {
      accountCode: AccountCodes.WHT_PAYABLE,
      accountName: 'مصلحة الضرائب - خصم وإضافة (دائن)',
      debit: 0,
      credit: wht,
    },
  ];
}

type CreateTransactionInput = Omit<Transaction, 'createdAt' | 'createdBy' | 'isDeleted'> & {
  /** Ignore device date — server (or Cairo calendar) stamps posting date. */
  stampBusinessToday?: boolean;
};

/** Creates a balanced journal entry (module-level so callers never rely on `this`). */
async function createTransaction(transaction: CreateTransactionInput): Promise<string> {
  assertJournalWriteAuth();

  const entries = transaction.entries
    .map((entry) => ({
      ...entry,
      debit: roundMoney(entry.debit),
      credit: roundMoney(entry.credit),
    }))
    .filter((entry) => entry.debit > 0 || entry.credit > 0);

  const totalDebit = entries.reduce((sum, e) => sum + e.debit, 0);
  const totalCredit = entries.reduce((sum, e) => sum + e.credit, 0);

  const hasDebit = entries.some(e => e.debit > 0);
  const hasCredit = entries.some(e => e.credit > 0);

  if (!hasDebit || !hasCredit) {
    throw new Error('Transaction must have at least one debit entry and one credit entry');
  }

  if (!isMoneyBalanced(totalDebit, totalCredit)) {
    throw new Error(`Transaction is not balanced: Total Debit (${totalDebit}) must equal Total Credit (${totalCredit})`);
  }

  await prepareLocalJournalPost(
    {
      projectId: transaction.projectId,
      costCenterId: transaction.costCenterId,
    },
    entries,
  );
  if (isLocalBackend) invalidateCoaCache();

  // Validate all account codes exist in the Chart of Accounts as active leaf accounts.
  let validCodes = await getValidAccountCodes();
  let invalidCodes = entries
    .map(e => e.accountCode)
    .filter(code => code && !validCodes.has(code));
  if (invalidCodes.length > 0) {
    validCodes = await addMissingSeedAccounts(invalidCodes, entries);
    invalidCodes = entries
      .map(e => e.accountCode)
      .filter(code => code && !validCodes.has(code));
  }
  if (invalidCodes.length > 0) {
    const hint = isLocalBackend
      ? ' — تأكد أن الحساب معرّف في شجرة الحسابات المحلية كحساب ختامي نشط.'
      : ' — يرجى الذهاب إلى الإعدادات › قاعدة البيانات وتشغيل "إكمال الحسابات الناقصة".';
    throw new Error(
      `الأكواد التالية غير موجودة في شجرة الحسابات كحسابات ختامية نشطة: ${invalidCodes.join(', ')}${hint}`,
    );
  }

  const reference = transaction.reference ||
    `JV-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  let postingDate = String(transaction.date || '').trim().slice(0, 10);
  if (transaction.stampBusinessToday) {
    if (isLocalBackend) {
      try {
        postingDate = (await glApi.businessToday()).date;
      } catch {
        postingDate = businessTodayYmd();
      }
    } else {
      postingDate = businessTodayYmd();
    }
  } else if (!postingDate) {
    postingDate = businessTodayYmd();
  }

  if (isLocalBackend) {
    const created = await glApi.createTransaction({
      date: postingDate,
      stampBusinessToday: transaction.stampBusinessToday || undefined,
      description: transaction.description,
      reference,
      projectId: nullIfEmpty(transaction.projectId),
      costCenterId: nullIfEmpty(transaction.costCenterId),
      reversesReference: transaction.reversesReference?.trim() || undefined,
      undoesReversalOfReference: transaction.undoesReversalOfReference?.trim() || undefined,
      entries,
    });
    return String(created.id);
  }

  const { stampBusinessToday: _stamp, ...firestoreTx } = transaction;
  const docRef = await addDoc(
    collection(db, 'transactions'),
    sanitizeTransactionFirestoreData({
      ...firestoreTx,
      date: postingDate,
      entries,
      reference,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser.uid,
      isDeleted: false,
    } as { entries: JournalEntry[] } & Record<string, unknown>),
  );
  return docRef.id;
}

export const accountingService = {
  createTransaction,

  /** Load a journal by id — SQLite in local mode, Firestore otherwise. */
  async getJournalTransaction(id: string): Promise<(Transaction & { id: string }) | null> {
    if (!id.trim()) return null;
    if (isLocalBackend) {
      const local = await loadLocalTransactionById(id);
      if (local) return local;
    }
    const snap = await getDoc(doc(db, 'transactions', id));
    if (!snap.exists()) return null;
    const data = normalizeLoadedTransaction({ ...snap.data(), id: snap.id } as Transaction & { id: string });
    if (data.isDeleted) return null;
    return data;
  },

  /**
   * Posts a reversing journal for the entry identified by its reference (credit↔debit).
   */
  async reverseJournalByReference(originalReference: string): Promise<string> {
    assertJournalWriteAuth();
    const orig = await findTransactionDocByReference(originalReference);
    if (!orig) {
      throw new Error('لا يوجد قيد بهذا المرجع. / No journal entry with this reference.');
    }
    return postReversalForTransaction(orig);
  },

  /** Posts a reversing journal for a stored transaction id (preferred in local/SQLite mode). */
  async reverseJournalByTransactionId(transactionId: string): Promise<string> {
    assertJournalWriteAuth();
    const orig = await accountingService.getJournalTransaction(transactionId);
    if (!orig) {
      throw new Error('لا يوجد قيد بهذا المعرّف. / No journal entry with this id.');
    }
    return postReversalForTransaction(orig);
  },

  /**
   * Posts a journal that undoes a prior reversing entry (identified by the reversal's reference).
   */
  async undoJournalReversalByReference(reversalReference: string): Promise<string> {
    assertJournalWriteAuth();
    const rev = await findTransactionDocByReference(reversalReference);
    if (!rev) {
      throw new Error('لا يوجد قيد بهذا المرجع. / No journal entry with this reference.');
    }
    if (!rev.reversesReference?.trim()) {
      throw new Error(
        'هذا المرجع لا يخص قيداً عكسياً — أدخل مرجع قيد العكس. / This reference is not a reversing journal. Enter the reversal entry reference.',
      );
    }
    const today = localISODate();
    const refLabel = rev.reference?.trim() || rev.id;
    return createTransaction({
      date: today,
      stampBusinessToday: true,
      description: `إلغاء عكس قيد — ${refLabel} / Undo reversal — ${refLabel}`,
      projectId: rev.projectId,
      costCenterId: rev.costCenterId,
      entries: invertJournalEntries(rev.entries),
      undoesReversalOfReference: rev.reference?.trim() || rev.id,
    });
  },

  /**
   * Records an expense and generates a journal entry
   */
  async recordExpense(params: {
    amount: number;
    description: string;
    projectId: string;
    costCenterId?: string;
    category: 'materials' | 'labour' | 'admin';
    date: string;
    transactionId?: string;
  }) {
    assertJournalWriteAuth();
    const expenseAccount =
      params.category === 'materials' ? AccountCodes.EXPENSE_MATERIALS :
      params.category === 'labour'    ? AccountCodes.EXPENSE_LABOUR : AccountCodes.EXPENSE_ADMIN;

    const entries: JournalEntry[] = [
      { accountCode: expenseAccount, debit: params.amount, credit: 0 },
      { accountCode: AccountCodes.BANK, debit: 0, credit: params.amount }
    ];

    const transactionData = {
      date: params.date,
      description: params.description,
      projectId: params.projectId,
      costCenterId: params.costCenterId,
      entries
    };

    if (params.transactionId) {
      const txId = typeof params.transactionId === 'string' ? params.transactionId : (params.transactionId as any).id;
      const docRef = doc(db, 'transactions', txId);
      await updateDoc(docRef, sanitizeTransactionFirestoreData(transactionData as { entries: JournalEntry[] } & Record<string, unknown>));
      return txId;
    }

    return createTransaction(transactionData);
  },

  /**
   * Records revenue (Billing/IPC) and generates a journal entry
   */
  async recordRevenue(params: {
    amount: number;
    description: string;
    projectId: string;
    costCenterId?: string;
    date: string;
  }) {
    const entries: JournalEntry[] = [
      { accountCode: AccountCodes.RECEIVABLES, debit: params.amount, credit: 0 },
      { accountCode: AccountCodes.REVENUE, debit: 0, credit: params.amount }
    ];

    return createTransaction({
      date: params.date,
      description: params.description,
      projectId: params.projectId,
      costCenterId: params.costCenterId,
      entries
    });
  },

  /**
   * Records a detailed IPC journal entry as requested
   */
  async recordIPC(params: {
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
    description: string;
    projectId: string;
    contractId: string;
    date: string;
    contractName: string;
    transactionId?: string;
  }) {
    assertJournalWriteAuth();
    const entries = buildIpcEntries(params);

    const transactionData = {
      date: params.date,
      description: params.description,
      projectId: params.projectId,
      costCenterId: params.contractId,
      entries
    };

    if (params.transactionId) {
      const txId = typeof params.transactionId === 'string' ? params.transactionId : (params.transactionId as any).id;
      const docRef = doc(db, 'transactions', txId);
      await updateDoc(docRef, sanitizeTransactionFirestoreData(transactionData as { entries: JournalEntry[] } & Record<string, unknown>));
      return txId;
    }

    return createTransaction(transactionData);
  },

  /**
   * Records a collection (Cash received) and generates a journal entry
   */
  async recordCollection(params: {
    amount: number;
    description: string;
    projectId: string;
    costCenterId?: string;
    date: string;
  }) {
    const entries: JournalEntry[] = [
      { accountCode: AccountCodes.BANK, debit: params.amount, credit: 0 },
      { accountCode: AccountCodes.RECEIVABLES, debit: 0, credit: params.amount }
    ];

    return createTransaction({
      date: params.date,
      description: params.description,
      projectId: params.projectId,
      costCenterId: params.costCenterId,
      entries
    });
  },

  /**
   * Purchase invoice → project central warehouse (Dr 127… 8-digit inventory, no expense / no cost center).
   */
  async recordPurchaseToProjectInventory(params: {
    baseAmount: number;
    vatAmount: number;
    whtAmount: number;
    totalAmount: number;
    supplierName: string;
    supplierAccountCode?: string;
    inventoryAccountCode: string;
    inventoryAccountName: string;
    description: string;
    projectId?: string;
    costCenterId?: string;
    date: string;
    reference?: string;
    transactionId?: string;
  }) {
    assertJournalWriteAuth();
    const supplierCode = params.supplierAccountCode || AccountCodes.SUPPLIERS;
    const entries = buildPurchaseWithholdingJournalLines({
      debitAccountCode: params.inventoryAccountCode,
      debitAccountName: params.inventoryAccountName,
      supplierAccountCode: supplierCode,
      supplierLabel: `موردين - ${params.supplierName}`,
      baseAmount: params.baseAmount,
      vatAmount: params.vatAmount,
      whtAmount: params.whtAmount,
    });

    const transactionData = {
      date: params.date,
      description: params.description,
      ...(params.reference ? { reference: params.reference } : {}),
      ...(params.projectId ? { projectId: params.projectId } : {}),
      ...(params.costCenterId ? { costCenterId: params.costCenterId } : {}),
      entries,
    };

    if (params.transactionId) {
      const txId =
        typeof params.transactionId === 'string'
          ? params.transactionId
          : (params.transactionId as { id: string }).id;
      const docRef = doc(db, 'transactions', txId);
      await updateDoc(
        docRef,
        sanitizeTransactionFirestoreData(transactionData as { entries: JournalEntry[] } & Record<string, unknown>)
      );
      return txId;
    }

    return createTransaction(transactionData);
  },

  /**
   * Purchase invoice on an indirect cost center: Dr expense (incl. VAT) / Cr supplier + WHT.
   * No project warehouse (127…) or inventory posting.
   */
  async recordIndirectExpenseInvoice(params: {
    baseAmount: number;
    vatAmount: number;
    whtAmount: number;
    totalAmount: number;
    supplierName: string;
    supplierAccountCode?: string;
    expenseAccountCode: string;
    expenseAccountName: string;
    description: string;
    costCenterId: string;
    date: string;
    reference?: string;
  }) {
    assertJournalWriteAuth();
    const supplierCode = params.supplierAccountCode || AccountCodes.SUPPLIERS;
    const entries = buildPurchaseWithholdingJournalLines({
      debitAccountCode: params.expenseAccountCode,
      debitAccountName: params.expenseAccountName,
      supplierAccountCode: supplierCode,
      supplierLabel: `موردين - ${params.supplierName}`,
      baseAmount: params.baseAmount,
      vatAmount: params.vatAmount,
      whtAmount: params.whtAmount,
      costCenterId: params.costCenterId,
    });

    return createTransaction({
      date: params.date,
      description: params.description,
      ...(params.reference ? { reference: params.reference } : {}),
      costCenterId: params.costCenterId,
      entries,
    });
  },

  /**
   * Fixed asset purchase: Dr assetAccountCode (11xxxx incl. VAT) / Cr supplier + WHT.
   * Used when invoice toggle «تسجيل كأصل ثابت» is on — replaces 127xxxx warehouse debit.
   */
  async recordFixedAssetPurchase(params: {
    baseAmount: number;
    vatAmount: number;
    whtAmount: number;
    totalAmount: number;
    supplierName: string;
    supplierAccountCode?: string;
    assetAccountCode: string;
    assetAccountName: string;
    description: string;
    date: string;
    reference?: string;
    transactionId?: string;
  }) {
    assertJournalWriteAuth();
    const supplierCode = params.supplierAccountCode || AccountCodes.SUPPLIERS;
    const entries = buildPurchaseWithholdingJournalLines({
      debitAccountCode: params.assetAccountCode,
      debitAccountName: params.assetAccountName,
      supplierAccountCode: supplierCode,
      supplierLabel: `موردين - ${params.supplierName}`,
      baseAmount: params.baseAmount,
      vatAmount: params.vatAmount,
      whtAmount: params.whtAmount,
    });

    const transactionData = {
      date: params.date,
      description: params.description,
      ...(params.reference ? { reference: params.reference } : {}),
      entries,
    };

    if (params.transactionId) {
      const txId =
        typeof params.transactionId === 'string'
          ? params.transactionId
          : (params.transactionId as { id: string }).id;
      const docRef = doc(db, 'transactions', txId);
      await updateDoc(
        docRef,
        sanitizeTransactionFirestoreData(transactionData as { entries: JournalEntry[] } & Record<string, unknown>)
      );
      return txId;
    }

    return createTransaction(transactionData);
  },

  /** Consumption issue: Dr contract expense / Cr project inventory (127… 8-digit). */
  async recordConsumptionIssue(params: {
    totalCost: number;
    expenseAccountCode?: string;
    expenseAccountName?: string;
    inventoryAccountCode: string;
    inventoryAccountName: string;
    description: string;
    projectId: string;
    contractId: string;
    date: string;
    reference?: string;
  }) {
    assertJournalWriteAuth();
    const expenseCode = String(params.expenseAccountCode || '').trim() || AccountCodes.EXPENSE_MATERIALS;
    const entries: JournalEntry[] = [
      {
        accountCode: expenseCode,
        accountName: params.expenseAccountName || 'مواد البناء',
        debit: params.totalCost,
        credit: 0,
      },
      {
        accountCode: params.inventoryAccountCode,
        accountName: params.inventoryAccountName,
        debit: 0,
        credit: params.totalCost,
      },
    ];

    return createTransaction({
      date: params.date,
      description: params.description,
      reference: params.reference,
      projectId: params.projectId,
      costCenterId: params.contractId,
      entries,
    });
  },

  /**
   * Inter-project warehouse transfer (final approval): Dr destination 127… / Cr source 127… at transfer cost.
   */
  async recordProjectWarehouseTransfer(params: {
    totalCost: number;
    fromInventoryAccountCode: string;
    fromInventoryAccountName: string;
    toInventoryAccountCode: string;
    toInventoryAccountName: string;
    fromProjectName: string;
    toProjectName: string;
    description: string;
    fromProjectId: string;
    date: string;
    reference: string;
  }) {
    assertJournalWriteAuth();
    const amount = Number(params.totalCost);
    if (amount <= 0) return undefined;

    const entries: JournalEntry[] = [
      {
        accountCode: params.toInventoryAccountCode,
        accountName: params.toInventoryAccountName,
        debit: amount,
        credit: 0,
      },
      {
        accountCode: params.fromInventoryAccountCode,
        accountName: params.fromInventoryAccountName,
        debit: 0,
        credit: amount,
      },
    ];

    return createTransaction({
      date: params.date,
      description: params.description,
      reference: params.reference,
      projectId: params.fromProjectId,
      entries,
    });
  },

  /** Return to project warehouse: Dr inventory / Cr contract expense. */
  async recordReturnToWarehouse(params: {
    totalCost: number;
    expenseAccountCode?: string;
    expenseAccountName?: string;
    inventoryAccountCode: string;
    inventoryAccountName: string;
    description: string;
    projectId: string;
    contractId: string;
    date: string;
    reference?: string;
  }) {
    assertJournalWriteAuth();
    const expenseCode = String(params.expenseAccountCode || '').trim() || AccountCodes.EXPENSE_MATERIALS;
    const entries: JournalEntry[] = [
      {
        accountCode: params.inventoryAccountCode,
        accountName: params.inventoryAccountName,
        debit: params.totalCost,
        credit: 0,
      },
      {
        accountCode: expenseCode,
        accountName: params.expenseAccountName || 'مواد البناء',
        debit: 0,
        credit: params.totalCost,
      },
    ];

    return createTransaction({
      date: params.date,
      description: params.description,
      reference: params.reference,
      projectId: params.projectId,
      costCenterId: params.contractId,
      entries,
    });
  },

  /**
   * Records a subcontractor IPC and generates a journal entry.
   * Subcontractor expense is debited once for works + VAT; no separate VAT-input line.
   */
  async recordSubcontractorIPC(params: {
    worksValue: number;
    vatAmount: number;
    netPayable: number;
    execGuarantee: number;
    whtAmount: number;
    labourInsurance: number;
    manpowerLevy: number;
    advancePaymentRecovery: number;
    supplierName: string;
    supplierAccountCode?: string;
    description: string;
    projectId?: string;
    contractId?: string;
    costCenterId?: string;
    date: string;
    transactionId?: string;
  }) {
    assertJournalWriteAuth();
    const entries = buildSubcontractorIpcEntries(params);

    const costCenterId = params.costCenterId ?? params.contractId;
    const transactionData = {
      date: params.date,
      description: params.description,
      ...(params.projectId ? { projectId: params.projectId } : {}),
      ...(costCenterId ? { costCenterId } : {}),
      entries
    };

    if (params.transactionId) {
      const txId = typeof params.transactionId === 'string' ? params.transactionId : (params.transactionId as any).id;
      const docRef = doc(db, 'transactions', txId);
      await updateDoc(docRef, sanitizeTransactionFirestoreData(transactionData as { entries: JournalEntry[] } & Record<string, unknown>));
      return txId;
    }

    return createTransaction(transactionData);
  },

  /**
   * Soft delete a document
   */
  async softDelete(collectionName: string, id: string) {
    if (isLocalBackend && collectionName === 'purchase_transactions') {
      await purchaseTransactionsApi.remove(id);
      return;
    }
    if (isLocalBackend && collectionName === 'billing') {
      await billingApi.remove(id);
      return;
    }
    const docRef = doc(db, collectionName, id);
    return await updateDoc(docRef, { isDeleted: true });
  },

  /**
   * Deletes a transaction (journal entry)
   */
  async deleteTransaction(id: any) {
    const transactionId = typeof id === 'string' ? id : id?.id;
    if (!transactionId) return;
    if (isLocalBackend) {
      await glApi.deleteTransaction(transactionId);
      return;
    }
    const docRef = doc(db, 'transactions', transactionId);
    return await updateDoc(docRef, { isDeleted: true });
  },

  /**
   * Updates an account in the chart of accounts.
   * Local/Railway: `chartOfAccountsApi.update` (CRUD PUT). Never `.put` — that method does not exist.
   */
  async updateAccount(id: string, updates: Partial<Omit<Account, 'id'>>) {
    if (isLocalBackend) {
      await chartOfAccountsApi.update(id, updates as Record<string, unknown>);
      invalidateCoaCache();
      return;
    }
    const docRef = doc(db, 'chart_of_accounts', id);
    return await updateDoc(docRef, updates);
  },

  findConsumptionExpenseFromJournal,
};
