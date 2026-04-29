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

export enum AccountCodes {
  // ─── الأصول ───────────────────────────────────
  BANK                  = '1111', // البنك
  RECEIVABLES           = '1121', // العملاء - مستخلصات تحت التحصيل
  RETENTION_GUARANTEE   = '1122', // محتجزات الضمان - عملاء
  ADVANCE_TO_SUPPLIERS  = '1131', // مقدمات للموردين
  WHT_TAX               = '1142', // مصلحة الضرائب - خصم وإضافة
  SOCIAL_INSURANCE      = '1143', // التأمينات الاجتماعية
  MANPOWER_LEVY         = '1144', // القوى العاملة
  // ─── الخصوم ───────────────────────────────────
  SUPPLIERS             = '2111', // الموردون
  SUBCONTRACTORS        = '2112', // مقاولو الباطن
  RETENTION_PAYABLE     = '2121', // محتجزات الضمان - مقاولون
  ADVANCE_PAYMENT       = '2131', // دفعات مقدمة من العملاء
  VAT_TAX               = '2141', // ضريبة القيمة المضافة - مخرجات
  // ─── الإيرادات ────────────────────────────────
  REVENUE               = '4111', // إيرادات عقود المقاولات
  // ─── تكاليف العقود (51xx) ─────────────────────
  EXPENSE_MATERIALS     = '5111', // مواد البناء
  EXPENSE_LABOUR        = '5112', // عمالة مباشرة
  EXPENSE_SUBCONTRACTOR = '5113', // مقاولو الباطن - تكاليف
  EXPENSE_EQUIPMENT     = '5114', // معدات وآلات
  // ─── مصروفات تشغيلية (52xx) ───────────────────
  EXPENSE_ADMIN         = '5211', // رواتب وأجور إدارية
  // ─── مصروفات تمويلية (53xx) ───────────────────
  BANK_CHARGES          = '5312', // رسوم بنكية
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
  statementType?: 'balance_sheet' | 'income_statement';
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
      { accountCode: AccountCodes.EXPENSE_SUBCONTRACTOR, accountName: `تكاليف مقاولو الباطن - ${params.supplierName}`, debit: params.worksValue, credit: 0 },
      { accountCode: AccountCodes.VAT_TAX, accountName: 'مصلحة الضرائب - ضريبة القيمة المضافة', debit: params.vatAmount, credit: 0 },

      // Credits
      { accountCode: AccountCodes.SUBCONTRACTORS, accountName: `مقاولو الباطن - ${params.supplierName}`, debit: 0, credit: params.netPayable },
      { accountCode: AccountCodes.RETENTION_PAYABLE, accountName: 'محتجز ضمان الأعمال - مقاولون', debit: 0, credit: params.execGuarantee },
      { accountCode: AccountCodes.WHT_TAX, accountName: 'مصلحة الضرائب - خصم وإضافة', debit: 0, credit: params.whtAmount },
      { accountCode: AccountCodes.SOCIAL_INSURANCE, accountName: 'التأمينات الاجتماعية', debit: 0, credit: params.labourInsurance },
      { accountCode: AccountCodes.MANPOWER_LEVY, accountName: 'القوى العاملة', debit: 0, credit: params.manpowerLevy },
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
   * Updates an account in the chart of accounts
   */
  async updateAccount(id: string, updates: Partial<Omit<Account, 'id'>>) {
    const docRef = doc(db, 'chart_of_accounts', id);
    return await updateDoc(docRef, updates);
  }
};
