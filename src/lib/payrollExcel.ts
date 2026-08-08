import * as XLSX from 'xlsx';

/** A row of a monthly payroll sheet imported from Excel. */
export type PayrollSheetImportRow = {
  employeeCode: string;
  employeeName: string;
  department?: string;
  costCenterCode?: string;
  expenseAccountCode?: string;
  expenseAccountName?: string;
  basicSalary?: number;
  overtime?: number;
  bonus?: number;
  incentiveKpi?: number;
  otherEarnings?: number;
  socialInsurance?: number;
  incomeTax?: number;
  advances?: number;
  penalties?: number;
  otherDeductions?: number;
  notes?: string;
  // Optional employee-master enrichment columns (filled only when seeding/updating master data via the sheet).
  birthDate?: string;
  hireDate?: string;
  priorInsuranceMonths?: number;
  carriedLeaveDays?: number;
};

const HEADERS_AR = [
  'كود الموظف',
  'اسم الموظف',
  'الإدارة',
  'كود مركز التكلفة',
  'كود حساب المصروف',
  'اسم حساب المصروف',
  'الراتب الأساسي',
  'إضافي',
  'مكافآت',
  'حافز KPI',
  'استحقاقات أخرى',
  'تأمينات اجتماعية',
  'ضريبة كسب العمل',
  'سلف',
  'جزاءات',
  'خصومات أخرى',
  'ملاحظات',
  'تاريخ الميلاد',
  'تاريخ التعيين',
  'مدة التأمين السابقة (شهر)',
  'رصيد إجازات مرحّل (يوم)',
];

const HEADERS_EN = [
  'Employee Code',
  'Employee Name',
  'Department',
  'Cost Center Code',
  'Expense Account Code',
  'Expense Account Name',
  'Basic Salary',
  'Overtime',
  'Bonus',
  'KPI Incentive',
  'Other Earnings',
  'Social Insurance',
  'Income Tax',
  'Advances',
  'Penalties',
  'Other Deductions',
  'Notes',
  'Birth Date',
  'Hire Date',
  'Prior Insurance (months)',
  'Carried Leave Balance (days)',
];

const FIELD_ORDER: (keyof PayrollSheetImportRow)[] = [
  'employeeCode',
  'employeeName',
  'department',
  'costCenterCode',
  'expenseAccountCode',
  'expenseAccountName',
  'basicSalary',
  'overtime',
  'bonus',
  'incentiveKpi',
  'otherEarnings',
  'socialInsurance',
  'incomeTax',
  'advances',
  'penalties',
  'otherDeductions',
  'notes',
  'birthDate',
  'hireDate',
  'priorInsuranceMonths',
  'carriedLeaveDays',
];

const NUMERIC_FIELDS = new Set<keyof PayrollSheetImportRow>([
  'basicSalary', 'overtime', 'bonus', 'incentiveKpi', 'otherEarnings',
  'socialInsurance', 'incomeTax', 'advances', 'penalties', 'otherDeductions',
  'priorInsuranceMonths', 'carriedLeaveDays',
]);

const DATE_FIELDS = new Set<keyof PayrollSheetImportRow>(['birthDate', 'hireDate']);

/** Download an empty Excel template for the monthly payroll sheet. */
export function downloadPayrollSheetTemplate(language: 'ar' | 'en' = 'ar'): void {
  const headers = language === 'ar' ? HEADERS_AR : HEADERS_EN;
  const sampleRow =
    language === 'ar'
      ? ['EMP-001', 'أحمد محمد', 'الإدارة المالية', '', '52101001', 'رواتب وأجور إدارية', 8000, 500, 0, 1000, 0, 700, 300, 0, 0, 0, '', '', '', '', '']
      : ['EMP-001', 'Ahmed Mohamed', 'Finance', '', '52101001', 'Administrative Salaries', 8000, 500, 0, 1000, 0, 700, 300, 0, 0, 0, '', '', '', '', ''];

  const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
  ws['!cols'] = headers.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, language === 'ar' ? 'كشف الرواتب' : 'Payroll Sheet');
  XLSX.writeFile(wb, language === 'ar' ? 'قالب_كشف_الرواتب.xlsx' : 'payroll_sheet_template.xlsx');
}

