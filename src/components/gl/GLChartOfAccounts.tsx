import React, { useState, useRef } from 'react';
import { Search, ChevronRight, ChevronDown, Edit2, Trash2, FileDown, FileUp, Loader2, Plus } from 'lucide-react';
import { collection, addDoc, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { cn, compositeListKey } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { accountingService, Account, invalidateCoaCache } from '../../services/accountingService';
import { AccountModal } from './AccountModal';
import { usePermissions } from '../../context/PermissionsContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { useOperationProgressRunner } from '../../context/OperationProgressContext';
import toast from 'react-hot-toast';
import { AdminSensitiveVerifyModal } from '../AdminSensitiveVerifyModal';

interface Props {
  accounts: Account[];
  loading: boolean;
  theme: string;
  language: string;
  dir: string;
  allowCreate?: boolean;
  allowEdit?: boolean;
  /** SQLite/local mode: parent reloads COA after toggle or edit */
  onAccountsChanged?: () => void;
}

export function GLChartOfAccounts({ accounts, loading, theme, language, dir, allowCreate = true, allowEdit = true, onAccountsChanged }: Props) {
  const { can } = usePermissions();
  const runWithProgress = useOperationProgressRunner();
  const isAdmin = can('ledger').edit;
  const confirmDlg = useConfirm();
  const [verifyOpen, setVerifyOpen] = useState(false);
  const resetSeedRef = useRef<(() => Promise<void>) | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(['1', '11', '12', '2', '21', '22', '3', '31', '4', '41', '42', '5', '51', '52', '53',
             '111', '119', '121', '122', '123', '124', '125', '126',
             '211', '212', '213', '214', '215', '221',
             '311', '312', '313', '314',
             '411', '421', '511', '512', '521', '522', '531'])
  );
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [newAccountParent, setNewAccountParent] = useState<Account | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleGroup = (code: string) => {
    const next = new Set(expandedGroups);
    if (next.has(code)) next.delete(code); else next.add(code);
    setExpandedGroups(next);
  };

  const isAccountDisabled = (acc: Account) => acc.status === 'disabled';

  const handleToggleStatus = async (acc: Account) => {
    if (!allowEdit) return;
    const nextStatus = isAccountDisabled(acc) ? 'active' : 'disabled';
    try {
      await accountingService.updateAccount(acc.id, { status: nextStatus });
      invalidateCoaCache();
      onAccountsChanged?.();
      toast.success(
        language === 'ar'
          ? (nextStatus === 'active' ? 'تم تفعيل الحساب' : 'تم تعطيل الحساب')
          : (nextStatus === 'active' ? 'Account activated' : 'Account disabled'),
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'chart_of_accounts');
    }
  };

  const seedAccounts = async () => {
    const BS = 'balance_sheet';
    const PL = 'income_statement';
    // 5-level hierarchy: L1(1d) > L2(2d) > L3(3d) > L4(5d) > L5(8d=leaf)
    const G = true; const L = false; // isGroup shorthand
    const defaults = [
      // ══ 1 — الأصول ══════════════════════════════════════════════
      { accountCode: '1',        accountName: 'الأصول',                                   accountNameEn: 'Assets',                           parentCode: '',      type: 'asset',     isGroup: G, statementType: BS },
      // L2
      { accountCode: '11',       accountName: 'الأصول الثابتة',                           accountNameEn: 'Fixed Assets',                     parentCode: '1',     type: 'asset',     isGroup: G, statementType: BS },
      { accountCode: '12',       accountName: 'الأصول المتداولة',                         accountNameEn: 'Current Assets',                   parentCode: '1',     type: 'asset',     isGroup: G, statementType: BS },
      // L3 — under 11
      { accountCode: '111',      accountName: 'وسائل النقل',                              accountNameEn: 'Transport & Vehicles',             parentCode: '11',    type: 'asset',     isGroup: G, statementType: BS },
      { accountCode: '119',      accountName: 'مجمع الإهلاك (دائن)',                      accountNameEn: 'Accumulated Depreciation',         parentCode: '11',    type: 'asset',     isGroup: G, statementType: BS },
      // L3 — under 12
      { accountCode: '121',      accountName: 'النقدية والبنوك',                          accountNameEn: 'Cash & Banks',                     parentCode: '12',    type: 'asset',     isGroup: G, statementType: BS },
      { accountCode: '122',      accountName: 'العملاء والذمم المدينة',                   accountNameEn: 'Accounts Receivable',              parentCode: '12',    type: 'asset',     isGroup: G, statementType: BS },
      { accountCode: '123',      accountName: 'المدفوعات المقدمة',                        accountNameEn: 'Prepayments',                      parentCode: '12',    type: 'asset',     isGroup: G, statementType: BS },
      { accountCode: '124',      accountName: 'حسابات ضريبية مدينة',                     accountNameEn: 'Tax Receivables',                  parentCode: '12',    type: 'asset',     isGroup: G, statementType: BS },
      { accountCode: '125',      accountName: 'ذمم مدينة أخرى',                          accountNameEn: 'Other Receivables',                parentCode: '12',    type: 'asset',     isGroup: G, statementType: BS },
      { accountCode: '126',      accountName: 'أصول أخرى',                               accountNameEn: 'Other Assets',                     parentCode: '12',    type: 'asset',     isGroup: G, statementType: BS },
      // L4 — under 111
      { accountCode: '11101',    accountName: 'سيارات نقل',                               accountNameEn: 'Trucks & Vehicles',                parentCode: '111',   type: 'asset',     isGroup: G, statementType: BS },
      // L4 — under 119
      { accountCode: '11901',    accountName: 'مجمع إهلاك سيارات النقل',                 accountNameEn: 'Acc. Depr. - Vehicles',            parentCode: '119',   type: 'asset',     isGroup: G, statementType: BS },
      // L4 — under 121
      { accountCode: '12101',    accountName: 'البنوك',                                   accountNameEn: 'Banks',                            parentCode: '121',   type: 'asset',     isGroup: G, statementType: BS },
      { accountCode: '12102',    accountName: 'الصناديق',                                 accountNameEn: 'Cash on Hand',                     parentCode: '121',   type: 'asset',     isGroup: G, statementType: BS },
      // L4 — under 122
      { accountCode: '12201',    accountName: 'العملاء - مستخلصات تحت التحصيل',          accountNameEn: 'Clients - IPCs Under Collection',  parentCode: '122',   type: 'asset',     isGroup: G, statementType: BS },
      { accountCode: '12202',    accountName: 'محتجزات الضمان - عملاء',                  accountNameEn: 'Retention Guarantee - Clients',    parentCode: '122',   type: 'asset',     isGroup: G, statementType: BS },
      { accountCode: '12203',    accountName: 'شيكات برسم التحصيل',                      accountNameEn: 'Cheques Under Collection',         parentCode: '122',   type: 'asset',     isGroup: G, statementType: BS },
      // L4 — under 123
      { accountCode: '12301',    accountName: 'مقدمات للموردين',                          accountNameEn: 'Advances to Suppliers',            parentCode: '123',   type: 'asset',     isGroup: G, statementType: BS },
      { accountCode: '12302',    accountName: 'مقدمات لمقاولي الباطن',                   accountNameEn: 'Advances to Subcontractors',       parentCode: '123',   type: 'asset',     isGroup: G, statementType: BS },
      // L4 — under 124
      { accountCode: '12401',    accountName: 'مصلحة الضرائب - خصم وإضافة',             accountNameEn: 'WHT & VAT Receivable',             parentCode: '124',   type: 'asset',     isGroup: G, statementType: BS },
      { accountCode: '12402',    accountName: 'التأمينات الاجتماعية - مدين',             accountNameEn: 'Social Insurance Receivable',      parentCode: '124',   type: 'asset',     isGroup: G, statementType: BS },
      { accountCode: '12403',    accountName: 'القوى العاملة - مدين',                    accountNameEn: 'Manpower Levy Receivable',         parentCode: '124',   type: 'asset',     isGroup: G, statementType: BS },
      // L4 — under 125
      { accountCode: '12501',    accountName: 'حسابات مدينة متنوعة',                     accountNameEn: 'Miscellaneous Receivables',        parentCode: '125',   type: 'asset',     isGroup: G, statementType: BS },
      // L4 — under 126
      { accountCode: '12601',    accountName: 'أعمال قيد التنفيذ (WIP)',                  accountNameEn: 'Work In Progress (WIP)',           parentCode: '126',   type: 'asset',     isGroup: G, statementType: BS },
      // L5 — leaves (asset)
      { accountCode: '11101001', accountName: 'سيارات نقل',                               accountNameEn: 'Trucks & Vehicles - Cost',         parentCode: '11101', type: 'asset',     isGroup: L, statementType: BS },
      { accountCode: '11901001', accountName: 'مجمع إهلاك سيارات النقل',                 accountNameEn: 'Acc. Depr. - Vehicles',            parentCode: '11901', type: 'asset',     isGroup: L, statementType: BS },
      { accountCode: '12101001', accountName: 'البنك التجاري الدولي',                    accountNameEn: 'Commercial International Bank',    parentCode: '12101', type: 'asset',     isGroup: L, statementType: BS },
      { accountCode: '12102001', accountName: 'صندوق الشركة',                            accountNameEn: 'Company Cash Fund',                parentCode: '12102', type: 'asset',     isGroup: L, statementType: BS },
      { accountCode: '12201001', accountName: 'العملاء - مستخلصات تحت التحصيل',          accountNameEn: 'Clients - IPCs Under Collection',  parentCode: '12201', type: 'asset',     isGroup: L, statementType: BS },
      { accountCode: '12202001', accountName: 'محتجزات الضمان - عملاء',                  accountNameEn: 'Retention Guarantee - Clients',    parentCode: '12202', type: 'asset',     isGroup: L, statementType: BS },
      { accountCode: '12203001', accountName: 'شيكات واردة برسم التحصيل',                accountNameEn: 'Received Cheques Clearing',        parentCode: '12203', type: 'asset',     isGroup: L, statementType: BS },
      { accountCode: '12301001', accountName: 'مقدمات للموردين',                          accountNameEn: 'Advances to Suppliers',            parentCode: '12301', type: 'asset',     isGroup: L, statementType: BS },
      { accountCode: '12302001', accountName: 'مقدمات لمقاولي الباطن',                   accountNameEn: 'Advances to Subcontractors',       parentCode: '12302', type: 'asset',     isGroup: L, statementType: BS },
      { accountCode: '12401001', accountName: 'ضريبة القيمة المضافة - مدخلات',           accountNameEn: 'VAT - Input',                      parentCode: '12401', type: 'asset',     isGroup: L, statementType: BS },
      { accountCode: '12401002', accountName: 'ضريبة الخصم والإضافة - مدين',            accountNameEn: 'WHT Tax Receivable',               parentCode: '12401', type: 'asset',     isGroup: L, statementType: BS },
      { accountCode: '12402001', accountName: 'التأمينات الاجتماعية - مدين',             accountNameEn: 'Social Insurance Receivable',      parentCode: '12402', type: 'asset',     isGroup: L, statementType: BS },
      { accountCode: '12403001', accountName: 'القوى العاملة - مدين',                    accountNameEn: 'Manpower Levy Receivable',         parentCode: '12403', type: 'asset',     isGroup: L, statementType: BS },
      { accountCode: '12501001', accountName: 'حسابات مدينة متنوعة',                     accountNameEn: 'Miscellaneous Receivables',        parentCode: '12501', type: 'asset',     isGroup: L, statementType: BS },
      { accountCode: '12601001', accountName: 'أعمال قيد التنفيذ',                       accountNameEn: 'Work In Progress',                 parentCode: '12601', type: 'asset',     isGroup: L, statementType: BS },
      // ══ 2 — الخصوم ══════════════════════════════════════════════
      { accountCode: '2',        accountName: 'الخصوم',                                   accountNameEn: 'Liabilities',                      parentCode: '',      type: 'liability', isGroup: G, statementType: BS },
      // L2
      { accountCode: '21',       accountName: 'الخصوم المتداولة',                         accountNameEn: 'Current Liabilities',              parentCode: '2',     type: 'liability', isGroup: G, statementType: BS },
      { accountCode: '22',       accountName: 'الخصوم غير المتداولة',                     accountNameEn: 'Non-Current Liabilities',          parentCode: '2',     type: 'liability', isGroup: G, statementType: BS },
      // L3 — under 21
      { accountCode: '211',      accountName: 'ذمم دائنة تجارية',                        accountNameEn: 'Trade Payables',                   parentCode: '21',    type: 'liability', isGroup: G, statementType: BS },
      { accountCode: '212',      accountName: 'محتجزات ضمان دائنة',                      accountNameEn: 'Retention Payable',                parentCode: '21',    type: 'liability', isGroup: G, statementType: BS },
      { accountCode: '213',      accountName: 'دفعات مقدمة من العملاء',                  accountNameEn: 'Advances from Clients',            parentCode: '21',    type: 'liability', isGroup: G, statementType: BS },
      { accountCode: '214',      accountName: 'التزامات ضريبية',                          accountNameEn: 'Tax Liabilities',                  parentCode: '21',    type: 'liability', isGroup: G, statementType: BS },
      { accountCode: '215',      accountName: 'مستحقات دائنة أخرى',                      accountNameEn: 'Other Payables',                   parentCode: '21',    type: 'liability', isGroup: G, statementType: BS },
      { accountCode: '216',      accountName: 'شيكات دفع',                                accountNameEn: 'Issued Cheques',                   parentCode: '21',    type: 'liability', isGroup: G, statementType: BS },
      // L3 — under 22
      { accountCode: '221',      accountName: 'قروض طويلة الأجل',                        accountNameEn: 'Long-term Loans',                  parentCode: '22',    type: 'liability', isGroup: G, statementType: BS },
      // L4 — under 211
      { accountCode: '21101',    accountName: 'الموردون',                                  accountNameEn: 'Suppliers',                        parentCode: '211',   type: 'liability', isGroup: G, statementType: BS },
      { accountCode: '21102',    accountName: 'مقاولو الباطن',                            accountNameEn: 'Subcontractors',                   parentCode: '211',   type: 'liability', isGroup: G, statementType: BS },
      // L4 — under 212
      { accountCode: '21201',    accountName: 'محتجزات ضمان الأعمال - مقاولون',          accountNameEn: 'Work Retention - Contractors',     parentCode: '212',   type: 'liability', isGroup: G, statementType: BS },
      // L4 — under 213
      { accountCode: '21301',    accountName: 'دفعات مقدمة من عملاء المقاولات',          accountNameEn: 'Client Advance Payments',          parentCode: '213',   type: 'liability', isGroup: G, statementType: BS },
      // L4 — under 214
      { accountCode: '21401',    accountName: 'ضريبة القيمة المضافة والخصم والإضافة',   accountNameEn: 'VAT Output & WHT Payable',         parentCode: '214',   type: 'liability', isGroup: G, statementType: BS },
      { accountCode: '21403',    accountName: 'التأمينات الاجتماعية - دائن',             accountNameEn: 'Social Insurance Payable',         parentCode: '214',   type: 'liability', isGroup: G, statementType: BS },
      { accountCode: '21404',    accountName: 'القوى العاملة - دائن',                    accountNameEn: 'Manpower Levy Payable',            parentCode: '214',   type: 'liability', isGroup: G, statementType: BS },
      // L4 — under 215
      { accountCode: '21501',    accountName: 'رسوم واشتراكات جهات حكومية',              accountNameEn: 'Gov. Fees & Subscriptions',        parentCode: '215',   type: 'liability', isGroup: L, statementType: BS },
      // L4 — under 216
      { accountCode: '21601',    accountName: 'شيكات تحت الصرف',                          accountNameEn: 'Cheques Outstanding',              parentCode: '216',   type: 'liability', isGroup: G, statementType: BS },
      // L4 — under 221
      { accountCode: '22101',    accountName: 'قروض بنكية طويلة الأجل',                  accountNameEn: 'Long-term Bank Loans',             parentCode: '221',   type: 'liability', isGroup: L, statementType: BS },
      // L5 — leaves (liability)
      { accountCode: '21101001', accountName: 'الموردون',                                  accountNameEn: 'Suppliers',                        parentCode: '21101', type: 'liability', isGroup: L, statementType: BS },
      { accountCode: '21102001', accountName: 'مقاولو الباطن',                            accountNameEn: 'Subcontractors',                   parentCode: '21102', type: 'liability', isGroup: L, statementType: BS },
      { accountCode: '21201001', accountName: 'محتجزات ضمان الأعمال',                    accountNameEn: 'Work Retention - Contractors',     parentCode: '21201', type: 'liability', isGroup: L, statementType: BS },
      { accountCode: '21201002', accountName: 'محتجزات التأمينات',                       accountNameEn: 'Insurance Retention',              parentCode: '21201', type: 'liability', isGroup: L, statementType: BS },
      { accountCode: '21301001', accountName: 'دفعات مقدمة من العملاء',                  accountNameEn: 'Client Advance Payments',          parentCode: '21301', type: 'liability', isGroup: L, statementType: BS },
      { accountCode: '21401001', accountName: 'ضريبة القيمة المضافة - مخرجات',           accountNameEn: 'VAT - Output',                     parentCode: '21401', type: 'liability', isGroup: L, statementType: BS },
      { accountCode: '21401002', accountName: 'مصلحة الضرائب - خصم وإضافة (دائن)',      accountNameEn: 'WHT Tax Payable',                  parentCode: '21401', type: 'liability', isGroup: L, statementType: BS },
      { accountCode: '21403001', accountName: 'التأمينات الاجتماعية - دائن',             accountNameEn: 'Social Insurance Payable',         parentCode: '21403', type: 'liability', isGroup: L, statementType: BS },
      { accountCode: '21404001', accountName: 'القوى العاملة - دائن',                    accountNameEn: 'Manpower Levy Payable',            parentCode: '21404', type: 'liability', isGroup: L, statementType: BS },
      { accountCode: '21501001', accountName: 'رسوم واشتراكات جهات حكومية',              accountNameEn: 'Gov. Fees & Subscriptions',        parentCode: '21501', type: 'liability', isGroup: L, statementType: BS },
      { accountCode: '21601001', accountName: 'شيكات تحت الصرف',                          accountNameEn: 'Issued Cheques Payable',           parentCode: '21601', type: 'liability', isGroup: L, statementType: BS },
      // ══ 3 — حقوق الملكية ════════════════════════════════════════
      { accountCode: '3',        accountName: 'حقوق الملكية',                             accountNameEn: 'Equity',                           parentCode: '',      type: 'equity',    isGroup: G, statementType: BS },
      { accountCode: '31',       accountName: 'رأس المال والاحتياطيات',                   accountNameEn: 'Capital & Reserves',               parentCode: '3',     type: 'equity',    isGroup: G, statementType: BS },
      { accountCode: '311',      accountName: 'رأس المال',                                accountNameEn: 'Capital',                          parentCode: '31',    type: 'equity',    isGroup: G, statementType: BS },
      { accountCode: '312',      accountName: 'الاحتياطيات',                              accountNameEn: 'Reserves',                         parentCode: '31',    type: 'equity',    isGroup: G, statementType: BS },
      { accountCode: '313',      accountName: 'الأرباح المحتجزة',                         accountNameEn: 'Retained Earnings',                parentCode: '31',    type: 'equity',    isGroup: G, statementType: BS },
      { accountCode: '314',      accountName: 'جاري الشركاء',                             accountNameEn: "Partners' Current Accounts",       parentCode: '31',    type: 'equity',    isGroup: G, statementType: BS },
      { accountCode: '31101',    accountName: 'رأس المال المدفوع',                        accountNameEn: 'Paid-in Capital',                  parentCode: '311',   type: 'equity',    isGroup: G, statementType: BS },
      { accountCode: '31201',    accountName: 'احتياطي قانوني',                            accountNameEn: 'Legal Reserve',                    parentCode: '312',   type: 'equity',    isGroup: L, statementType: BS },
      { accountCode: '31202',    accountName: 'احتياطيات أخرى',                           accountNameEn: 'Other Reserves',                   parentCode: '312',   type: 'equity',    isGroup: L, statementType: BS },
      { accountCode: '31301',    accountName: 'الأرباح المحتجزة',                         accountNameEn: 'Retained Earnings',                parentCode: '313',   type: 'equity',    isGroup: G, statementType: BS },
      { accountCode: '31401',    accountName: 'جاري الشركاء - مسحوبات',                  accountNameEn: "Partners' Current Accounts",       parentCode: '314',   type: 'equity',    isGroup: G, statementType: BS },
      { accountCode: '31101001', accountName: 'رأس المال المدفوع',                        accountNameEn: 'Paid-in Capital',                  parentCode: '31101', type: 'equity',    isGroup: L, statementType: BS },
      { accountCode: '31301001', accountName: 'الأرباح المحتجزة',                         accountNameEn: 'Retained Earnings',                parentCode: '31301', type: 'equity',    isGroup: L, statementType: BS },
      { accountCode: '31401001', accountName: 'جاري الشركاء',                             accountNameEn: "Partner Current Account",          parentCode: '31401', type: 'equity',    isGroup: L, statementType: BS },
      // ══ 4 — الإيرادات ════════════════════════════════════════════
      { accountCode: '4',        accountName: 'الإيرادات',                                accountNameEn: 'Revenue',                          parentCode: '',      type: 'revenue',   isGroup: G, statementType: PL },
      { accountCode: '41',       accountName: 'إيرادات تشغيلية',                          accountNameEn: 'Operating Revenue',                parentCode: '4',     type: 'revenue',   isGroup: G, statementType: PL },
      { accountCode: '42',       accountName: 'إيرادات أخرى',                             accountNameEn: 'Other Revenue',                    parentCode: '4',     type: 'revenue',   isGroup: G, statementType: PL },
      { accountCode: '411',      accountName: 'إيرادات عقود المقاولات',                   accountNameEn: 'Contract Revenue',                 parentCode: '41',    type: 'revenue',   isGroup: G, statementType: PL },
      { accountCode: '421',      accountName: 'إيرادات غير تشغيلية',                      accountNameEn: 'Non-Operating Revenue',            parentCode: '42',    type: 'revenue',   isGroup: G, statementType: PL },
      { accountCode: '41101',    accountName: 'إيرادات عقود مقاولات',                     accountNameEn: 'Construction Contract Revenue',    parentCode: '411',   type: 'revenue',   isGroup: G, statementType: PL },
      { accountCode: '41102',    accountName: 'إيرادات خدمات إضافية',                     accountNameEn: 'Additional Services Revenue',      parentCode: '411',   type: 'revenue',   isGroup: L, statementType: PL },
      { accountCode: '42101',    accountName: 'إيرادات متنوعة',                            accountNameEn: 'Miscellaneous Revenue',            parentCode: '421',   type: 'revenue',   isGroup: G, statementType: PL },
      { accountCode: '41101001', accountName: 'إيرادات عقود المقاولات',                   accountNameEn: 'Construction Contract Revenue',    parentCode: '41101', type: 'revenue',   isGroup: L, statementType: PL },
      { accountCode: '42101001', accountName: 'إيرادات متنوعة',                            accountNameEn: 'Miscellaneous Revenue',            parentCode: '42101', type: 'revenue',   isGroup: L, statementType: PL },
      // ══ 5 — المصروفات ════════════════════════════════════════════
      { accountCode: '5',        accountName: 'المصروفات',                                 accountNameEn: 'Expenses',                         parentCode: '',      type: 'expense',   isGroup: G, statementType: PL },
      // L2
      { accountCode: '51',       accountName: 'تكاليف العقود',                             accountNameEn: 'Contract Costs (COGS)',            parentCode: '5',     type: 'expense',   isGroup: G, statementType: PL },
      { accountCode: '52',       accountName: 'المصروفات التشغيلية',                       accountNameEn: 'Operating Expenses',               parentCode: '5',     type: 'expense',   isGroup: G, statementType: PL },
      { accountCode: '53',       accountName: 'المصروفات التمويلية',                       accountNameEn: 'Finance Expenses',                 parentCode: '5',     type: 'expense',   isGroup: G, statementType: PL },
      // L3 — under 51
      { accountCode: '511',      accountName: 'تكاليف مباشرة',                             accountNameEn: 'Direct Costs',                     parentCode: '51',    type: 'expense',   isGroup: G, statementType: PL },
      { accountCode: '512',      accountName: 'تكاليف غير مباشرة للموقع',                 accountNameEn: 'Indirect Site Costs',              parentCode: '51',    type: 'expense',   isGroup: G, statementType: PL },
      // L3 — under 52
      { accountCode: '521',      accountName: 'إدارية وعمومية',                            accountNameEn: 'General & Administrative',         parentCode: '52',    type: 'expense',   isGroup: G, statementType: PL },
      { accountCode: '522',      accountName: 'مصروفات التسويق والبيع',                    accountNameEn: 'Marketing & Sales',                parentCode: '52',    type: 'expense',   isGroup: G, statementType: PL },
      // L3 — under 53
      { accountCode: '531',      accountName: 'تكاليف التمويل',                            accountNameEn: 'Financing Costs',                  parentCode: '53',    type: 'expense',   isGroup: G, statementType: PL },
      // L4 — under 511
      { accountCode: '51101',    accountName: 'مواد',                                      accountNameEn: 'Construction Materials',           parentCode: '511',   type: 'expense',   isGroup: G, statementType: PL },
      { accountCode: '51102',    accountName: 'عمالة مباشرة',                              accountNameEn: 'Direct Labour',                    parentCode: '511',   type: 'expense',   isGroup: G, statementType: PL },
      { accountCode: '51103',    accountName: 'مقاولو الباطن',                              accountNameEn: 'Subcontractors',                   parentCode: '511',   type: 'expense',   isGroup: G, statementType: PL },
      { accountCode: '51104',    accountName: 'معدات وآلات',                               accountNameEn: 'Equipment & Machinery',            parentCode: '511',   type: 'expense',   isGroup: G, statementType: PL },
      { accountCode: '51105',    accountName: 'نقل ولوجستيات',                             accountNameEn: 'Transportation & Logistics',       parentCode: '511',   type: 'expense',   isGroup: G, statementType: PL },
      // L4 — under 512
      { accountCode: '51201',    accountName: 'إشراف ميداني',                              accountNameEn: 'Field Supervision',                parentCode: '512',   type: 'expense',   isGroup: G, statementType: PL },
      { accountCode: '51202',    accountName: 'مستلزمات الموقع',                           accountNameEn: 'Site Supplies',                    parentCode: '512',   type: 'expense',   isGroup: L, statementType: PL },
      // L4 — under 521
      { accountCode: '52101',    accountName: 'رواتب وأجور إدارية',                        accountNameEn: 'Administrative Salaries',          parentCode: '521',   type: 'expense',   isGroup: G, statementType: PL },
      { accountCode: '52102',    accountName: 'إيجارات مكاتب',                             accountNameEn: 'Office Rent',                      parentCode: '521',   type: 'expense',   isGroup: G, statementType: PL },
      { accountCode: '52103',    accountName: 'مرافق واتصالات',                            accountNameEn: 'Utilities & Communications',       parentCode: '521',   type: 'expense',   isGroup: G, statementType: PL },
      { accountCode: '52104',    accountName: 'رسوم قانونية ومهنية',                       accountNameEn: 'Legal & Professional Fees',        parentCode: '521',   type: 'expense',   isGroup: G, statementType: PL },
      { accountCode: '52105',    accountName: 'تأمينات',                                   accountNameEn: 'Insurance',                        parentCode: '521',   type: 'expense',   isGroup: G, statementType: PL },
      { accountCode: '52106',    accountName: 'إهلاك وإطفاء',                              accountNameEn: 'Depreciation & Amortization',      parentCode: '521',   type: 'expense',   isGroup: G, statementType: PL },
      { accountCode: '52107',    accountName: 'أدوات كتابية ومكتبية',                      accountNameEn: 'Office & Stationery',              parentCode: '521',   type: 'expense',   isGroup: G, statementType: PL },
      // L4 — under 522
      { accountCode: '52201',    accountName: 'دعاية وإعلان',                              accountNameEn: 'Advertising & Marketing',          parentCode: '522',   type: 'expense',   isGroup: G, statementType: PL },
      // L4 — under 531
      { accountCode: '53101',    accountName: 'فوائد بنكية',                               accountNameEn: 'Bank Interest',                    parentCode: '531',   type: 'expense',   isGroup: G, statementType: PL },
      { accountCode: '53102',    accountName: 'رسوم بنكية',                                accountNameEn: 'Bank Charges',                     parentCode: '531',   type: 'expense',   isGroup: G, statementType: PL },
      { accountCode: '53103',    accountName: 'خسائر فروق العملة',                         accountNameEn: 'Foreign Currency Losses',          parentCode: '531',   type: 'expense',   isGroup: G, statementType: PL },
      // L5 — leaves (expense)
      { accountCode: '51101001', accountName: 'مواد البناء',                               accountNameEn: 'Building Materials',               parentCode: '51101', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '51101002', accountName: 'مواد لاندسكيب',                             accountNameEn: 'Landscape Materials',              parentCode: '51101', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '51102001', accountName: 'رواتب وأجور مواقع',                        accountNameEn: 'Site Labour',                      parentCode: '51102', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '51102002', accountName: 'أجور مقاولة',                               accountNameEn: 'Contract Labour',                  parentCode: '51102', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '51103001', accountName: 'مقاولو الباطن - تكاليف',                   accountNameEn: 'Subcontractors - Cost',            parentCode: '51103', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '51104001', accountName: 'إيجار معدات',                               accountNameEn: 'Equipment Rent',                   parentCode: '51104', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '51105001', accountName: 'إيجار نقل',                                 accountNameEn: 'Transport Rent',                   parentCode: '51105', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '51201001', accountName: 'أجور ومرتبات إدارة الموقع',                accountNameEn: 'Field Supervision Salaries',       parentCode: '51201', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '52101001', accountName: 'رواتب وأجور إدارية',                        accountNameEn: 'Administrative Salaries',          parentCode: '52101', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '52102001', accountName: 'إيجار مقر الشركة',                         accountNameEn: 'Office Rent',                      parentCode: '52102', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '52103001', accountName: 'كهرباء',                                    accountNameEn: 'Electricity',                      parentCode: '52103', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '52104001', accountName: 'رسوم قانونية ومهنية',                       accountNameEn: 'Legal & Professional Fees',        parentCode: '52104', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '52105001', accountName: 'تأمينات مقاولات',                           accountNameEn: 'Construction Insurance',           parentCode: '52105', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '52106001', accountName: 'إهلاك سيارات النقل',                       accountNameEn: 'Vehicle Depreciation',             parentCode: '52106', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '52107001', accountName: 'أدوات كتابية ومكتبية',                      accountNameEn: 'Office & Stationery',              parentCode: '52107', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '52201001', accountName: 'دعاية وإعلان',                              accountNameEn: 'Advertising & Marketing',          parentCode: '52201', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '53101001', accountName: 'فوائد بنكية',                               accountNameEn: 'Bank Interest',                    parentCode: '53101', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '53102001', accountName: 'رسوم بنكية',                                accountNameEn: 'Bank Charges',                     parentCode: '53102', type: 'expense',   isGroup: L, statementType: PL },
      { accountCode: '53103001', accountName: 'خسائر فروق العملة',                         accountNameEn: 'Foreign Currency Losses',          parentCode: '53103', type: 'expense',   isGroup: L, statementType: PL },
    ];
    for (const acc of defaults) await addDoc(collection(db, 'chart_of_accounts'), { ...acc, status: 'active' });
  };

  const resetAndSeed = async () => {
    setIsSubmitting(true);
    try {
      const snap = await getDocs(collection(db, 'chart_of_accounts'));
      // delete in batches of 400 (Firestore limit is 500)
      const chunks: typeof snap.docs[] = [];
      for (let i = 0; i < snap.docs.length; i += 400) chunks.push(snap.docs.slice(i, i + 400));
      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach(d => batch.delete(doc(db, 'chart_of_accounts', d.id)));
        await batch.commit();
      }
      await seedAccounts();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'chart_of_accounts');
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmResetAndSeed = async () => {
    if (!isAdmin) {
      toast.error(language === 'ar' ? 'هذا الإجراء متاح لمدير النظام فقط.' : 'This action is limited to system administrators.');
      return;
    }
    if (isSubmitting) return;
    const emptyAr =
      'تحذير: سيتم إنشاء شجرة الحسابات الافتراضية الكاملة في النظام.\nتأكد من عدم وجود تعارض مع بياناتك قبل المتابعة.\n\nهل تريد المتابعة؟';
    const emptyEn =
      'WARNING: This will create the full default chart of accounts.\nMake sure this matches your setup before continuing.\n\nContinue?';
    const replaceAr =
      'تحذير خطير: سيتم حذف جميع حسابات الشجرة الحالية واستبدالها بالشجرة الافتراضية.\nقد ينقطع الربط مع القيود والتقارير التي تعتمد على الأكواد الحالية، ولا يمكن التراجع تلقائياً.\n\nاكتب موافقتك: اضغط موافق فقط إذا فهمت المخاطر.';
    const replaceEn =
      'CRITICAL: All existing chart-of-accounts rows will be deleted and replaced with the default tree.\nJournal entries and reports that rely on current codes may break; there is no automatic undo.\n\nProceed only if you understand the risk—click OK to continue.';
    const ok = await confirmDlg({
      title: language === 'ar' ? 'تحذير' : 'Warning',
      message: accounts.length === 0 ? (language === 'ar' ? emptyAr : emptyEn) : (language === 'ar' ? replaceAr : replaceEn),
      variant: 'danger',
      confirmLabel: language === 'ar' ? 'متابعة' : 'Continue',
    });
    if (!ok) return;
    resetSeedRef.current = () => resetAndSeed();
    setVerifyOpen(true);
  };

  const handleExportExcel = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(accounts.map(acc => ({
      'Account Code': acc.accountCode,
      'Account Name': acc.accountName,
      'Account Name (EN)': acc.accountNameEn || '',
      'Parent Code': acc.parentCode,
      'Type': acc.type,
      'Is Group': acc.isGroup ? 'Yes' : 'No',
      'Status': acc.status || 'active'
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ChartOfAccounts');
    XLSX.writeFile(wb, `COA_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(evt.target?.result as string, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[];
      const importableRows = data.filter((row) => {
        const accountCode = String(row['Account Code'] || row['كود الحساب'] || '');
        const accountName = String(row['Account Name'] || row['اسم الحساب'] || '');
        return accountCode && accountName;
      });

      setIsSubmitting(true);
      try {
        await runWithProgress(
          {
            label: language === 'ar' ? 'استيراد شجرة الحسابات…' : 'Importing chart of accounts…',
            total: importableRows.length,
          },
          async (update) => {
            let imported = 0;
            for (const row of importableRows) {
              const acc = {
                accountCode: String(row['Account Code'] || row['كود الحساب'] || ''),
                accountName: String(row['Account Name'] || row['اسم الحساب'] || ''),
                accountNameEn: String(row['Account Name (EN)'] || row['الاسم الإنجليزي'] || ''),
                parentCode: String(row['Parent Code'] || row['الحساب الأب'] || ''),
                type: String(row['Type'] || row['النوع'] || 'asset').toLowerCase(),
                isGroup: String(row['Is Group'] || row['مجموعة'] || 'No').toLowerCase() === 'yes',
              };
              await addDoc(collection(db, 'chart_of_accounts'), acc);
              imported += 1;
              update(imported, acc.accountCode);
            }
          },
        );
        toast.success(language === 'ar' ? 'تم استيراد شجرة الحسابات' : 'Chart of accounts imported');
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'chart_of_accounts');
      } finally {
        setIsSubmitting(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const visibleAccounts = searchQuery
    ? accounts.filter(a =>
        a.accountName.includes(searchQuery) ||
        (a.accountNameEn || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.accountCode.includes(searchQuery)
      )
    : accounts;

  const renderAccount = (parentCode: string = '', level: number = 0): React.ReactNode => {
    const parentNorm = String(parentCode ?? '').trim();
    const filtered = visibleAccounts.filter(
      (acc) => String(acc.parentCode ?? '').trim() === parentNorm,
    );
    return filtered.map((acc, ai) => {
      const isExpanded = expandedGroups.has(acc.accountCode);
      const primaryName   = language === 'ar' ? acc.accountName : (acc.accountNameEn || acc.accountName);
      const secondaryName = language === 'ar' ? acc.accountNameEn : undefined;
      const accountDisabled = isAccountDisabled(acc);
      return (
        <div key={compositeListKey(acc.accountCode, acc.id, ai, `coa-L${level}`)} className="select-none">
          <div
            className={cn(
              'flex items-center gap-2 py-2 px-4 cursor-pointer border-b transition-colors group',
              theme === 'dark' ? 'hover:bg-gray-800/50 border-gray-800/20' : theme === 'soft' ? 'hover:bg-white/50 border-[#cfd8dc]' : 'hover:bg-gray-100 border-gray-100',
              level === 0 && (theme === 'dark' ? 'bg-gray-900/40 font-black text-blue-400 text-sm' : theme === 'soft' ? 'bg-[#eceff1]/60 font-black text-blue-600 text-sm' : 'bg-blue-50 font-black text-blue-700 text-sm'),
              level === 1 && (theme === 'dark' ? 'bg-gray-900/20 font-bold text-gray-200' : 'font-bold'),
              level === 2 && 'font-semibold text-sm',
              level >= 3 && 'text-sm',
              accountDisabled && 'opacity-40 grayscale'
            )}
            style={dir === 'rtl'
              ? { paddingRight: `${level * 20 + 16}px` }
              : { paddingLeft:  `${level * 20 + 16}px` }}
            onClick={() => acc.isGroup && toggleGroup(acc.accountCode)}
          >
            {acc.isGroup ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <div className="w-3.5" />}
            <span className={cn('font-mono opacity-40 shrink-0', level === 0 ? 'text-sm w-8' : level === 1 ? 'text-xs w-10' : 'text-[11px] w-14')}>{acc.accountCode}</span>
            <span className={cn('flex-1 flex items-baseline gap-2', accountDisabled && 'line-through')}>
              <span>{primaryName}</span>
              {secondaryName && <span className="text-[11px] opacity-35 font-normal">{secondaryName}</span>}
            </span>
            <div
              className={cn(
                'flex items-center gap-3 transition-opacity',
                accountDisabled ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
            >
              {/* Statement type badge */}
              {acc.statementType && (
                <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded-sm font-black border shrink-0',
                  acc.statementType === 'balance_sheet'
                    ? 'bg-cyan-900/20 text-cyan-400 border-cyan-900/30'
                    : 'bg-amber-900/20 text-amber-400 border-amber-900/30'
                )}>
                  {acc.statementType === 'balance_sheet'
                    ? (language === 'ar' ? 'ميزانية' : 'B/S')
                    : (language === 'ar' ? 'قائمة دخل' : 'P&L')}
                </span>
              )}
              {/* Account type badge */}
              <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded-sm font-bold shrink-0',
                acc.type === 'asset'     ? 'bg-green-900/20 text-green-400' :
                acc.type === 'liability' ? 'bg-red-900/20 text-red-400' :
                acc.type === 'equity'    ? 'bg-purple-900/20 text-purple-400' :
                acc.type === 'revenue'   ? 'bg-blue-900/20 text-blue-400' :
                                           'bg-orange-900/20 text-orange-400'
              )}>
                {acc.type === 'asset'     ? (language === 'ar' ? 'أصول' : 'Asset') :
                 acc.type === 'liability' ? (language === 'ar' ? 'خصوم' : 'Liab') :
                 acc.type === 'equity'    ? (language === 'ar' ? 'ملكية' : 'Equity') :
                 acc.type === 'revenue'   ? (language === 'ar' ? 'إيرادات' : 'Rev') :
                                           (language === 'ar' ? 'مصروفات' : 'Exp')}
              </span>
              {accountDisabled && (
                <span className="text-[9px] uppercase px-1.5 py-0.5 rounded-sm font-bold shrink-0 bg-gray-800/40 text-gray-400 border border-gray-700/50">
                  {language === 'ar' ? 'معطل' : 'Disabled'}
                </span>
              )}
              <button
                type="button"
                title={accountDisabled
                  ? (language === 'ar' ? 'تفعيل الحساب' : 'Activate account')
                  : (language === 'ar' ? 'تعطيل الحساب' : 'Disable account')}
                disabled={!allowEdit}
                onClick={(e) => { e.stopPropagation(); void handleToggleStatus(acc); }}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                  accountDisabled
                    ? 'bg-green-600/20 text-green-500 hover:bg-green-600/30 disabled:hover:bg-green-600/20'
                    : 'bg-red-600/20 text-red-500 hover:bg-red-600/30',
                )}
              >
                {accountDisabled ? (language === 'ar' ? 'تفعيل' : 'Activate') : (language === 'ar' ? 'تعطيل' : 'Disable')}
              </button>
              {acc.isGroup && (
                <button
                  type="button"
                  title={language === 'ar' ? 'إضافة حساب فرعي' : 'Add Sub-Account'}
                  onClick={(e) => { if (!allowCreate) return; e.stopPropagation(); setEditingAccount(null); setNewAccountParent(acc); setIsAccountModalOpen(true); }}
                  className="text-gray-500 hover:text-green-400"
                ><Plus size={13} /></button>
              )}
              <button type="button" title={language === 'ar' ? 'تعديل' : 'Edit'} onClick={(e) => { if (!allowEdit) return; e.stopPropagation(); setNewAccountParent(null); setEditingAccount(acc); setIsAccountModalOpen(true); }} className="text-gray-500 hover:text-white"><Edit2 size={13} /></button>
              <button type="button" title={language === 'ar' ? 'حذف' : 'Delete'} className="text-gray-500 hover:text-red-500" disabled={!allowEdit}><Trash2 size={13} /></button>
            </div>
          </div>
          <AnimatePresence>
            {acc.isGroup && isExpanded && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                {renderAccount(acc.accountCode, level + 1)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    });
  };

  return (
    <>
      <div className={cn('border rounded-xl overflow-hidden shadow-2xl transition-colors', theme === 'dark' ? 'bg-[#151619] border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200')}>
        <div className={cn('p-4 border-b flex items-center gap-4 transition-colors', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc]' : 'bg-gray-50 border-gray-200')}>
          <div className="relative flex-1">
            <Search className={cn('absolute top-1/2 -translate-y-1/2 text-gray-500', dir === 'rtl' ? 'right-3' : 'left-3')} size={18} />
            <input
              type="text"
              placeholder={language === 'ar' ? 'بحث في الحسابات...' : 'Search accounts...'}
              className={cn('w-full border rounded-lg py-2 text-sm outline-none focus:border-blue-500 transition-colors', dir === 'rtl' ? 'pr-10 pl-4' : 'pl-10 pr-4', theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleExportExcel} className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded-md text-xs font-medium transition-colors flex items-center gap-2 text-white">
              <FileDown size={14} />
              {language === 'ar' ? 'تصدير إكسل' : 'Export Excel'}
            </button>
            <label className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-md text-xs font-medium transition-colors flex items-center gap-2 text-white cursor-pointer">
              <FileUp size={14} />
              {language === 'ar' ? 'استيراد إكسل' : 'Import Excel'}
              {isSubmitting && <Loader2 className="animate-spin" size={12} />}
              <input type="file" className="hidden" accept=".xlsx, .xls" onChange={handleImportExcel} />
            </label>
            {allowCreate && (
              <button type="button" onClick={() => { setEditingAccount(null); setNewAccountParent(null); setIsAccountModalOpen(true); }} className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-md text-xs font-medium transition-colors flex items-center gap-2 text-white">
                {language === 'ar' ? 'إضافة حساب' : 'Add Account'}
              </button>
            )}
            {isAdmin ? (
            <button
              type="button"
              onClick={() => void confirmResetAndSeed()}
              disabled={isSubmitting}
              className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 px-4 py-2 rounded-md text-xs font-medium transition-colors flex items-center gap-2"
            >
              {isSubmitting && <Loader2 className="animate-spin" size={12} />}
              {accounts.length === 0
                ? (language === 'ar' ? 'توليد الشجرة الافتراضية' : 'Seed Default COA')
                : (language === 'ar' ? 'إعادة تهيئة الشجرة' : 'Reset & Reseed')}
            </button>
            ) : null}
          </div>
        </div>
        <div className="overflow-y-auto max-h-[calc(100vh-350px)]">
          {loading ? (
            <div className="p-12 text-center text-gray-500">{language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</div>
          ) : accounts.length === 0 ? (
            <div className="p-12 text-center text-gray-500">{language === 'ar' ? 'لا توجد حسابات.' : 'No accounts found.'}</div>
          ) : (
            <div className="py-2">{renderAccount()}</div>
          )}
        </div>
      </div>

      <AccountModal
        isOpen={isAccountModalOpen}
        onClose={() => { setIsAccountModalOpen(false); setEditingAccount(null); setNewAccountParent(null); }}
        accounts={accounts}
        theme={theme}
        language={language}
        editingAccount={editingAccount}
        defaultParentCode={newAccountParent?.accountCode}
        defaultType={newAccountParent?.type}
      />

      <AdminSensitiveVerifyModal
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        language={language as 'ar' | 'en'}
        theme={theme}
        onVerified={async () => {
          const fn = resetSeedRef.current;
          resetSeedRef.current = null;
          if (fn) await fn();
        }}
      />
    </>
  );
}
