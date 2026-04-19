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
  Timestamp
} from 'firebase/firestore';
import { db, auth } from '../firebase';

export interface ChartAccountDefinition {
  accountCode: string;
  accountName: string;
  parentCode: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  isGroup: boolean;
}

export const DEFAULT_CHART_OF_ACCOUNTS: ChartAccountDefinition[] = [
  { accountCode: '1',    accountName: 'الأصول',                                          parentCode: '',     type: 'asset',     isGroup: true  },
  { accountCode: '11',   accountName: 'الأصول المتداولة',                                parentCode: '1',    type: 'asset',     isGroup: true  },
  { accountCode: '1101', accountName: 'البنك',                                           parentCode: '11',   type: 'asset',     isGroup: false },
  { accountCode: '1102', accountName: 'عملاء عقود المقاولات',                            parentCode: '11',   type: 'asset',     isGroup: false },
  { accountCode: '1103', accountName: 'محتجز ضمان الأعمال',                              parentCode: '11',   type: 'asset',     isGroup: false },
  { accountCode: '1104', accountName: 'مصلحة الضرائب - خصم وإضافة',                     parentCode: '11',   type: 'asset',     isGroup: false },
  { accountCode: '1105', accountName: 'التأمينات الاجتماعية - عمالة غير منتظمة',         parentCode: '11',   type: 'asset',     isGroup: false },
  { accountCode: '1106', accountName: 'القوى العاملة',                                   parentCode: '11',   type: 'asset',     isGroup: false },
  { accountCode: '1107', accountName: 'العملاء - دفعة مقدمة',                            parentCode: '11',   type: 'asset',     isGroup: false },
  { accountCode: '2',    accountName: 'الخصوم',                                          parentCode: '',     type: 'liability', isGroup: true  },
  { accountCode: '21',   accountName: 'الموردين ومقاولي الباطن',                         parentCode: '2',    type: 'liability', isGroup: false },
  { accountCode: '22',   accountName: 'الضرائب والالتزامات الحكومية',                    parentCode: '2',    type: 'liability', isGroup: true  },
  { accountCode: '2201', accountName: 'مصلحة الضرائب - ضريبة القيمة المضافة',           parentCode: '22',   type: 'liability', isGroup: false },
  { accountCode: '3',    accountName: 'حقوق الملكية',                                   parentCode: '',     type: 'equity',    isGroup: true  },
  { accountCode: '4',    accountName: 'الإيرادات',                                      parentCode: '',     type: 'revenue',   isGroup: true  },
  { accountCode: '41',   accountName: 'إيرادات عقود المقاولات',                          parentCode: '4',    type: 'revenue',   isGroup: false },
  { accountCode: '5',    accountName: 'المصروفات',                                      parentCode: '',     type: 'expense',   isGroup: true  },
  { accountCode: '51',   accountName: 'تكاليف مباشرة - مواد',                            parentCode: '5',    type: 'expense',   isGroup: false },
  { accountCode: '52',   accountName: 'تكاليف مباشرة - عمالة',                           parentCode: '5',    type: 'expense',   isGroup: false },
  { accountCode: '53',   accountName: 'مصروفات إدارية',                                 parentCode: '5',    type: 'expense',   isGroup: false },
];

export enum AccountCodes {
  BANK = '1101',
  RECEIVABLES = '1102',
  RETENTION_GUARANTEE = '1103', // محتجز ضمان أعمال
  WHT_TAX = '1104', // مصلحة الضرائب - خصم وإضافة
  SOCIAL_INSURANCE = '1105', // محتجز التأمينات الاجتماعية
  MANPOWER_LEVY = '1106', // محتجز القوى العاملة
  ADVANCE_PAYMENT = '1107', // العملاء - دفعة مقدمة
  SUPPLIERS = '21',
  VAT_TAX = '2201', // مصلحة الضرائب - ضريبة القيمة المضافة
  REVENUE = '41',
  EXPENSE_MATERIALS = '51',
  EXPENSE_LABOUR = '52',
  EXPENSE_ADMIN = '53'
}

export interface JournalEntry {
  accountCode: string;
  accountName?: string;
  debit: number;
  credit: number;
}