/** Download an empty Excel template for the employee master. */
export function downloadEmployeesTemplate(language: 'ar' | 'en' = 'ar'): void {
  const headers =
    language === 'ar'
      ? ['كود الموظف', 'اسم الموظف', 'الإدارة', 'المسمى الوظيفي', 'كود حساب المصروف', 'اسم حساب المصروف', 'الراتب الأساسي', 'الحالة', 'تاريخ الميلاد', 'تاريخ التعيين', 'مدة التأمين السابقة (شهر)', 'رقم الهاتف', 'إشعارات واتساب', 'رصيد إجازات مرحّل (يوم)']
      : ['Employee Code', 'Employee Name', 'Department', 'Job Title', 'Expense Account Code', 'Expense Account Name', 'Basic Salary', 'Status', 'Birth Date', 'Hire Date', 'Prior Insurance (months)', 'Phone', 'WhatsApp Opt-in', 'Carried Leave Balance (days)'];
  const sampleRow =
    language === 'ar'
      ? ['EMP-001', 'أحمد محمد', 'الإدارة المالية', 'محاسب', '52101001', 'رواتب وأجور إدارية', 8000, 'active', '1990-01-15', '2020-03-01', 24, '+201234567890', 'yes', 5]
      : ['EMP-001', 'Ahmed Mohamed', 'Finance', 'Accountant', '52101001', 'Administrative Salaries', 8000, 'active', '1990-01-15', '2020-03-01', 24, '+201234567890', 'yes', 5];

  const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
  ws['!cols'] = headers.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, language === 'ar' ? 'الموظفون' : 'Employees');
  XLSX.writeFile(wb, language === 'ar' ? 'قالب_الموظفين.xlsx' : 'employees_template.xlsx');
}

function readSheet(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' }));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsArrayBuffer(file);
  });
}

/** Raw AOA read — used as positional fallback when Excel mangles attendance headers. */
function readSheetAoa(file: File): Promise<unknown[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsArrayBuffer(file);
  });
}

/** Parse an uploaded monthly payroll sheet. */
export async function parsePayrollSheetFile(file: File): Promise<PayrollSheetImportRow[]> {
  const rawRows = await readSheet(file);
  if (!rawRows.length) return [];

  const firstKey = Object.keys(rawRows[0])[0] ?? '';
  const headers = HEADERS_AR.includes(firstKey) ? HEADERS_AR : HEADERS_EN;

  const num = (v: unknown): number | undefined => {
    if (v == null || String(v).trim() === '') return undefined;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? undefined : n;
  };
  const txt = (v: unknown): string | undefined => {
    const s = String(v ?? '').trim();
    return s === '' ? undefined : s;
  };
  const dateStr = (v: unknown): string | undefined => {
    if (v == null || String(v).trim() === '') return undefined;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    return s || undefined;
  };

  return rawRows
    .filter((r) => String(r[headers[0]] ?? '').trim() !== '' || String(r[headers[1]] ?? '').trim() !== '')
    .map((r) => {
      const row = {} as PayrollSheetImportRow;
      FIELD_ORDER.forEach((field, i) => {
        const header = headers[i];
        const raw = r[header];
        if (NUMERIC_FIELDS.has(field)) {
          (row[field] as number | undefined) = num(raw);
        } else if (DATE_FIELDS.has(field)) {
          (row[field] as string | undefined) = dateStr(raw);
        } else if (field === 'employeeCode' || field === 'employeeName') {
          (row[field] as string) = String(raw ?? '').trim();
        } else {
          (row[field] as string | undefined) = txt(raw);
        }
      });
      return row;
    });
}

