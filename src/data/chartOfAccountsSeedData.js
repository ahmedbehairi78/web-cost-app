/**
 * Complete 5-level chart of accounts for a construction company.
 * Level 5 (8-digit codes) are the ONLY leaf accounts used in journal entries.
 * All levels 1–4 are group accounts (isGroup: true).
 *
 * Corrections vs. the original import document:
 *  - 11302001 replaces the erroneously-coded 11301002 (parent was 11302)
 *  - 21402 is WHT Payable (the duplicate 21401 entry in the original)
 *  - 51105 is Transport & Logistics (the duplicate 51104 entry)
 *  - 51201 is Field Supervision (wrong code 21201 in the original)
 */
export const CHART_OF_ACCOUNTS_SEED = [
    // ═══════════════════════════════════════════════════════════
    // LEVEL 1 — Main Categories
    // ═══════════════════════════════════════════════════════════
    { accountCode: '1', accountName: 'الأصول', accountNameEn: 'Assets', parentCode: '', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '2', accountName: 'الخصوم', accountNameEn: 'Liabilities', parentCode: '', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '3', accountName: 'حقوق الملكية', accountNameEn: 'Equity', parentCode: '', type: 'equity', isGroup: true, status: 'active' },
    { accountCode: '4', accountName: 'الإيرادات', accountNameEn: 'Revenue', parentCode: '', type: 'revenue', isGroup: true, status: 'active' },
    { accountCode: '5', accountName: 'المصروفات', accountNameEn: 'Expenses', parentCode: '', type: 'expense', isGroup: true, status: 'active' },
    // ═══════════════════════════════════════════════════════════
    // ASSETS (1)
    // ═══════════════════════════════════════════════════════════
    // Level 2
    { accountCode: '11', accountName: 'الأصول الثابتة', accountNameEn: 'Fixed Assets', parentCode: '1', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '12', accountName: 'الأصول المتداولة', accountNameEn: 'Current Assets', parentCode: '1', type: 'asset', isGroup: true, status: 'active' },
    // Level 3 — Fixed Assets
    { accountCode: '111', accountName: 'وسائل النقل', accountNameEn: 'Transport & Vehicles', parentCode: '11', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '119', accountName: 'مجمع الإهلاك (دائن)', accountNameEn: 'Accumulated Depreciation', parentCode: '11', type: 'asset', isGroup: true, status: 'active' },
    // Level 3 — Current Assets
    { accountCode: '121', accountName: 'النقدية والبنوك', accountNameEn: 'Cash & Banks', parentCode: '12', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '122', accountName: 'العملاء والذمم المدينة', accountNameEn: 'Accounts Receivable', parentCode: '12', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '123', accountName: 'المدفوعات المقدمة', accountNameEn: 'Prepayments', parentCode: '12', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '124', accountName: 'حسابات ضريبية مدينة', accountNameEn: 'Tax Receivables', parentCode: '12', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '125', accountName: 'ذمم مدينة أخرى', accountNameEn: 'Other Receivables', parentCode: '12', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '126', accountName: 'أصول أخرى', accountNameEn: 'Other Assets', parentCode: '12', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '127', accountName: 'المخزون', accountNameEn: 'Inventory', parentCode: '12', type: 'asset', isGroup: true, status: 'active' },
    // Level 4 — Fixed Assets
    { accountCode: '11101', accountName: 'سيارات نقل', accountNameEn: 'Trucks & Vehicles', parentCode: '111', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '11901', accountName: 'مجمع إهلاك سيارات النقل', accountNameEn: 'Acc. Depr. - Vehicles', parentCode: '119', type: 'asset', isGroup: true, status: 'active' },
    // Level 4 — 121 Cash & Banks
    { accountCode: '12101', accountName: 'البنوك', accountNameEn: 'Banks', parentCode: '121', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '12102', accountName: 'الصناديق', accountNameEn: 'Cash on Hand', parentCode: '121', type: 'asset', isGroup: true, status: 'active' },
    // Level 4 — 122 Accounts Receivable
    { accountCode: '12201', accountName: 'العملاء - مستخلصات تحت التحصيل', accountNameEn: 'Clients - IPCs Under Collection', parentCode: '122', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '12202', accountName: 'محتجزات الضمان - عملاء', accountNameEn: 'Retention Guarantee - Clients', parentCode: '122', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '12203', accountName: 'شيكات برسم التحصيل', accountNameEn: 'Cheques Under Collection', parentCode: '122', type: 'asset', isGroup: true, status: 'active' },
    // Level 4 — 123 Prepayments
    { accountCode: '12301', accountName: 'مقدمات للموردين', accountNameEn: 'Advances to Suppliers', parentCode: '123', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '12302', accountName: 'مقدمات لمقاولي الباطن', accountNameEn: 'Advances to Subcontractors', parentCode: '123', type: 'asset', isGroup: true, status: 'active' },
    // Level 4 — 124 Tax Receivables
    { accountCode: '12401', accountName: 'مصلحة الضرائب - خصم وإضافة', accountNameEn: 'WHT & VAT Input', parentCode: '124', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '12402', accountName: 'التأمينات الاجتماعية', accountNameEn: 'Social Insurance Receivable', parentCode: '124', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '12403', accountName: 'القوى العاملة', accountNameEn: 'Manpower Levy Receivable', parentCode: '124', type: 'asset', isGroup: true, status: 'active' },
    // Level 4 — Other Current Assets
    { accountCode: '12501', accountName: 'حسابات مدينة متنوعة', accountNameEn: 'Miscellaneous Receivables', parentCode: '125', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '12601', accountName: 'أعمال قيد التنفيذ (WIP)', accountNameEn: 'Work In Progress (WIP)', parentCode: '126', type: 'asset', isGroup: true, status: 'active' },
    { accountCode: '12701', accountName: 'مخزون مشاريع', accountNameEn: 'Project Inventory', parentCode: '127', type: 'asset', isGroup: true, status: 'active' },
    // ── Level 5 — ASSET LEAF ACCOUNTS ──────────────────────────
    { accountCode: '11101001', accountName: 'سيارات نقل', accountNameEn: 'Trucks & Vehicles - Cost', parentCode: '11101', type: 'asset', isGroup: false, status: 'active' },
    { accountCode: '11901001', accountName: 'مجمع إهلاك سيارات النقل', accountNameEn: 'Acc. Depr. - Vehicles', parentCode: '11901', type: 'asset', isGroup: false, status: 'active' },
    { accountCode: '12101001', accountName: 'البنك التجاري الدولي', accountNameEn: 'Commercial International Bank', parentCode: '12101', type: 'asset', isGroup: false, status: 'active' },
    { accountCode: '12102001', accountName: 'صندوق الشركة', accountNameEn: 'Company Cash Fund', parentCode: '12102', type: 'asset', isGroup: false, status: 'active' },
    { accountCode: '12201001', accountName: 'عملاء - مستخلصات تحت التحصيل', accountNameEn: 'Clients - IPCs Under Collection', parentCode: '12201', type: 'asset', isGroup: false, status: 'active' },
    { accountCode: '12202001', accountName: 'محتجزات الضمان - عملاء', accountNameEn: 'Retention Guarantee - Clients', parentCode: '12202', type: 'asset', isGroup: false, status: 'active' },
    { accountCode: '12203001', accountName: 'شيكات واردة برسم التحصيل', accountNameEn: 'Received Cheques Clearing', parentCode: '12203', type: 'asset', isGroup: false, status: 'active' },
    { accountCode: '12301001', accountName: 'مقدمات للموردين', accountNameEn: 'Advances to Suppliers', parentCode: '12301', type: 'asset', isGroup: false, status: 'active' },
    { accountCode: '12302001', accountName: 'مقدمات لمقاولي الباطن', accountNameEn: 'Advances to Subcontractors', parentCode: '12302', type: 'asset', isGroup: false, status: 'active' },
    { accountCode: '12401001', accountName: 'ضريبة القيمة المضافة - مدخلات', accountNameEn: 'VAT - Input', parentCode: '12401', type: 'asset', isGroup: false, status: 'active' },
    { accountCode: '12401002', accountName: 'ضريبة الخصم والإضافة - مدخلات', accountNameEn: 'WHT Receivable', parentCode: '12401', type: 'asset', isGroup: false, status: 'active' },
    { accountCode: '12402001', accountName: 'دفعات تحت حساب تأمينات عمالة منتظمة', accountNameEn: 'Social Insurance - Regular Labour', parentCode: '12402', type: 'asset', isGroup: false, status: 'active' },
    { accountCode: '12402002', accountName: 'دفعات تحت حساب تأمينات عمالة قطاعية', accountNameEn: 'Social Insurance - Casual Labour', parentCode: '12402', type: 'asset', isGroup: false, status: 'active' },
    { accountCode: '12403001', accountName: 'دفعات تحت حساب مستحقات القوى العاملة', accountNameEn: 'Manpower Levy Receivable', parentCode: '12403', type: 'asset', isGroup: false, status: 'active' },
    { accountCode: '12501001', accountName: 'حسابات مدينة متنوعة أخرى', accountNameEn: 'Miscellaneous Receivables', parentCode: '12501', type: 'asset', isGroup: false, status: 'active' },
    { accountCode: '12601001', accountName: 'أعمال تحت التنفيذ - عقد رقم 001', accountNameEn: 'Work In Progress - Contract 001', parentCode: '12601', type: 'asset', isGroup: false, status: 'active' },
    { accountCode: '12701001', accountName: 'مخزون مشروع — نموذج', accountNameEn: 'Project Inventory — Sample', parentCode: '127', type: 'asset', isGroup: false, status: 'active' },
    // ═══════════════════════════════════════════════════════════
    // LIABILITIES (2)
    // ═══════════════════════════════════════════════════════════
    // Level 2
    { accountCode: '21', accountName: 'الخصوم المتداولة', accountNameEn: 'Current Liabilities', parentCode: '2', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '22', accountName: 'الخصوم غير المتداولة', accountNameEn: 'Non-Current Liabilities', parentCode: '2', type: 'liability', isGroup: true, status: 'active' },
    // Level 3
    { accountCode: '211', accountName: 'ذمم دائنة تجارية', accountNameEn: 'Trade Payables', parentCode: '21', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '212', accountName: 'محتجزات الضمان - للمقاولين', accountNameEn: 'Retention Payable', parentCode: '21', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '213', accountName: 'دفعات مقدمة من العملاء', accountNameEn: 'Advances from Clients', parentCode: '21', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '214', accountName: 'التزامات ضريبية', accountNameEn: 'Tax Liabilities', parentCode: '21', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '215', accountName: 'مستحقات دائنة أخرى', accountNameEn: 'Other Payables', parentCode: '21', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '216', accountName: 'شيكات دفع', accountNameEn: 'Issued Cheques', parentCode: '21', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '221', accountName: 'قروض طويلة الأجل', accountNameEn: 'Long-term Loans', parentCode: '22', type: 'liability', isGroup: true, status: 'active' },
    // Level 4
    { accountCode: '21101', accountName: 'الموردون', accountNameEn: 'Suppliers', parentCode: '211', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '21102', accountName: 'مقاولو الباطن', accountNameEn: 'Subcontractors', parentCode: '211', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '21201', accountName: 'محتجزات ضمان الأعمال - مقاولون', accountNameEn: 'Work Retention - Contractors', parentCode: '212', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '21301', accountName: 'دفعات مقدمة من العملاء', accountNameEn: 'Client Advance Payments', parentCode: '213', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '21401', accountName: 'ضريبة القيمة المضافة - مخرجات', accountNameEn: 'VAT - Output', parentCode: '214', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '21402', accountName: 'مصلحة الضرائب - خصم وإضافة (دائن)', accountNameEn: 'WHT Tax Payable', parentCode: '214', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '21403', accountName: 'التأمينات الاجتماعية (دائن)', accountNameEn: 'Social Insurance Payable', parentCode: '214', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '21404', accountName: 'القوى العاملة (دائن)', accountNameEn: 'Manpower Levy Payable', parentCode: '214', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '21501', accountName: 'مصروفات مستحقة', accountNameEn: 'Accrued Expenses', parentCode: '215', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '21601', accountName: 'شيكات تحت الصرف', accountNameEn: 'Cheques Outstanding', parentCode: '216', type: 'liability', isGroup: true, status: 'active' },
    { accountCode: '22101', accountName: 'قروض بنكية طويلة الأجل', accountNameEn: 'Long-term Bank Loans', parentCode: '221', type: 'liability', isGroup: true, status: 'active' },
    // ── Level 5 — LIABILITY LEAF ACCOUNTS ──────────────────────
    { accountCode: '21101001', accountName: 'موردون - حساب عام', accountNameEn: 'Suppliers - General Account', parentCode: '21101', type: 'liability', isGroup: false, status: 'active' },
    { accountCode: '21102001', accountName: 'مقاولو الباطن - حساب عام', accountNameEn: 'Subcontractors - General Account', parentCode: '21102', type: 'liability', isGroup: false, status: 'active' },
    { accountCode: '21201001', accountName: 'محتجزات ضمان الأعمال - مقاولو الباطن', accountNameEn: 'Work Retention - Subcontractors', parentCode: '21201', type: 'liability', isGroup: false, status: 'active' },
    { accountCode: '21301001', accountName: 'دفعات مقدمة من العملاء', accountNameEn: 'Advance Payments from Clients', parentCode: '21301', type: 'liability', isGroup: false, status: 'active' },
    { accountCode: '21401001', accountName: 'ضريبة القيمة المضافة - مخرجات', accountNameEn: 'VAT - Output', parentCode: '21401', type: 'liability', isGroup: false, status: 'active' },
    { accountCode: '21402001', accountName: 'مصلحة الضرائب - خصم وإضافة (دائن)', accountNameEn: 'WHT Tax Payable', parentCode: '21402', type: 'liability', isGroup: false, status: 'active' },
    { accountCode: '21403001', accountName: 'التأمينات الاجتماعية (دائن)', accountNameEn: 'Social Insurance Payable', parentCode: '21403', type: 'liability', isGroup: false, status: 'active' },
    { accountCode: '21404001', accountName: 'القوى العاملة (دائن)', accountNameEn: 'Manpower Levy Payable', parentCode: '21404', type: 'liability', isGroup: false, status: 'active' },
    { accountCode: '21501001', accountName: 'مصروفات مستحقة', accountNameEn: 'Accrued Expenses', parentCode: '21501', type: 'liability', isGroup: false, status: 'active' },
    { accountCode: '21601001', accountName: 'شيكات تحت الصرف', accountNameEn: 'Issued Cheques Payable', parentCode: '21601', type: 'liability', isGroup: false, status: 'active' },
    { accountCode: '22101001', accountName: 'قروض بنكية طويلة الأجل', accountNameEn: 'Long-term Bank Loans', parentCode: '22101', type: 'liability', isGroup: false, status: 'active' },
    // ═══════════════════════════════════════════════════════════
    // EQUITY (3)
    // ═══════════════════════════════════════════════════════════
    // Level 2
    { accountCode: '31', accountName: 'رأس المال والاحتياطيات', accountNameEn: 'Capital & Reserves', parentCode: '3', type: 'equity', isGroup: true, status: 'active' },
    // Level 3
    { accountCode: '311', accountName: 'رأس المال', accountNameEn: 'Capital', parentCode: '31', type: 'equity', isGroup: true, status: 'active' },
    { accountCode: '312', accountName: 'الاحتياطيات', accountNameEn: 'Reserves', parentCode: '31', type: 'equity', isGroup: true, status: 'active' },
    { accountCode: '313', accountName: 'الأرباح المحتجزة', accountNameEn: 'Retained Earnings', parentCode: '31', type: 'equity', isGroup: true, status: 'active' },
    // Level 4
    { accountCode: '31101', accountName: 'رأس المال المدفوع', accountNameEn: 'Paid-in Capital', parentCode: '311', type: 'equity', isGroup: true, status: 'active' },
    { accountCode: '31201', accountName: 'احتياطي قانوني', accountNameEn: 'Legal Reserve', parentCode: '312', type: 'equity', isGroup: true, status: 'active' },
    { accountCode: '31202', accountName: 'احتياطيات أخرى', accountNameEn: 'Other Reserves', parentCode: '312', type: 'equity', isGroup: true, status: 'active' },
    { accountCode: '31301', accountName: 'الأرباح المحتجزة', accountNameEn: 'Retained Earnings', parentCode: '313', type: 'equity', isGroup: true, status: 'active' },
    // ── Level 5 — EQUITY LEAF ACCOUNTS ─────────────────────────
    { accountCode: '31101001', accountName: 'رأس المال المدفوع', accountNameEn: 'Paid-in Capital', parentCode: '31101', type: 'equity', isGroup: false, status: 'active' },
    { accountCode: '31201001', accountName: 'الاحتياطي القانوني', accountNameEn: 'Legal Reserve', parentCode: '31201', type: 'equity', isGroup: false, status: 'active' },
    { accountCode: '31202001', accountName: 'احتياطيات أخرى', accountNameEn: 'Other Reserves', parentCode: '31202', type: 'equity', isGroup: false, status: 'active' },
    { accountCode: '31301001', accountName: 'الأرباح المحتجزة', accountNameEn: 'Retained Earnings', parentCode: '31301', type: 'equity', isGroup: false, status: 'active' },
    // ═══════════════════════════════════════════════════════════
    // REVENUE (4)
    // ═══════════════════════════════════════════════════════════
    // Level 2
    { accountCode: '41', accountName: 'إيرادات تشغيلية', accountNameEn: 'Operating Revenue', parentCode: '4', type: 'revenue', isGroup: true, status: 'active' },
    { accountCode: '42', accountName: 'إيرادات أخرى', accountNameEn: 'Other Revenue', parentCode: '4', type: 'revenue', isGroup: true, status: 'active' },
    // Level 3
    { accountCode: '411', accountName: 'إيرادات عقود المقاولات', accountNameEn: 'Contract Revenue', parentCode: '41', type: 'revenue', isGroup: true, status: 'active' },
    { accountCode: '421', accountName: 'إيرادات غير تشغيلية', accountNameEn: 'Non-Operating Revenue', parentCode: '42', type: 'revenue', isGroup: true, status: 'active' },
    // Level 4
    { accountCode: '41101', accountName: 'إيرادات عقود مقاولات', accountNameEn: 'Construction Contract Revenue', parentCode: '411', type: 'revenue', isGroup: true, status: 'active' },
    { accountCode: '41102', accountName: 'إيرادات خدمات إضافية', accountNameEn: 'Additional Services Revenue', parentCode: '411', type: 'revenue', isGroup: true, status: 'active' },
    { accountCode: '42101', accountName: 'إيرادات متنوعة', accountNameEn: 'Miscellaneous Revenue', parentCode: '421', type: 'revenue', isGroup: true, status: 'active' },
    // ── Level 5 — REVENUE LEAF ACCOUNTS ────────────────────────
    { accountCode: '41101001', accountName: 'إيرادات عقود مقاولات', accountNameEn: 'Construction Contract Revenue', parentCode: '41101', type: 'revenue', isGroup: false, status: 'active' },
    { accountCode: '41102001', accountName: 'إيرادات خدمات إضافية', accountNameEn: 'Additional Services Revenue', parentCode: '41102', type: 'revenue', isGroup: false, status: 'active' },
    { accountCode: '42101001', accountName: 'إيرادات متنوعة', accountNameEn: 'Miscellaneous Revenue', parentCode: '42101', type: 'revenue', isGroup: false, status: 'active' },
    // ═══════════════════════════════════════════════════════════
    // EXPENSES (5)
    // ═══════════════════════════════════════════════════════════
    // Level 2
    { accountCode: '51', accountName: 'تكاليف العقود', accountNameEn: 'Contract Costs (COGS)', parentCode: '5', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '52', accountName: 'المصروفات التشغيلية', accountNameEn: 'Operating Expenses', parentCode: '5', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '53', accountName: 'المصروفات التمويلية', accountNameEn: 'Finance Expenses', parentCode: '5', type: 'expense', isGroup: true, status: 'active' },
    // Level 3
    { accountCode: '511', accountName: 'تكاليف مباشرة', accountNameEn: 'Direct Costs', parentCode: '51', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '512', accountName: 'تكاليف غير مباشرة للموقع', accountNameEn: 'Indirect Site Costs', parentCode: '51', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '521', accountName: 'إدارية وعمومية', accountNameEn: 'General & Administrative', parentCode: '52', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '522', accountName: 'مصروفات التسويق والبيع', accountNameEn: 'Marketing & Sales', parentCode: '52', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '531', accountName: 'تكاليف التمويل', accountNameEn: 'Financing Costs', parentCode: '53', type: 'expense', isGroup: true, status: 'active' },
    // Level 4
    { accountCode: '51101', accountName: 'مواد البناء', accountNameEn: 'Construction Materials', parentCode: '511', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '51102', accountName: 'عمالة مباشرة', accountNameEn: 'Direct Labour', parentCode: '511', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '51103', accountName: 'مقاولو الباطن', accountNameEn: 'Subcontractors', parentCode: '511', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '51104', accountName: 'معدات وآلات', accountNameEn: 'Equipment & Machinery', parentCode: '511', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '51105', accountName: 'نقل ولوجستيات', accountNameEn: 'Transportation & Logistics', parentCode: '511', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '51201', accountName: 'إشراف ميداني', accountNameEn: 'Field Supervision', parentCode: '512', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '51202', accountName: 'مستلزمات الموقع', accountNameEn: 'Site Supplies', parentCode: '512', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '52101', accountName: 'رواتب وأجور إدارية', accountNameEn: 'Administrative Salaries', parentCode: '521', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '52102', accountName: 'إيجارات مكاتب', accountNameEn: 'Office Rent', parentCode: '521', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '52103', accountName: 'مرافق واتصالات', accountNameEn: 'Utilities & Communications', parentCode: '521', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '52104', accountName: 'رسوم قانونية ومهنية', accountNameEn: 'Legal & Professional Fees', parentCode: '521', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '52105', accountName: 'تأمينات', accountNameEn: 'Insurance', parentCode: '521', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '52106', accountName: 'إهلاك وإطفاء', accountNameEn: 'Depreciation & Amortization', parentCode: '521', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '52107', accountName: 'مصروفات مكتبية وقرطاسية', accountNameEn: 'Office & Stationery', parentCode: '521', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '52201', accountName: 'دعاية وإعلان', accountNameEn: 'Advertising & Marketing', parentCode: '522', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '53101', accountName: 'فوائد بنكية', accountNameEn: 'Bank Interest', parentCode: '531', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '53102', accountName: 'رسوم بنكية', accountNameEn: 'Bank Charges', parentCode: '531', type: 'expense', isGroup: true, status: 'active' },
    { accountCode: '53103', accountName: 'خسائر فروق العملة', accountNameEn: 'Foreign Currency Losses', parentCode: '531', type: 'expense', isGroup: true, status: 'active' },
    // ── Level 5 — EXPENSE LEAF ACCOUNTS ────────────────────────
    { accountCode: '51101001', accountName: 'مواد البناء', accountNameEn: 'Construction Materials', parentCode: '51101', type: 'expense', isGroup: false, status: 'active' },
    { accountCode: '51102001', accountName: 'عمالة مباشرة', accountNameEn: 'Direct Labour', parentCode: '51102', type: 'expense', isGroup: false, status: 'active' },
    { accountCode: '51103001', accountName: 'مقاولو الباطن - تكاليف', accountNameEn: 'Subcontractor Costs', parentCode: '51103', type: 'expense', isGroup: false, status: 'active' },
    { accountCode: '51104001', accountName: 'معدات وآلات', accountNameEn: 'Equipment & Machinery', parentCode: '51104', type: 'expense', isGroup: false, status: 'active' },
    { accountCode: '51105001', accountName: 'نقل ولوجستيات', accountNameEn: 'Transportation & Logistics', parentCode: '51105', type: 'expense', isGroup: false, status: 'active' },
    { accountCode: '51201001', accountName: 'إشراف ميداني', accountNameEn: 'Field Supervision', parentCode: '51201', type: 'expense', isGroup: false, status: 'active' },
    { accountCode: '51202001', accountName: 'مستلزمات الموقع', accountNameEn: 'Site Supplies', parentCode: '51202', type: 'expense', isGroup: false, status: 'active' },
    { accountCode: '52101001', accountName: 'رواتب وأجور إدارية', accountNameEn: 'Administrative Salaries', parentCode: '52101', type: 'expense', isGroup: false, status: 'active' },
    { accountCode: '52102001', accountName: 'إيجارات مكاتب', accountNameEn: 'Office Rent', parentCode: '52102', type: 'expense', isGroup: false, status: 'active' },
    { accountCode: '52103001', accountName: 'مرافق واتصالات', accountNameEn: 'Utilities & Communications', parentCode: '52103', type: 'expense', isGroup: false, status: 'active' },
    { accountCode: '52104001', accountName: 'رسوم قانونية ومهنية', accountNameEn: 'Legal & Professional Fees', parentCode: '52104', type: 'expense', isGroup: false, status: 'active' },
    { accountCode: '52105001', accountName: 'تأمينات', accountNameEn: 'Insurance', parentCode: '52105', type: 'expense', isGroup: false, status: 'active' },
    { accountCode: '52106001', accountName: 'إهلاك وإطفاء', accountNameEn: 'Depreciation & Amortization', parentCode: '52106', type: 'expense', isGroup: false, status: 'active' },
    { accountCode: '52107001', accountName: 'مصروفات مكتبية وقرطاسية', accountNameEn: 'Office & Stationery', parentCode: '52107', type: 'expense', isGroup: false, status: 'active' },
    { accountCode: '52201001', accountName: 'دعاية وإعلان', accountNameEn: 'Advertising & Marketing', parentCode: '52201', type: 'expense', isGroup: false, status: 'active' },
    { accountCode: '53101001', accountName: 'فوائد بنكية', accountNameEn: 'Bank Interest', parentCode: '53101', type: 'expense', isGroup: false, status: 'active' },
    { accountCode: '53102001', accountName: 'رسوم بنكية', accountNameEn: 'Bank Charges', parentCode: '53102', type: 'expense', isGroup: false, status: 'active' },
    { accountCode: '53103001', accountName: 'خسائر فروق العملة', accountNameEn: 'Foreign Currency Losses', parentCode: '53103', type: 'expense', isGroup: false, status: 'active' },
];