export interface Account {
  id: string;
  accountCode: string;
  accountName: string;
  parentCode: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  isGroup: boolean;
  status?: 'active' | 'disabled';
}

export interface Transaction {
  id?: string;
  date: string;
  description: string;
  reference?: string;
  projectId?: string;
  costCenterId?: string;
  entries: JournalEntry[];
  createdAt?: any;
  createdBy?: string;
  isDeleted?: boolean;
}

export const accountingService = {
  /**
   * Creates a balanced journal entry
   */
  async createTransaction(transaction: Omit<Transaction, 'createdAt' | 'createdBy' | 'isDeleted'>) {
    const totalDebit = transaction.entries.reduce((sum, e) => sum + e.debit, 0);
    const totalCredit = transaction.entries.reduce((sum, e) => sum + e.credit, 0);

    // Allow for small rounding differences
    if (Math.abs(totalDebit - totalCredit) > 0.1) {
      throw new Error(`Transaction is not balanced: Total Debit (${totalDebit.toFixed(2)}) must equal Total Credit (${totalCredit.toFixed(2)})`);
    }

    // Generate a reference if not provided
    const reference = transaction.reference || `JV-${Date.now().toString().slice(-6)}`;

    const docRef = await addDoc(collection(db, 'transactions'), {
      ...transaction,
      reference,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid,
      isDeleted: false
    });
    return docRef.id;
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
    const expenseAccount = 
      params.category === 'materials' ? AccountCodes.EXPENSE_MATERIALS :
      params.category === 'labour' ? AccountCodes.EXPENSE_LABOUR : AccountCodes.EXPENSE_ADMIN;

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
      await updateDoc(docRef, transactionData);
      return txId;
    }

    return this.createTransaction(transactionData);
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

    return this.createTransaction({
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
    description: string;
    projectId: string;
    contractId: string;
    date: string;
    contractName: string;
    transactionId?: string;
  }) {
    const entries: JournalEntry[] = [
      // Debits
      { accountCode: AccountCodes.RECEIVABLES, accountName: `ح/ عملاء عقود المقاولات - ${params.contractName}`, debit: params.netPayable, credit: 0 },
      { accountCode: AccountCodes.RETENTION_GUARANTEE, accountName: 'ح/ محتجز ضمان الأعمال', debit: params.execGuarantee, credit: 0 },
      { accountCode: AccountCodes.WHT_TAX, accountName: 'ح/ مصلحة الضرائب – خصم وإضافة', debit: params.whtAmount, credit: 0 },
      { accountCode: AccountCodes.SOCIAL_INSURANCE, accountName: 'ح/ التامينات الاجتماعية – عمالة غير منتظمة', debit: params.labourInsurance, credit: 0 },
      { accountCode: AccountCodes.MANPOWER_LEVY, accountName: 'ح/ القوى العاملة', debit: params.manpowerLevy, credit: 0 },
    ];

    // Add Advance Payment Recovery if exists
    if (params.advancePaymentRecovery > 0) {
      entries.push({ accountCode: AccountCodes.ADVANCE_PAYMENT, accountName: 'ح/ العملاء - دفعة مقدمة (استرداد)', debit: params.advancePaymentRecovery, credit: 0 });
    }

    // Credits
    entries.push(
      { accountCode: AccountCodes.REVENUE, accountName: `ح/ إيرادات عقود المقاولات - ${params.contractName}`, debit: 0, credit: params.worksValue },
      { accountCode: AccountCodes.VAT_TAX, accountName: 'ح/ مصلحة الضرائب – ضريبة القيمة المضافة', debit: 0, credit: params.vatAmount }
    );

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
      await updateDoc(docRef, transactionData);
      return txId;
    }

    return this.createTransaction(transactionData);
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

    return this.createTransaction({
      date: params.date,
      description: params.description,
      projectId: params.projectId,
      costCenterId: params.costCenterId,
      entries
    });
  },

  /**
   * Records a purchase invoice and generates a journal entry
   */
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
    transactionId?: string;
  }) {
    const entries: JournalEntry[] = [
      // Debits
      { accountCode: params.expenseAccountCode, accountName: params.expenseAccountName, debit: params.baseAmount, credit: 0 },
      { accountCode: AccountCodes.VAT_TAX, accountName: 'مصلحة الضرائب - ضريبة القيمة المضافة', debit: params.vatAmount, credit: 0 },
      
      // Credits
      { accountCode: AccountCodes.SUPPLIERS, accountName: `موردين - ${params.supplierName}`, debit: 0, credit: params.totalAmount },
      { accountCode: AccountCodes.WHT_TAX, accountName: 'مصلحة الضرائب - خصم وإضافة', debit: 0, credit: params.whtAmount }
    ];

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
      await updateDoc(docRef, transactionData);
      return txId;
    }

    return this.createTransaction(transactionData);
  },

  /**
   * Records a subcontractor IPC and generates a journal entry
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
    description: string;
    projectId: string;
    contractId: string;
    date: string;
    transactionId?: string;
  }) {
    const entries: JournalEntry[] = [
      // Debits
      { accountCode: AccountCodes.EXPENSE_LABOUR, accountName: `تكاليف مقاولين - ${params.supplierName}`, debit: params.worksValue, credit: 0 },
      { accountCode: AccountCodes.VAT_TAX, accountName: 'مصلحة الضرائب - ضريبة القيمة المضافة', debit: params.vatAmount, credit: 0 },
      
      // Credits
      { accountCode: AccountCodes.SUPPLIERS, accountName: `موردين ومقاولين - ${params.supplierName}`, debit: 0, credit: params.netPayable },
      { accountCode: AccountCodes.RETENTION_GUARANTEE, accountName: 'محتجز ضمان أعمال (خصم)', debit: 0, credit: params.execGuarantee },
      { accountCode: AccountCodes.WHT_TAX, accountName: 'مصلحة الضرائب - خصم وإضافة', debit: 0, credit: params.whtAmount },
      { accountCode: AccountCodes.SOCIAL_INSURANCE, accountName: 'محتجز التأمينات الاجتماعية', debit: 0, credit: params.labourInsurance },
      { accountCode: AccountCodes.MANPOWER_LEVY, accountName: 'محتجز القوى العاملة', debit: 0, credit: params.manpowerLevy },
    ];

    if (params.advancePaymentRecovery > 0) {
      entries.push({ accountCode: AccountCodes.ADVANCE_PAYMENT, accountName: 'استرداد دفعة مقدمة', debit: 0, credit: params.advancePaymentRecovery });
    }

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
      await updateDoc(docRef, transactionData);
      return txId;
    }

    return this.createTransaction(transactionData);
  },

  /**
   * Soft delete a document
   */
  async softDelete(collectionName: string, id: string) {
    const docRef = doc(db, collectionName, id);
    return await updateDoc(docRef, { isDeleted: true });
  },

  /**
   * Deletes a transaction (journal entry)
   */
  async deleteTransaction(id: any) {
    const transactionId = typeof id === 'string' ? id : id?.id;
    if (!transactionId) return;
    const docRef = doc(db, 'transactions', transactionId);
    return await updateDoc(docRef, { isDeleted: true });
  },

  /**
   * Seeds missing default chart of accounts entries. Safe to call multiple times.
   * Returns the number of accounts that were newly created.
   */
  async seedChartOfAccounts(): Promise<number> {
    const snapshot = await getDocs(collection(db, 'chart_of_accounts'));
    const existingCodes = new Set(
      snapshot.docs.map(d => String(d.data().accountCode ?? ''))
    );

    let created = 0;
    for (const account of DEFAULT_CHART_OF_ACCOUNTS) {
      if (!existingCodes.has(account.accountCode)) {
        await addDoc(collection(db, 'chart_of_accounts'), { ...account, status: 'active' });
        created++;
      }
    }
    return created;
  },

  /**
   * Updates an account in the chart of accounts
   */
  async updateAccount(id: string, updates: Partial<Omit<Account, 'id'>>) {
    const docRef = doc(db, 'chart_of_accounts', id);
    return await updateDoc(docRef, updates);
  }
};