/** Parse an uploaded employee-master sheet. */
export async function parseEmployeesFile(file: File): Promise<Array<{
  employeeCode: string;
  name: string;
  department?: string;
  jobTitle?: string;
  defaultExpenseAccountCode?: string;
  defaultExpenseAccountName?: string;
  basicSalary?: number;
  status?: string;
  birthDate?: string;
  hireDate?: string;
  priorInsuranceMonths?: number;
  phoneE164?: string;
  whatsappOptIn?: boolean;
  carriedLeaveDays?: number;
}>> {
  const rawRows = await readSheet(file);
  if (!rawRows.length) return [];
  const arHeaders = ['كود الموظف', 'اسم الموظف', 'الإدارة', 'المسمى الوظيفي', 'كود حساب المصروف', 'اسم حساب المصروف', 'الراتب الأساسي', 'الحالة', 'تاريخ الميلاد', 'تاريخ التعيين', 'مدة التأمين السابقة (شهر)', 'رقم الهاتف', 'إشعارات واتساب', 'رصيد إجازات مرحّل (يوم)'];
  const enHeaders = ['Employee Code', 'Employee Name', 'Department', 'Job Title', 'Expense Account Code', 'Expense Account Name', 'Basic Salary', 'Status', 'Birth Date', 'Hire Date', 'Prior Insurance (months)', 'Phone', 'WhatsApp Opt-in', 'Carried Leave Balance (days)'];
  const firstKey = Object.keys(rawRows[0])[0] ?? '';
  const h = arHeaders.includes(firstKey) ? arHeaders : enHeaders;
  const txt = (v: unknown) => { const s = String(v ?? '').trim(); return s === '' ? undefined : s; };
  const num = (v: unknown) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isNaN(n) ? undefined : n; };
  const dateStr = (v: unknown): string | undefined => {
    if (v == null || String(v).trim() === '') return undefined;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    return s || undefined;
  };
  const bool = (v: unknown): boolean | undefined => {
    const s = String(v ?? '').trim().toLowerCase();
    if (s === '') return undefined;
    return ['yes', 'true', '1', 'y', 'نعم', 'موافق'].includes(s);
  };
  return rawRows
    .filter((r) => String(r[h[0]] ?? '').trim() !== '')
    .map((r) => ({
      employeeCode: String(r[h[0]] ?? '').trim(),
      name: String(r[h[1]] ?? '').trim(),
      department: txt(r[h[2]]),
      jobTitle: txt(r[h[3]]),
      defaultExpenseAccountCode: txt(r[h[4]]),
      defaultExpenseAccountName: txt(r[h[5]]),
      basicSalary: num(r[h[6]]),
      status: txt(r[h[7]]),
      birthDate: dateStr(r[h[8]]),
      hireDate: dateStr(r[h[9]]),
      priorInsuranceMonths: num(r[h[10]]),
      phoneE164: txt(r[h[11]]),
      whatsappOptIn: bool(r[h[12]]),
      carriedLeaveDays: num(r[h[13]]),
    }));
}

