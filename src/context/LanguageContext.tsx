import React, { createContext, useContext, useState, useEffect } from 'react';
import { cn } from '../lib/utils';

type Language = 'ar' | 'en';
type Theme = 'dark' | 'light' | 'soft';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  t: (key: string) => string;
  dir: 'rtl' | 'ltr';
}

const translations: Record<Language, Record<string, string>> = {
  ar: {
    dashboard: 'لوحة التحكم',
    accounts: 'شجرة الحسابات',
    ledger: 'الأستاذ العام',
    projects: 'المشاريع',
    boq: 'جداول الكميات',
    costs: 'التكاليف الفعلية',
    billing: 'المستخلصات',
    suppliers: 'المشتريات',
    reports: 'التقارير',
    settings: 'الإعدادات',
    total_contracts: 'إجمالي قيمة العقود',
    actual_costs: 'التكاليف الفعلية',
    cash_collections: 'التحصيلات النقدية',
    pending_billing: 'مستخلصات تحت التحصيل',
    cash_flow_analysis: 'تحليل التدفق النقدي',
    financial_bottlenecks: 'تنبيهات الاختناقات المالية',
    add_project: 'إضافة مشروع جديد',
    project_name: 'اسم المشروع',
    project_code: 'كود المشروع',
    client_name: 'اسم العميل',
    status: 'الحالة',
    save: 'حفظ',
    cancel: 'إلغاء',
    active: 'نشط',
    completed: 'مكتمل',
    suspended: 'متوقف',
    cancelled: 'ملغي',
    add_item: 'إضافة بند جديد',
    item_code: 'كود البند',
    description: 'الوصف',
    unit: 'الوحدة',
    quantity: 'الكمية',
    unit_rate: 'سعر الوحدة',
    total_amount: 'الإجمالي',
    new_ipc: 'مستخلص جديد',
    billing_number: 'رقم المستخلص',
    net_payable: 'صافي المستحق',
    paid: 'تم التحصيل',
    draft: 'مسودة',
    submitted: 'تم التقديم',
    approved: 'تم الاعتماد',
    add_supplier: 'إضافة مورد جديد',
    supplier_name: 'اسم المورد',
    type: 'النوع',
    contact: 'الاتصال',
    email: 'البريد الإلكتروني',
    address: 'العنوان',
    material: 'مواد',
    labour: 'عمالة',
    equipment: 'معدات',
    subcontractor: 'مقاول باطن',
    profitability: 'ربحية المشاريع',
    cost_analysis: 'تحليل التكاليف',
    performance: 'أداء التنفيذ',
    database_settings: 'إعدادات قاعدة البيانات',
    user_settings: 'إعدادات المستخدمين',
    display_settings: 'إعدادات العرض',
    language_settings: 'إعدادات اللغة',
    print_settings: 'إعدادات الطباعة',
    dark_mode: 'الوضع الليلي',
    light_mode: 'الوضع المضيء',
    soft_mode: 'الوضع الهادئ',
    logout: 'تسجيل الخروج',
    purchases: 'المشتريات',
    invoice_entry: 'إثبات فاتورة',
    ipc_entry: 'إثبات مستخلص',
    invoice_date: 'تاريخ الفاتورة',
    invoice_number: 'رقم الفاتورة',
    amount: 'المبلغ',
    vat: 'ضريبة القيمة المضافة',
    total: 'الإجمالي',
    project: 'المشروع',
    contract: 'العقد',
    wht_pct: 'نسبة الخصم (ض.أ.ت.ص)',
    wht_amount: 'قيمة الخصم',
    expense_account: 'حساب المصروف',
    select_account: 'اختر الحساب',
  },
  en: {
    dashboard: 'Dashboard',
    accounts: 'Chart of Accounts',
    ledger: 'General Ledger',
    projects: 'Projects',
    boq: 'BOQ',
    costs: 'Actual Costs',
    billing: 'Billing (IPC)',
    suppliers: 'Purchases',
    reports: 'Reports',
    settings: 'Settings',
    total_contracts: 'Total Contract Value',
    actual_costs: 'Actual Costs',
    cash_collections: 'Cash Collections',
    pending_billing: 'Pending Billing',
    cash_flow_analysis: 'Cash Flow Analysis',
    financial_bottlenecks: 'Financial Bottlenecks',
    add_project: 'Add New Project',
    project_name: 'Project Name',
    project_code: 'Project Code',
    client_name: 'Client Name',
    status: 'Status',
    save: 'Save',
    cancel: 'Cancel',
    active: 'Active',
    completed: 'Completed',
    suspended: 'Suspended',
    cancelled: 'Cancelled',
    add_item: 'Add New Item',
    item_code: 'Item Code',
    description: 'Description',
    unit: 'Unit',
    quantity: 'Quantity',
    unit_rate: 'Unit Rate',
    total_amount: 'Total Amount',
    new_ipc: 'New IPC',
    billing_number: 'Billing No.',
    net_payable: 'Net Payable',
    paid: 'Paid',
    draft: 'Draft',
    submitted: 'Submitted',
    approved: 'Approved',
    add_supplier: 'Add New Supplier',
    supplier_name: 'Supplier Name',
    type: 'Type',
    contact: 'Contact',
    email: 'Email',
    address: 'Address',
    material: 'Material',
    labour: 'Labour',
    equipment: 'Equipment',
    subcontractor: 'Subcontractor',
    profitability: 'Project Profitability',
    cost_analysis: 'Cost Analysis',
    performance: 'Execution Performance',
    database_settings: 'Database Settings',
    user_settings: 'User Settings',
    display_settings: 'Display Settings',
    language_settings: 'Language Settings',
    print_settings: 'Print Settings',
    dark_mode: 'Dark Mode',
    light_mode: 'Light Mode',
    soft_mode: 'Soft Mode',
    logout: 'Logout',
    purchases: 'Purchases',
    invoice_entry: 'Invoice Entry',
    ipc_entry: 'IPC Entry',
    invoice_date: 'Invoice Date',
    invoice_number: 'Invoice Number',
    amount: 'Amount',
    vat: 'VAT',
    total: 'Total',
    project: 'Project',
    contract: 'Contract',
    wht_pct: 'WHT %',
    wht_amount: 'WHT Amount',
    expense_account: 'Expense Account',
    select_account: 'Select Account',
  }
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>('ar');
  const [theme, setTheme] = useState<Theme>('dark');

  const t = (key: string) => {
    return translations[language][key] || key;
  };

  const dir = language === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = language;
    document.documentElement.classList.remove('dark', 'soft');
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (theme === 'soft') {
      document.documentElement.classList.add('soft');
    }
  }, [language, dir, theme]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, theme, setTheme, t, dir }}>
      <div className={cn(theme === 'dark' ? 'dark' : '', theme === 'soft' ? 'soft' : '')}>
        {children}
      </div>
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
