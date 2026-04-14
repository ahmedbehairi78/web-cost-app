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

    return await addDoc(collection(db, 'transactions'), {
      ...transaction,
      reference,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid,
      isDeleted: false
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
  }) {
    const expenseAccount = 
      params.category === 'materials' ? AccountCodes.EXPENSE_MATERIALS :
      params.category === 'labour' ? AccountCodes.EXPENSE_LABOUR : AccountCodes.EXPENSE_ADMIN;

    const entries: JournalEntry[] = [
      { accountCode: expenseAccount, debit: params.amount, credit: 0 },
      { accountCode: AccountCodes.BANK, debit: 0, credit: params.amount }
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
  }) {
    const entries: JournalEntry[] = [
      // Debits
      { accountCode: AccountCodes.RECEIVABLES, accountName: `عملاء عقود - ${params.contractName}`, debit: params.netPayable, credit: 0 },
      { accountCode: AccountCodes.RETENTION_GUARANTEE, accountName: 'محتجز ضمان أعمال', debit: params.execGuarantee, credit: 0 },
      { accountCode: AccountCodes.WHT_TAX, accountName: 'مصلحة الضرائب - خصم وإضافة', debit: params.whtAmount, credit: 0 },
      { accountCode: AccountCodes.SOCIAL_INSURANCE, accountName: 'محتجز التأمينات الاجتماعية', debit: params.labourInsurance, credit: 0 },
      { accountCode: AccountCodes.MANPOWER_LEVY, accountName: 'محتجز القوى العاملة', debit: params.manpowerLevy, credit: 0 },
    ];

    // Add Advance Payment Recovery if exists
    if (params.advancePaymentRecovery > 0) {
      entries.push({ accountCode: AccountCodes.ADVANCE_PAYMENT, accountName: 'العملاء - دفعة مقدمة', debit: params.advancePaymentRecovery, credit: 0 });
    }

    // Credits
    entries.push(
      { accountCode: AccountCodes.REVENUE, accountName: `إيرادات عقود - ${params.contractName}`, debit: 0, credit: params.worksValue },
      { accountCode: AccountCodes.VAT_TAX, accountName: 'مصلحة الضرائب - ضريبة القيمة المضافة', debit: 0, credit: params.vatAmount }
    );

    return this.createTransaction({
      date: params.date,
      description: params.description,
      projectId: params.projectId,
      costCenterId: params.contractId,
      entries
    });
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
  }) {
    const entries: JournalEntry[] = [
      // Debits
      { accountCode: params.expenseAccountCode, accountName: params.expenseAccountName, debit: params.baseAmount, credit: 0 },
      { accountCode: AccountCodes.VAT_TAX, accountName: 'مصلحة الضرائب - ضريبة القيمة المضافة', debit: params.vatAmount, credit: 0 },
      
      // Credits
      { accountCode: AccountCodes.SUPPLIERS, accountName: `موردين - ${params.supplierName}`, debit: 0, credit: params.totalAmount },
      { accountCode: AccountCodes.WHT_TAX, accountName: 'مصلحة الضرائب - خصم وإضافة', debit: 0, credit: params.whtAmount }
    ];

    return this.createTransaction({
      date: params.date,
      description: params.description,
      projectId: params.projectId,
      costCenterId: params.contractId,
      entries
    });
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

    return this.createTransaction({
      date: params.date,
      description: params.description,
      projectId: params.projectId,
      costCenterId: params.contractId,
      entries
    });
  },

  /**
   * Soft delete a document
   */
  async softDelete(collectionName: string, id: string) {
    const docRef = doc(db, collectionName, id);
    return await updateDoc(docRef, { isDeleted: true });
  }
};