/** Export a payroll register (the lines of one run) to Excel. */
export function exportPayrollRegister(
  periodLabel: string,
  rows: Array<{
    employeeCode: string;
    employeeName: string;
    department: string | null;
    costCenterCode: string | null;
    grossSalary: number;
    socialInsurance: number;
    incomeTax: number;
    advances: number;
    penalties: number;
    otherDeductions: number;
    totalDeductions: number;
    netSalary: number;
  }>,
  language: 'ar' | 'en' = 'ar',
): void {
  const headers =
    language === 'ar'
      ? ['كود الموظف', 'اسم الموظف', 'الإدارة', 'مركز التكلفة', 'إجمالي الأجر', 'تأمينات', 'ضريبة', 'سلف', 'جزاءات', 'خصومات أخرى', 'إجمالي الخصومات', 'صافي المستحق']
      : ['Code', 'Name', 'Department', 'Cost Center', 'Gross', 'Insurance', 'Tax', 'Advances', 'Penalties', 'Other Ded.', 'Total Ded.', 'Net'];

  const data = rows.map((r) => [
    r.employeeCode,
    r.employeeName,
    r.department ?? '',
    r.costCenterCode ?? '',
    r.grossSalary,
    r.socialInsurance,
    r.incomeTax,
    r.advances,
    r.penalties,
    r.otherDeductions,
    r.totalDeductions,
    r.netSalary,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = headers.map(() => ({ wch: 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, language === 'ar' ? 'كشف الرواتب' : 'Payroll');
  const safe = periodLabel.replace(/\s+/g, '_');
  XLSX.writeFile(wb, language === 'ar' ? `كشف_رواتب_${safe}.xlsx` : `payroll_${safe}.xlsx`);
}

// ─── Attendance (fingerprint) import ─────────────────────────────────────────

export type AttendanceImportRow = {
  employeeCode: string;
  employeeName?: string;
  daysPresent?: number;
  daysAbsent?: number;
  daysPaidLeave?: number;
  /** Per-leave-type day breakdown: { leaveTypeCode: days }. */
  leaveBreakdown?: Record<string, number>;
  lateMinutes?: number;
  overtimeHours?: number;
  /** Disciplinary penalty days (أيام الجزاءات) — converted to money on the server. */
  directPenalties?: number;
};

/** Leave type descriptor needed to build / parse dynamic per-type columns. */
export type AttendanceLeaveTypeColumn = {
  code: string;
  nameAr: string;
  nameEn: string;
  paid: boolean;
};

const normalizeHeader = (s: string): string =>
  String(s ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/** Parse numbers from Excel incl. Arabic-Indic digits and thousand separators. */
export function parseAttendanceNumber(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (v instanceof Date) return undefined;
  let s = String(v).trim();
  if (!s) return undefined;
  // Arabic-Indic → Western
  s = s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  s = s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  s = s.replace(/[\s\u00A0]/g, '');
  // 1.234,56 (EU) → 1234.56 ; keep plain 1234.56
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeEmployeeCode(code: unknown): string {
  return String(code ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();
}

/** Leave types kept on employee master / leave balances — not on the monthly days sheet. */
const DAYS_SHEET_EXCLUDED_LEAVE_CODES = new Set(['maternity', 'hajj']);

function isDaysSheetLeaveType(lt: AttendanceLeaveTypeColumn): boolean {
  const code = String(lt.code ?? '').trim().toLowerCase();
  if (DAYS_SHEET_EXCLUDED_LEAVE_CODES.has(code)) return false;
  const ar = normalizeHeader(lt.nameAr);
  const en = normalizeHeader(lt.nameEn);
  if (ar.includes('وضع') || ar.includes('حج')) return false;
  if (en.includes('maternity') || en.includes('hajj') || en.includes('haj ')) return false;
  return true;
}

function daysSheetLeaveTypes(leaveTypes: AttendanceLeaveTypeColumn[]): AttendanceLeaveTypeColumn[] {
  return leaveTypes.filter((lt) => lt.paid && isDaysSheetLeaveType(lt));
}

/** Fixed columns on the days-sheet template/import (employee-master fields live elsewhere). */
const ATTENDANCE_BASE_AR = {
  employeeCode: 'كود الموظف',
  employeeName: 'اسم الموظف',
  daysPresent: 'أيام الحضور',
  daysAbsent: 'غياب بدون إذن',
  lateMinutes: 'دقائق التأخير',
  overtimeHours: 'ساعات الإضافي',
  directPenalties: 'أيام الجزاءات',
};
const ATTENDANCE_BASE_EN = {
  employeeCode: 'Employee Code',
  employeeName: 'Employee Name',
  daysPresent: 'Days Present',
  daysAbsent: 'Unauthorized Absence',
  lateMinutes: 'Late Minutes',
  overtimeHours: 'Overtime Hours',
  directPenalties: 'Penalty Days',
};

function attendanceRowsHaveMetrics(rows: AttendanceImportRow[]): boolean {
  return rows.some(
    (r) =>
      (r.daysPresent ?? 0) > 0
      || (r.daysAbsent ?? 0) > 0
      || (r.daysPaidLeave ?? 0) > 0
      || (r.lateMinutes ?? 0) > 0
      || (r.overtimeHours ?? 0) > 0
      || (r.directPenalties ?? 0) > 0
      || (r.leaveBreakdown && Object.keys(r.leaveBreakdown).length > 0),
  );
}

/**
 * Positional parse matching the current template column order:
 * code | name | present | absent | [leave types…] | late | penalties | OT
 */
function parseAttendanceAoa(
  aoa: unknown[][],
  leaveTypes: AttendanceLeaveTypeColumn[],
): AttendanceImportRow[] {
  if (aoa.length < 2) return [];
  const paidLeaves = daysSheetLeaveTypes(leaveTypes);
  const leaveCount = paidLeaves.length;
  // Detect whether row0 looks like headers (non-numeric first cell)
  const firstCell = String(aoa[0]?.[0] ?? '').trim();
  const hasHeader = firstCell !== '' && parseAttendanceNumber(aoa[0]?.[0]) === undefined;
  const dataStart = hasHeader ? 1 : 0;

  const rows: AttendanceImportRow[] = [];
  for (let i = dataStart; i < aoa.length; i++) {
    const cells = aoa[i] ?? [];
    const employeeCode = normalizeEmployeeCode(cells[0]);
    if (!employeeCode) continue;
    const leaveBreakdown: Record<string, number> = {};
    let paidLeaveSum = 0;
    for (let li = 0; li < leaveCount; li++) {
      const days = parseAttendanceNumber(cells[4 + li]) ?? 0;
      if (days > 0) {
        const code = paidLeaves[li]!.code;
        leaveBreakdown[code] = days;
        paidLeaveSum += days;
      }
    }
    const lateIdx = 4 + leaveCount;
    const penIdx = lateIdx + 1;
    const otIdx = lateIdx + 2;
    const row: AttendanceImportRow = {
      employeeCode,
      employeeName: String(cells[1] ?? '').trim() || undefined,
      daysPresent: parseAttendanceNumber(cells[2]),
      daysAbsent: parseAttendanceNumber(cells[3]),
      lateMinutes: parseAttendanceNumber(cells[lateIdx]),
      directPenalties: parseAttendanceNumber(cells[penIdx]),
      overtimeHours: parseAttendanceNumber(cells[otIdx]),
    };
    if (paidLeaveSum > 0) {
      row.leaveBreakdown = leaveBreakdown;
      row.daysPaidLeave = paidLeaveSum;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Download days-sheet template.
 * Pre-fills active employees (code + name). Only monthly attendance columns —
 * birth/hire/insurance/carried leave/notes/maternity/hajj come from employee master.
 */
export function downloadAttendanceTemplate(
  language: 'ar' | 'en' = 'ar',
  leaveTypes: AttendanceLeaveTypeColumn[] = [],
  employees: Array<{ employeeCode: string; employeeName: string }> = [],
): void {
  const base = language === 'ar' ? ATTENDANCE_BASE_AR : ATTENDANCE_BASE_EN;
  const paidLeaves = daysSheetLeaveTypes(leaveTypes);
  const leaveHeaders = paidLeaves.map((lt) => (language === 'ar' ? lt.nameAr : lt.nameEn));

  const headers = [
    base.employeeCode,
    base.employeeName,
    base.daysPresent,
    base.daysAbsent,
    ...leaveHeaders,
    base.lateMinutes,
    base.directPenalties,
    base.overtimeHours,
  ];

  const blankTail = [
    '',
    '',
    ...paidLeaves.map(() => ''),
    '',
    '',
    '',
  ];

  const activeRows = employees
    .filter((e) => String(e.employeeCode ?? '').trim())
    .slice()
    .sort((a, b) => String(a.employeeCode).localeCompare(String(b.employeeCode), undefined, { numeric: true }))
    .map((e) => [
      String(e.employeeCode).trim(),
      String(e.employeeName ?? '').trim(),
      ...blankTail,
    ]);

  const sampleLeaveCells = paidLeaves.map((_lt, i) => (i === 0 ? 1 : 0));
  const sampleRow =
    language === 'ar'
      ? ['EMP-001', 'أحمد محمد', 22, 1, ...sampleLeaveCells, 45, 0, 8]
      : ['EMP-001', 'Ahmed Mohamed', 22, 1, ...sampleLeaveCells, 45, 0, 8];

  const dataRows = activeRows.length > 0 ? activeRows : [sampleRow];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  ws['!cols'] = headers.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, language === 'ar' ? 'الأيام' : 'Days');
  XLSX.writeFile(wb, language === 'ar' ? 'قالب_كشف_الأيام.xlsx' : 'days_sheet_template.xlsx');
}

/**
 * Parse uploaded days-sheet Excel. Header-name driven, with positional fallback
 * when headers do not match (common after Excel/Google Sheets re-save).
 */
export async function parseAttendanceFile(
  file: File,
  leaveTypes: AttendanceLeaveTypeColumn[] = [],
): Promise<AttendanceImportRow[]> {
  const rawRows = await readSheet(file);
  if (!rawRows.length) return [];

  const baseLookup = new Map<string, keyof typeof ATTENDANCE_BASE_AR>();
  (Object.keys(ATTENDANCE_BASE_AR) as (keyof typeof ATTENDANCE_BASE_AR)[]).forEach((field) => {
    baseLookup.set(normalizeHeader(ATTENDANCE_BASE_AR[field]), field);
    baseLookup.set(normalizeHeader(ATTENDANCE_BASE_EN[field]), field);
  });
  // Aliases / legacy headers
  baseLookup.set(normalizeHeader('أيام الغياب (بدون أجر)'), 'daysAbsent');
  baseLookup.set(normalizeHeader('Days Absent (unpaid)'), 'daysAbsent');
  baseLookup.set(normalizeHeader('أيام الغياب'), 'daysAbsent');
  baseLookup.set(normalizeHeader('Overtime'), 'overtimeHours');
  baseLookup.set(normalizeHeader('OT Hours'), 'overtimeHours');
  baseLookup.set(normalizeHeader('إضافي'), 'overtimeHours');
  // Penalty days — current + legacy money-oriented headers
  baseLookup.set(normalizeHeader('أيام الجزاءات'), 'directPenalties');
  baseLookup.set(normalizeHeader('الجزاءات'), 'directPenalties');
  baseLookup.set(normalizeHeader('جزاءات'), 'directPenalties');
  baseLookup.set(normalizeHeader('Penalty Days'), 'directPenalties');
  baseLookup.set(normalizeHeader('Penalties'), 'directPenalties');
  baseLookup.set(normalizeHeader('Penalty'), 'directPenalties');
  baseLookup.set(normalizeHeader('Penalties Amount'), 'directPenalties');

  const LEGACY_PAID_AR = normalizeHeader('أيام إجازة مدفوعة');
  const LEGACY_PAID_EN = normalizeHeader('Paid Leave Days');
  const LEGACY_ABSENT_AR = normalizeHeader('أيام الغياب');

  const leaveLookup = new Map<string, string>();
  daysSheetLeaveTypes(leaveTypes).forEach((lt) => {
    leaveLookup.set(normalizeHeader(lt.nameAr), lt.code);
    leaveLookup.set(normalizeHeader(lt.nameEn), lt.code);
  });

  const txt = (v: unknown): string | undefined => {
    const s = String(v ?? '').trim();
    return s === '' ? undefined : s;
  };

  const NUMERIC_BASE = new Set<keyof typeof ATTENDANCE_BASE_AR>([
    'daysPresent', 'daysAbsent', 'lateMinutes', 'directPenalties', 'overtimeHours',
  ]);

  const rows = rawRows.map((r) => {
    const row: AttendanceImportRow = { employeeCode: '' };
    const breakdown: Record<string, number> = {};
    let paidLeaveSum = 0;
    let legacyPaid = 0;

    Object.keys(r).forEach((rawHeader) => {
      const key = normalizeHeader(rawHeader);
      const value = r[rawHeader];
      const baseField = baseLookup.get(key);
      if (baseField) {
        if (baseField === 'employeeCode') row.employeeCode = normalizeEmployeeCode(value);
        else if (NUMERIC_BASE.has(baseField)) (row[baseField] as number | undefined) = parseAttendanceNumber(value);
        else (row[baseField] as string | undefined) = txt(value);
        return;
      }
      if (key === LEGACY_ABSENT_AR && row.daysAbsent === undefined) {
        row.daysAbsent = parseAttendanceNumber(value);
        return;
      }
      if (key === LEGACY_PAID_AR || key === LEGACY_PAID_EN) {
        legacyPaid = parseAttendanceNumber(value) ?? 0;
        return;
      }
      const leaveCode = leaveLookup.get(key);
      if (leaveCode) {
        const days = parseAttendanceNumber(value) ?? 0;
        if (days > 0) {
          breakdown[leaveCode] = (breakdown[leaveCode] ?? 0) + days;
          paidLeaveSum += days;
        }
      }
    });

    if (Object.keys(breakdown).length > 0) {
      row.leaveBreakdown = breakdown;
      row.daysPaidLeave = paidLeaveSum;
    } else if (legacyPaid > 0) {
      row.daysPaidLeave = legacyPaid;
    }
    return row;
  }).filter((r) => r.employeeCode !== '');

  if (attendanceRowsHaveMetrics(rows)) return rows;

  // Headers likely mangled — fall back to template column positions.
  const aoa = await readSheetAoa(file);
  const positional = parseAttendanceAoa(aoa, leaveTypes);
  return attendanceRowsHaveMetrics(positional) || positional.length > rows.length ? positional : rows;
}
