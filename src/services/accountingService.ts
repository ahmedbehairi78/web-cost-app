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
  // ─── الأصول المتداولة (مستوى 5 — 8 أرقام) ────────────────
  BANK                        = '12101001', // البنك التجاري الدولي
  RECEIVABLES                 = '12201001', // العملاء - مستخلصات تحت التحصيل
  RETENTION_GUARANTEE         = '12202001', // محتجزات الضمان - عملاء
  ADVANCE_TO_SUPPLIERS        = '12301001', // مقدمات للموردين
  ADVANCE_TO_SUBCONTRACTORS   = '12302001', // مقدمات لمقاولي الباطن
  VAT_INPUT                   = '12401001', // ضريبة القيمة المضافة - مدخلات
  WHT_RECEIVABLE              = '12401002', // ضريبة الخصم والإضافة - مدين (محتجز من العميل)
  SOCIAL_INSURANCE_RECEIVABLE = '12402001', // التأمينات الاجتماعية - مدين
  MANPOWER_LEVY_RECEIVABLE    = '12403001', // القوى العاملة - مدين
  // ─── الخصوم المتداولة (مستوى 5 — 8 أرقام) ───────────────
  SUPPLIERS                   = '21101001', // الموردون (حساب المورد يُنشأ عند إضافته في المشتريات)
  SUBCONTRACTORS              = '21102001', // مقاولو الباطن (حساب المقاول يُنشأ عند إضافته)
  RETENTION_PAYABLE           = '21201001', // محتجزات ضمان الأعمال - مقاولون
  ADVANCE_PAYMENT             = '21301001', // دفعات مقدمة من العملاء
  VAT_OUTPUT                  = '21401001', // ضريبة القيمة المضافة - مخرجات
  WHT_PAYABLE                 = '21401002', // مصلحة الضرائب - خصم وإضافة (دائن)
  SOCIAL_INSURANCE_PAYABLE    = '21403001', // التأمينات الاجتماعية - دائن
  MANPOWER_LEVY_PAYABLE       = '21404001', // القوى العاملة - دائن
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
    if (!auth.currentUser) throw new Error('User not authenticated');

    const totalDebit = transaction.entries.reduce((sum, e) => sum + e.debit, 0);
    const totalCredit = transaction.entries.reduce((sum, e) => sum + e.credit, 0);

    const hasDebit = transaction.entries.some(e => e.debit > 0);
    const hasCredit = transaction.entries.some(e => e.credit > 0);

    if (!hasDebit || !hasCredit) {
      throw new Error('Transaction must have at least one debit entry and one credit entry');
    }

    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      throw new Error(`Transaction is not balanced: Total Debit (${totalDebit.toFixed(2)}) must equal Total Credit (${totalCredit.toFixed(2)})`);
    }

    const reference = transaction.reference ||
      `JV-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const docRef = await addDoc(collection(db, 'transactions'), {
      ...transaction,
      reference,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser.uid,
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
    if (!auth.currentUser) throw new Error('User not authenticated');
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
    if (!auth.currentUser) throw new Error('User not authenticated');
    const entries: JournalEntry[] = [
      // Debits — حقوق مستحقة للشركة من العميل
      { accountCode: AccountCodes.RECEIVABLES,             accountName: `ح/ عملاء عقود المقاولات - ${params.contractName}`, debit: params.netPayable,     credit: 0 },
      { accountCode: AccountCodes.RETENTION_GUARANTEE,     accountName: 'ح/ محتجز ضمان الأعمال',                           debit: params.execGuarantee,  credit: 0 },
      { accountCode: AccountCodes.WHT_RECEIVABLE,          accountName: 'ح/ مصلحة الضرائب – خصم وإضافة (مدين)',           debit: params.whtAmount,      credit: 0 },
      { accountCode: AccountCodes.SOCIAL_INSURANCE_RECEIVABLE, accountName: 'ح/ التأمينات الاجتماعية – عمالة غير منتظمة', debit: params.labourInsurance, credit: 0 },
      { accountCode: AccountCodes.MANPOWER_LEVY_RECEIVABLE, accountName: 'ح/ القوى العاملة (مدين)',                        debit: params.manpowerLevy,   credit: 0 },
    ];

    // Add Advance Payment Recovery if exists
    if (params.advancePaymentRecovery > 0) {
      entries.push({ accountCode: AccountCodes.ADVANCE_PAYMENT, accountName: 'ح/ العملاء - دفعة مقدمة (استرداد)', debit: params.advancePaymentRecovery, credit: 0 });
    }

    // Credits — الإيرادات والضريبة المستحقة للحكومة
    entries.push(
      { accountCode: AccountCodes.REVENUE,     accountName: `ح/ إيرادات عقود المقاولات - ${params.contractName}`, debit: 0, credit: params.worksValue },
      { accountCode: AccountCodes.VAT_OUTPUT,  accountName: 'ح/ ضريبة القيمة المضافة – مخرجات',                  debit: 0, credit: params.vatAmount }
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
    if (!auth.currentUser) throw new Error('User not authenticated');
    const entries: JournalEntry[] = [
      // Debits — تكلفة الشراء وضريبة المدخلات
      { accountCode: params.expenseAccountCode, accountName: params.expenseAccountName,                              debit: params.baseAmount,  credit: 0 },
      { accountCode: AccountCodes.VAT_INPUT,    accountName: 'ضريبة القيمة المضافة - مدخلات',                      debit: params.vatAmount,   credit: 0 },
      // Credits — المورد والضريبة المخصومة
      { accountCode: AccountCodes.SUPPLIERS,    accountName: `موردين - ${params.supplierName}`,                    debit: 0, credit: params.totalAmount },
      { accountCode: AccountCodes.WHT_PAYABLE,  accountName: 'مصلحة الضرائب - خصم وإضافة (دائن)',                 debit: 0, credit: params.whtAmount }
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
    if (!auth.currentUser) throw new Error('User not authenticated');
    const entries: JournalEntry[] = [
      // Debits — تكلفة مقاول الباطن وضريبة المدخلات
      { accountCode: AccountCodes.EXPENSE_SUBCONTRACTOR,      accountName: `تكاليف مقاولو الباطن - ${params.supplierName}`, debit: params.worksValue,      credit: 0 },
      { accountCode: AccountCodes.VAT_INPUT,                  accountName: 'ضريبة القيمة المضافة - مدخلات',                debit: params.vatAmount,       credit: 0 },
      // Credits — مستحقات مقاول الباطن والاستقطاعات
      { accountCode: AccountCodes.SUBCONTRACTORS,             accountName: `مقاولو الباطن - ${params.supplierName}`,       debit: 0, credit: params.netPayable },
      { accountCode: AccountCodes.RETENTION_PAYABLE,          accountName: 'محتجز ضمان الأعمال - مقاولون',                debit: 0, credit: params.execGuarantee },
      { accountCode: AccountCodes.WHT_PAYABLE,                accountName: 'مصلحة الضرائب - خصم وإضافة (دائن)',          debit: 0, credit: params.whtAmount },
      { accountCode: AccountCodes.SOCIAL_INSURANCE_PAYABLE,   accountName: 'التأمينات الاجتماعية (دائن)',                 debit: 0, credit: params.labourInsurance },
      { accountCode: AccountCodes.MANPOWER_LEVY_PAYABLE,      accountName: 'القوى العاملة (دائن)',                        debit: 0, credit: params.manpowerLevy },
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
