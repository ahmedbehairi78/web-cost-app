import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
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
  locale: string;
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
    default_screen: 'الشاشة الافتراضية',
    default_screen_hint: 'الشاشة التي تُفتح تلقائياً عند تسجيل الدخول',
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
    alert: 'تنبيه',
    error_saving: 'خطأ في الحفظ، يرجى المحاولة مرة أخرى',
    error_deleting: 'خطأ في الحذف، يرجى المحاولة مرة أخرى',
    error_loading: 'خطأ في تحميل البيانات',
    saved_successfully: 'تم الحفظ بنجاح',
    deleted_successfully: 'تم الحذف بنجاح',
    // Dashboard
    aggregating_data: 'جاري تجميع البيانات المالية...',
    portfolio_overview: 'نظرة عامة على المحفظة',
    portfolio_subtitle: 'متابعة الأداء المالي والتدفق النقدي لكافة المشاريع',
    export_pdf: 'تصدير تقرير PDF',
    refresh_data: 'تحديث البيانات',
    currency: 'ج.م',
    chart_costs: 'التكاليف',
    chart_revenue: 'الإيرادات',
    chart_collections: 'المتحصلات',
    recent_entries: 'أحدث القيود المحاسبية',
    no_entries: 'لا توجد قيود حالياً',
    view_all_entries: 'عرض كافة القيود ←',
    // BOQ
    boq_confirm_clear: 'تأكيد المسح',
    boq_confirm_clear_msg: 'هل أنت متأكد من رغبتك في مسح كافة بنود جدول الكميات لهذا العقد؟ لا يمكن التراجع عن هذه الخطوة.',
    delete_item: 'حذف البند',
    delete_item_msg: 'هل أنت متأكد من حذف هذا البند؟',
    boq_page_title: 'جدول الكميات (BOQ)',
    boq_page_subtitle: 'إدارة بنود التعاقد، الكميات، وتحليل الأسعار',
    total_project_value: 'إجمالي قيمة المشروع',
    export_template: 'تصدير قالب',
    export: 'تصدير',
    import_template: 'استيراد قالب',
    import: 'استيراد',
    clear: 'تفريغ',
    boq_clear_table: 'تفريغ الجدول',
    add_contract: 'إضافة عقد',
    select_contract: 'اختر العقد',
    chapter: 'الفصل',
    section_col: 'القسم',
    code: 'الكود',
    qty: 'الكمية',
    start_date: 'بدء العمل',
    duration: 'المدة',
    end_date: 'نهاية العمل',
    progress: 'الإنجاز',
    mat_abbr: 'مواد',
    lab_abbr: 'عمالة',
    equip_abbr: 'معدات',
    oh_pct: 'م.ع %',
    profit_pct: 'ربح %',
    loading_items: 'جاري تحميل البنود...',
    no_items: 'لا توجد بنود مسجلة لهذا المشروع.',
    done: 'مكتمل',
    late: 'متأخر',
    running: 'جاري',
    confirm: 'تأكيد',
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
    default_screen: 'Default Screen',
    default_screen_hint: 'Screen that opens automatically on login',
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
    alert: 'Alert',
    error_saving: 'Error saving, please try again',
    error_deleting: 'Error deleting, please try again',
    error_loading: 'Error loading data',
    saved_successfully: 'Saved successfully',
    deleted_successfully: 'Deleted successfully',
    // Dashboard
    aggregating_data: 'Aggregating financial data...',
    portfolio_overview: 'Portfolio Overview',
    portfolio_subtitle: 'Monitor financial performance and cash flow across all projects',
    export_pdf: 'Export PDF',
    refresh_data: 'Refresh Data',
    currency: 'EGP',
    chart_costs: 'Costs',
    chart_revenue: 'Revenue',
    chart_collections: 'Collections',
    recent_entries: 'Recent Journal Entries',
    no_entries: 'No entries yet',
    view_all_entries: 'View all entries ←',
    // BOQ
    boq_confirm_clear: 'Confirm Clear',
    boq_confirm_clear_msg: 'Are you sure you want to clear all BOQ items for this contract? This action cannot be undone.',
    delete_item: 'Delete Item',
    delete_item_msg: 'Are you sure you want to delete this item?',
    boq_page_title: 'Bill of Quantities (BOQ)',
    boq_page_subtitle: 'Manage contract items, quantities, and price analysis',
    total_project_value: 'Total Project Value',
    export_template: 'Export Template',
    export: 'Export',
    import_template: 'Import Template',
    import: 'Import',
    clear: 'Clear',
    boq_clear_table: 'Clear Table',
    add_contract: 'Add Contract',
    select_contract: 'Select Contract',
    chapter: 'Chapter',
    section_col: 'Section',
    code: 'Code',
    qty: 'Qty',
    start_date: 'Start Date',
    duration: 'Dur.',
    end_date: 'End Date',
    progress: 'Progress',
    mat_abbr: 'Mat.',
    lab_abbr: 'Lab.',
    equip_abbr: 'Equip.',
    oh_pct: 'OH%',
    profit_pct: 'Prof%',
    loading_items: 'Loading items...',
    no_items: 'No items recorded for this project.',
    done: 'Done',
    late: 'Late',
    running: 'Runs',
    confirm: 'Confirm',
  }
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>('ar');
  const [theme, setTheme] = useState<Theme>('dark');

  const t = useCallback((key: string) => {
    const val = translations[language][key];
    if (val === undefined && import.meta.env.DEV) {
      console.warn(`[i18n] Missing translation key: "${key}" for language "${language}"`);
    }
    return val ?? key;
  }, [language]);

  const dir: 'rtl' | 'ltr' = language === 'ar' ? 'rtl' : 'ltr';
  const locale = language === 'ar' ? 'ar-EG' : 'en-US';

  const contextValue = useMemo(
    () => ({ language, setLanguage, theme, setTheme, t, dir, locale }),
    [language, theme, t, dir, locale],
  );

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
    <LanguageContext.Provider value={contextValue}>
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
