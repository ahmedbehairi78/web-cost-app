import {
  collection,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { db, auth } from '../firebase';

export enum AccountCodes {
  BANK = '1101',
  RECEIVABLES = '1102',
  RETENTION_GUARANTEE = '1103',
  WHT_TAX = '1104',
  SOCIAL_INSURANCE = '1105',
  MANPOWER_LEVY = '1106',
  ADVANCE_PAYMENT = '1107',
  SUPPLIERS = '21',
  VAT_TAX = '2201',
  REVENUE = '41',
  EXPENSE_MATERIALS = '51',
  EXPENSE_LABOUR = '52',
  EXPENSE_ADMIN = '53',
}

export interface ChartAccountDefinition {
  accountCode: string;
  accountName: string;
  parentCode: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  isGroup: boolean;
}

export const DEFAULT_CHART_OF_ACCOUNTS: ChartAccountDefinition[] = [
  { accountCode: '1', accountName: 'الأصول', parentCode: '', type: 'asset', isGroup: true },
  { accountCode: '11', accountName: 'الأصول المتداولة', parentCode: '1', type: 'asset', isGroup: true },
  { accountCode: AccountCodes.BANK, accountName: 'البنك', parentCode: '11', type: 'asset', isGroup: false },
  { accountCode: AccountCodes.RECEIVABLES, accountName: 'عملاء عقود المقاولات', parentCode: '11', type: 'asset', isGroup: false },
  { accountCode: AccountCodes.RETENTION_GUARANTEE, accountName: 'محتجز ضمان الأعمال', parentCode: '11', type: 'asset', isGroup: false },
  { accountCode: AccountCodes.WHT_TAX, accountName: 'مصلحة الضرائب - خصم وإضافة', parentCode: '11', type: 'asset', isGroup: false },
  { accountCode: AccountCodes.SOCIAL_INSURANCE, accountName: 'التأمينات الاجتماعية - عمالة غير منتظمة', parentCode: '11', type: 'asset', isGroup: false },
  { accountCode: AccountCodes.MANPOWER_LEVY, accountName: 'القوى العاملة', parentCode: '11', type: 'asset', isGroup: false },
  { accountCode: AccountCodes.ADVANCE_PAYMENT, accountName: 'العملاء - دفعة مقدمة', parentCode: '11', type: 'asset', isGroup: false },
  { accountCode: '2', accountName: 'الخصوم', parentCode: '', type: 'liability', isGroup: true },
  { accountCode: '21', accountName: 'الموردين ومقاولي الباطن', parentCode: '2', type: 'liability', isGroup: false },
  { accountCode: '22', accountName: 'الضرائب والالتزامات الحكومية', parentCode: '2', type: 'liability', isGroup: true },
  { accountCode: AccountCodes.VAT_TAX, accountName: 'مصلحة الضرائب - ضريبة القيمة المضافة', parentCode: '22', type: 'liability', isGroup: false },
  { accountCode: '3', accountName: 'حقوق الملكية', parentCode: '', type: 'equity', isGroup: true },
  { accountCode: '4', accountName: 'الإيرادات', parentCode: '', type: 'revenue', isGroup: true },
  { accountCode: AccountCodes.REVENUE, accountName: 'إيرادات عقود المقاولات', parentCode: '4', type: 'revenue', isGroup: false },
  { accountCode: '5', accountName: 'المصروفات', parentCode: '', type: 'expense', isGroup: true },
  { accountCode: AccountCodes.EXPENSE_MATERIALS, accountName: 'تكاليف مباشرة - مواد', parentCode: '5', type: 'expense', isGroup: false },
  { accountCode: AccountCodes.EXPENSE_LABOUR, accountName: 'تكاليف مباشرة - عمالة', parentCode: '5', type: 'expense', isGroup: false },
  { accountCode: AccountCodes.EXPENSE_ADMIN, accountName: 'مصروفات إدارية', parentCode: '5', type: 'expense', isGroup: false },
];

export interface JournalEntry {
  accountCode: string;
  accountName?: string;
  debit: number;
  credit: number;
  note?: string;
}

export interface Transaction {
  id?: string;
  date: string;
  description: string;
  reference?: string;
  projectId?: string;
  costCenterId?: string;
  sourceType?: string;
  sourceId?: string;
  sourceKey?: string;
  sourceNumber?: string;
  entries: JournalEntry[];
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy?: string;
  isDeleted?: boolean;
}

let defaultAccountsEnsured = false;
let ensureDefaultAccountsPromise: Promise<void> | null = null;

function roundAmount(value: number) {
  return Number((value || 0).toFixed(6));
}

function hasAmount(value: number) {
  return Math.abs(roundAmount(value)) > 0.000001;
}

function formatPercent(value: number) {
  return `${Number.isInteger(value) ? value.toFixed(0) : String(value)}%`;
}

function cleanJournalEntries(entries: JournalEntry[]) {
  return entries
    .map((entry) => ({
      ...entry,
      debit: roundAmount(entry.debit),
      credit: roundAmount(entry.credit),
    }))
    .filter((entry) => hasAmount(entry.debit) || hasAmount(entry.credit));
}

export const accountingService = {
  async ensureDefaultChartAccounts() {
    if (defaultAccountsEnsured) return;

    if (ensureDefaultAccountsPromise) {
      await ensureDefaultAccountsPromise;
      return;
    }

    ensureDefaultAccountsPromise = (async () => {
      const snapshot = await getDocs(collection(db, 'chart_of_accounts'));
      const existingCodes = new Set(
        snapshot.docs.map((accountDoc) => String(accountDoc.data().accountCode ?? ''))
      );

      for (const account of DEFAULT_CHART_OF_ACCOUNTS) {
        if (!existingCodes.has(account.accountCode)) {
          await addDoc(collection(db, 'chart_of_accounts'), account);
          existingCodes.add(account.accountCode);
        }
      }

      defaultAccountsEnsured = true;
    })();

    try {
      await ensureDefaultAccountsPromise;
    } finally {
      ensureDefaultAccountsPromise = null;
    }
  },

  async getTransactionBySourceKey(sourceKey: string) {
    const snapshot = await getDocs(
      query(collection(db, 'transactions'), where('sourceKey', '==', sourceKey))
    );

    return snapshot.docs.find((txDoc) => txDoc.data().isDeleted !== true) || null;
  },

  async softDeleteTransactionsBySourceKeys(sourceKeys: string[]) {
    for (const sourceKey of sourceKeys) {
      const snapshot = await getDocs(
        query(collection(db, 'transactions'), where('sourceKey', '==', sourceKey))
      );

      for (const txDoc of snapshot.docs) {
        if (txDoc.data().isDeleted !== true) {
          await updateDoc(doc(db, 'transactions', txDoc.id), {
            isDeleted: true,
            updatedAt: serverTimestamp(),
          });
        }
      }
    }
  },

  async createTransaction(transaction: Omit<Transaction, 'createdAt' | 'createdBy' | 'isDeleted'>) {
    await this.ensureDefaultChartAccounts();

    const entries = cleanJournalEntries(transaction.entries);
    const totalDebit = entries.reduce((sum, entry) => sum + entry.debit, 0);
    const totalCredit = entries.reduce((sum, entry) => sum + entry.credit, 0);

    if (Math.abs(totalDebit - totalCredit) > 0.1) {
      throw new Error(
        `Transaction is not balanced: Total Debit (${totalDebit.toFixed(2)}) must equal Total Credit (${totalCredit.toFixed(2)})`
      );
    }

    const reference = transaction.reference || `JV-${Date.now().toString().slice(-6)}`;

    return addDoc(collection(db, 'transactions'), {
      ...transaction,
      entries,
      reference,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid,
      isDeleted: false,
    });
  },

  async recordExpense(params: {
    amount: number;
    description: string;
    projectId: string;
    costCenterId?: string;
    category: 'materials' | 'labour' | 'admin';
    date: string;
  }) {
    const expenseAccount =
      params.category === 'materials'
        ? AccountCodes.EXPENSE_MATERIALS
        : params.category === 'labour'
          ? AccountCodes.EXPENSE_LABOUR
          : AccountCodes.EXPENSE_ADMIN;

    const entries: JournalEntry[] = [
      { accountCode: expenseAccount, debit: params.amount, credit: 0 },
      { accountCode: AccountCodes.BANK, debit: 0, credit: params.amount },
    ];

    return this.createTransaction({
      date: params.date,
      description: params.description,
      projectId: params.projectId,
      costCenterId: params.costCenterId,
      entries,
    });
  },

  async recordRevenue(params: {
    amount: number;
    description: string;
    projectId: string;
    costCenterId?: string;
    date: string;
  }) {
    const entries: JournalEntry[] = [
      { accountCode: AccountCodes.RECEIVABLES, debit: params.amount, credit: 0 },
      { accountCode: AccountCodes.REVENUE, debit: 0, credit: params.amount },
    ];

    return this.createTransaction({
      date: params.date,
      description: params.description,
      projectId: params.projectId,
      costCenterId: params.costCenterId,
      entries,
    });
  },

  async recordIPC(params: {
    worksValue: number;
    vatAmount: number;
    netPayable: number;
    execGuarantee: number;
    whtAmount: number;
    labourInsurance: number;
    manpowerLevy: number;
    advancePaymentRecovery: number;
    description: string;
    projectId: string;
    contractId: string;
    billingId: string;
    billingNumber: string;
    date: string;
    vatPct: number;
    execGuaranteePct: number;
    whtPct: number;
    labourInsurancePct: number;
    manpowerLevyPct: number;
    createIfMissing?: boolean;
  }) {
    const entries: JournalEntry[] = [];
    const sourceKey = `billing:${params.billingId}`;
    const createIfMissing = params.createIfMissing ?? true;

    const addEntry = (entry: JournalEntry) => {
      if (hasAmount(entry.debit) || hasAmount(entry.credit)) {
        entries.push({
          ...entry,
          debit: roundAmount(entry.debit),
          credit: roundAmount(entry.credit),
        });
      }
    };

    addEntry({
      accountCode: AccountCodes.RECEIVABLES,
      accountName: 'عملاء عقود المقاولات',
      note: 'بالصافي المستحق قبضه',
      debit: params.netPayable,
      credit: 0,
    });
    addEntry({
      accountCode: AccountCodes.RETENTION_GUARANTEE,
      accountName: 'محتجز ضمان الأعمال',
      note: `قيمة الـ ${formatPercent(params.execGuaranteePct)} المحجوزة`,
      debit: params.execGuarantee,
      credit: 0,
    });
    addEntry({
      accountCode: AccountCodes.WHT_TAX,
      accountName: 'مصلحة الضرائب - خصم وإضافة',
      note: `قيمة الـ ${formatPercent(params.whtPct)} التي تم خصمها`,
      debit: params.whtAmount,
      credit: 0,
    });
    addEntry({
      accountCode: AccountCodes.SOCIAL_INSURANCE,
      accountName: 'التأمينات الاجتماعية - عمالة غير منتظمة',
      note: `قيمة الـ ${formatPercent(params.labourInsurancePct)}`,
      debit: params.labourInsurance,
      credit: 0,
    });
    addEntry({
      accountCode: AccountCodes.MANPOWER_LEVY,
      accountName: 'القوى العاملة',
      note: `قيمة الـ ${formatPercent(params.manpowerLevyPct)}`,
      debit: params.manpowerLevy,
      credit: 0,
    });

    if (params.advancePaymentRecovery > 0) {
      addEntry({
        accountCode: AccountCodes.ADVANCE_PAYMENT,
        accountName: 'العملاء - دفعة مقدمة',
        note: 'استرداد دفعة مقدمة من العميل',
        debit: params.advancePaymentRecovery,
        credit: 0,
      });
    }

    addEntry({
      accountCode: AccountCodes.REVENUE,
      accountName: 'إيرادات عقود المقاولات',
      note: 'بإجمالي قيمة الأعمال المنفذة في المستخلص',
      debit: 0,
      credit: params.worksValue,
    });
    addEntry({
      accountCode: AccountCodes.VAT_TAX,
      accountName: 'مصلحة الضرائب - ضريبة القيمة المضافة',
      note: `قيمة الـ ${formatPercent(params.vatPct)} المستحقة على الإيراد`,
      debit: 0,
      credit: params.vatAmount,
    });

    const payload: Omit<Transaction, 'createdAt' | 'createdBy' | 'isDeleted'> = {
      date: params.date,
      description: params.description,
      reference: params.billingNumber,
      projectId: params.projectId,
      costCenterId: params.contractId,
      sourceType: 'billing_ipc',
      sourceId: params.billingId,
      sourceKey,
      sourceNumber: params.billingNumber,
      entries,
    };

    const existingTransaction = await this.getTransactionBySourceKey(sourceKey);
    if (existingTransaction) {
      await this.ensureDefaultChartAccounts();
      await updateDoc(doc(db, 'transactions', existingTransaction.id), {
        ...payload,
        entries: cleanJournalEntries(entries),
        updatedAt: serverTimestamp(),
        isDeleted: false,
      });
      return existingTransaction.ref;
    }

    if (!createIfMissing) {
      return null;
    }

    return this.createTransaction(payload);
  },

  async recordCollection(params: {
    amount: number;
    description: string;
    projectId: string;
    costCenterId?: string;
    date: string;
  }) {
    const entries: JournalEntry[] = [
      { accountCode: AccountCodes.BANK, debit: params.amount, credit: 0 },
      { accountCode: AccountCodes.RECEIVABLES, debit: 0, credit: params.amount },
    ];

    return this.createTransaction({
      date: params.date,
      description: params.description,
      projectId: params.projectId,
      costCenterId: params.costCenterId,
      entries,
    });
  },

  async recordPurchaseInvoice(params: {
    baseAmount: number;
    vatAmount: number;
    whtAmount: number;
    totalAmount: number;
    supplierName: string;
    expenseAccountCode: string;
    expenseAccountName: string;
    description: string;
    projectId: string;
    contractId: string;
    date: string;
  }) {
    const entries: JournalEntry[] = [
      { accountCode: params.expenseAccountCode, accountName: params.expenseAccountName, debit: params.baseAmount, credit: 0 },
      { accountCode: AccountCodes.VAT_TAX, accountName: 'مصلحة الضرائب - ضريبة القيمة المضافة', debit: params.vatAmount, credit: 0 },
      { accountCode: AccountCodes.SUPPLIERS, accountName: `موردين - ${params.supplierName}`, debit: 0, credit: params.totalAmount },
      { accountCode: AccountCodes.WHT_TAX, accountName: 'مصلحة الضرائب - خصم وإضافة', debit: 0, credit: params.whtAmount },
    ];

    return this.createTransaction({
      date: params.date,
      description: params.description,
      projectId: params.projectId,
      costCenterId: params.contractId,
      entries,
    });
  },

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
    description: string;
    projectId: string;
    contractId: string;
    date: string;
  }) {
    const entries: JournalEntry[] = [
      { accountCode: AccountCodes.EXPENSE_LABOUR, accountName: `تكاليف مقاولين - ${params.supplierName}`, debit: params.worksValue, credit: 0 },
      { accountCode: AccountCodes.VAT_TAX, accountName: 'مصلحة الضرائب - ضريبة القيمة المضافة', debit: params.vatAmount, credit: 0 },
      { accountCode: AccountCodes.SUPPLIERS, accountName: `موردين ومقاولين - ${params.supplierName}`, debit: 0, credit: params.netPayable },
      { accountCode: AccountCodes.RETENTION_GUARANTEE, accountName: 'محتجز ضمان أعمال (خصم)', debit: 0, credit: params.execGuarantee },
      { accountCode: AccountCodes.WHT_TAX, accountName: 'مصلحة الضرائب - خصم وإضافة', debit: 0, credit: params.whtAmount },
      { accountCode: AccountCodes.SOCIAL_INSURANCE, accountName: 'التأمينات الاجتماعية - عمالة غير منتظمة', debit: 0, credit: params.labourInsurance },
      { accountCode: AccountCodes.MANPOWER_LEVY, accountName: 'القوى العاملة', debit: 0, credit: params.manpowerLevy },
    ];

    if (params.advancePaymentRecovery > 0) {
      entries.push({
        accountCode: AccountCodes.ADVANCE_PAYMENT,
        accountName: 'استرداد دفعة مقدمة',
        debit: 0,
        credit: params.advancePaymentRecovery,
      });
    }

    return this.createTransaction({
      date: params.date,
      description: params.description,
      projectId: params.projectId,
      costCenterId: params.contractId,
      entries,
    });
  },

  async softDelete(collectionName: string, id: string) {
    return updateDoc(doc(db, collectionName, id), { isDeleted: true });
  },
};
