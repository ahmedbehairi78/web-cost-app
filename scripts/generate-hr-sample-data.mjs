/**
 * generate-hr-sample-data.mjs
 * Generates three ready-to-import Excel sample files for the HR / Payroll module:
 *   1. employees_sample.xlsx      — 10 employees across 6 departments
 *   2. attendance_June2026.xlsx   — fingerprint/attendance summary for June 2026
 *   3. payroll_June2026.xlsx      — monthly payroll sheet for the same run
 *
 * Run: node scripts/generate-hr-sample-data.mjs
 * Output: public/hr-samples/  (created if it doesn't exist)
 */

import * as XLSX from '../node_modules/xlsx/xlsx.mjs';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'hr-samples');
mkdirSync(OUT_DIR, { recursive: true });

// ─── Employee master data ─────────────────────────────────────────────────────
const employees = [
  {
    code: 'EMP-001', name: 'أحمد محمد علي',       dept: 'الإدارة المالية',    title: 'محاسب أول',
    expCode: '52101001', expName: 'رواتب وأجور إدارية', basic: 12000, status: 'active',
    birth: '1985-03-15', hire: '2018-01-01', priorMonths: 36, phone: '+201012345678', whatsapp: 'نعم', carriedLeave: 5,
  },
  {
    code: 'EMP-002', name: 'سارة عبدالله حسن',    dept: 'إدارة المشاريع',     title: 'مهندسة مشاريع',
    expCode: '51102001', expName: 'عمالة مباشرة',            basic: 15000, status: 'active',
    birth: '1990-07-22', hire: '2020-06-01', priorMonths: 0,  phone: '+201123456789', whatsapp: 'نعم', carriedLeave: 3,
  },
  {
    code: 'EMP-003', name: 'محمود إبراهيم سعد',   dept: 'الموارد البشرية',    title: 'مدير موارد بشرية',
    expCode: '52101001', expName: 'رواتب وأجور إدارية', basic: 18000, status: 'active',
    birth: '1978-11-05', hire: '2015-03-15', priorMonths: 60, phone: '+201234567890', whatsapp: 'نعم', carriedLeave: 8,
  },
  {
    code: 'EMP-004', name: 'نورهان خالد المنصور', dept: 'تقنية المعلومات',   title: 'مطورة برمجيات',
    expCode: '52101001', expName: 'رواتب وأجور إدارية', basic: 16000, status: 'active',
    birth: '1993-02-28', hire: '2021-09-01', priorMonths: 12, phone: '+201345678901', whatsapp: 'لا',  carriedLeave: 0,
  },
  {
    code: 'EMP-005', name: 'خالد عمر الرشيدي',   dept: 'الإدارة العليا',     title: 'مدير عام',
    expCode: '52101001', expName: 'رواتب وأجور إدارية', basic: 35000, status: 'active',
    birth: '1975-05-10', hire: '2010-01-01', priorMonths: 120, phone: '+201456789012', whatsapp: 'نعم', carriedLeave: 12,
  },
  {
    code: 'EMP-006', name: 'فاطمة علي سليمان',   dept: 'هندسة التصميم',     title: 'مهندسة مدنية',
    expCode: '51102001', expName: 'عمالة مباشرة',            basic: 13000, status: 'active',
    birth: '1988-09-14', hire: '2019-04-01', priorMonths: 24, phone: '+201567890123', whatsapp: 'نعم', carriedLeave: 2,
  },
  {
    code: 'EMP-007', name: 'عمر أحمد الزيداني',  dept: 'المشتريات',          title: 'مسؤول مشتريات أول',
    expCode: '52101001', expName: 'رواتب وأجور إدارية', basic: 10000, status: 'active',
    birth: '1991-12-03', hire: '2022-01-01', priorMonths: 0,  phone: '+201678901234', whatsapp: 'لا',  carriedLeave: 0,
  },
  {
    code: 'EMP-008', name: 'ريم محمد الأحمدي',   dept: 'التنفيذ الميداني',  title: 'مشرف موقع',
    expCode: '51102001', expName: 'عمالة مباشرة',            basic: 11000, status: 'active',
    birth: '1987-06-20', hire: '2017-07-01', priorMonths: 48, phone: '+201789012345', whatsapp: 'نعم', carriedLeave: 4,
  },
  {
    code: 'EMP-009', name: 'يوسف عبدالرحمن',     dept: 'المحاسبة',           title: 'محاسب تكاليف',
    expCode: '52101001', expName: 'رواتب وأجور إدارية', basic: 9500,  status: 'active',
    birth: '1995-04-08', hire: '2023-02-01', priorMonths: 0,  phone: '+201890123456', whatsapp: 'لا',  carriedLeave: 0,
  },
  {
    code: 'EMP-010', name: 'منى سعد العمري',      dept: 'الإدارة المالية',    title: 'مراجع داخلي',
    expCode: '52101001', expName: 'رواتب وأجور إدارية', basic: 14000, status: 'active',
    birth: '1983-08-25', hire: '2016-05-01', priorMonths: 72, phone: '+201901234567', whatsapp: 'نعم', carriedLeave: 7,
  },
];

// ─── Attendance data — June 2026 (22 working days, Fri-Sat off) ───────────────
// paid leave columns: إجازة سنوية | إجازة مرضية | إجازة طارئة
const attendance = [
  { code: 'EMP-001', name: 'أحمد محمد علي',       present: 20, absent: 0, annual: 2, sick: 0, emergency: 0, late: 0,  ot: 8,  notes: 'تحت التدريب أثناء الإجازة' },
  { code: 'EMP-002', name: 'سارة عبدالله حسن',    present: 22, absent: 0, annual: 0, sick: 0, emergency: 0, late: 30, ot: 16, notes: 'مشروع طارئ — إضافي معتمد' },
  { code: 'EMP-003', name: 'محمود إبراهيم سعد',   present: 21, absent: 0, annual: 0, sick: 1, emergency: 0, late: 0,  ot: 0,  notes: 'إجازة مرضية بشهادة طبية' },
  { code: 'EMP-004', name: 'نورهان خالد المنصور', present: 19, absent: 1, annual: 2, sick: 0, emergency: 0, late: 0,  ot: 4,  notes: 'يوم غياب بدون إذن' },
  { code: 'EMP-005', name: 'خالد عمر الرشيدي',   present: 22, absent: 0, annual: 0, sick: 0, emergency: 0, late: 0,  ot: 0,  notes: '' },
  { code: 'EMP-006', name: 'فاطمة علي سليمان',   present: 20, absent: 0, annual: 0, sick: 1, emergency: 1, late: 15, ot: 0,  notes: 'إجازة طارئة وفاة قريب' },
  { code: 'EMP-007', name: 'عمر أحمد الزيداني',  present: 21, absent: 1, annual: 0, sick: 0, emergency: 0, late: 60, ot: 0,  notes: 'تأخيرات متكررة — إنذار أول' },
  { code: 'EMP-008', name: 'ريم محمد الأحمدي',   present: 22, absent: 0, annual: 0, sick: 0, emergency: 0, late: 0,  ot: 24, notes: 'إضافي موقع — معتمد مشرف المشروع' },
  { code: 'EMP-009', name: 'يوسف عبدالرحمن',     present: 22, absent: 0, annual: 0, sick: 0, emergency: 0, late: 20, ot: 0,  notes: 'تأخير بسبب المواصلات' },
  { code: 'EMP-010', name: 'منى سعد العمري',      present: 19, absent: 0, annual: 3, sick: 0, emergency: 0, late: 0,  ot: 0,  notes: 'إجازة سنوية مرحّلة' },
];

// ─── Payroll computation helpers ──────────────────────────────────────────────
const SI_RATE = 0.11;       // employee social insurance share
const SI_CAP  = 9400;       // insured salary ceiling (EGP)
const OT_DAILY_FACTOR = 1 / 22; // daily rate from monthly basic
const OT_HOURLY_MULT  = 1.25;   // 125% for normal overtime

function calcSI(basic) {
  return Math.round(Math.min(basic, SI_CAP) * SI_RATE);
}

/** Simplified annual income tax (Egypt 2024 brackets, monthly estimate). */
function calcMonthlyTax(grossMonthly, si) {
  const taxable = (grossMonthly - si) * 12; // rough annual
  let annual = 0;
  if (taxable > 400000)       annual = 1500 + 3750 + 26000 + 29250 + (taxable - 400000) * 0.25;
  else if (taxable > 200000)  annual = 1500 + 3750 + 26000 + (taxable - 200000) * 0.225;
  else if (taxable > 70000)   annual = 1500 + 3750 + (taxable - 70000) * 0.20;
  else if (taxable > 55000)   annual = 1500 + (taxable - 55000) * 0.15;
  else if (taxable > 40000)   annual = (taxable - 40000) * 0.10;
  return Math.round(annual / 12);
}

// ─── Build payroll rows ───────────────────────────────────────────────────────
const payrollRows = employees.map((emp, i) => {
  const att = attendance[i];
  const dailyRate = emp.basic * OT_DAILY_FACTOR;
  const hourlyRate = dailyRate / 8;
  const overtime   = Math.round(att.ot * hourlyRate * OT_HOURLY_MULT);
  // Absence deduction goes under "خصومات أخرى" (unpaid absence)
  const absDeduct  = Math.round(att.absent * dailyRate);
  // Late deduction: > 30 mins => half-day penalty
  const lateDeduct = att.late > 30 ? Math.round(0.5 * dailyRate) : 0;
  const penalties  = lateDeduct;
  const otherDed   = absDeduct;
  const si         = calcSI(emp.basic);
  const grossBeforeTax = emp.basic + overtime;
  const tax        = calcMonthlyTax(grossBeforeTax, si);
  return {
    code: emp.code, name: emp.name, dept: emp.dept, ccCode: '', expCode: emp.expCode, expName: emp.expName,
    basic: emp.basic, overtime, bonus: 0, incentiveKpi: 0, otherEarnings: 0,
    si, tax, advances: 0, penalties, otherDeductions: otherDed,
    notes: att.notes || '',
    birth: emp.birth, hire: emp.hire, priorMonths: emp.priorMonths, carriedLeave: emp.carriedLeave,
  };
});

// ─── 1. Employees sheet ───────────────────────────────────────────────────────
function buildEmployeesSheet() {
  const headers = [
    'كود الموظف', 'اسم الموظف', 'الإدارة', 'المسمى الوظيفي',
    'كود حساب المصروف', 'اسم حساب المصروف', 'الراتب الأساسي', 'الحالة',
    'تاريخ الميلاد', 'تاريخ التعيين', 'مدة التأمين السابقة (شهر)',
    'رقم الهاتف', 'إشعارات واتساب', 'رصيد إجازات مرحّل (يوم)',
  ];
  const rows = employees.map(e => [
    e.code, e.name, e.dept, e.title,
    e.expCode, e.expName, e.basic, e.status,
    e.birth, e.hire, e.priorMonths,
    e.phone, e.whatsapp, e.carriedLeave,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((h, i) => ({ wch: i === 1 ? 24 : i === 3 ? 22 : 18 }));
  // Style header row background (xlsx community edition — limited styling)
  return ws;
}

// ─── 2. Attendance sheet ─────────────────────────────────────────────────────
function buildAttendanceSheet() {
  const headers = [
    'كود الموظف', 'اسم الموظف',
    'أيام الحضور', 'أيام الغياب (بدون أجر)',
    'إجازة سنوية',  // paid leave col 1
    'إجازة مرضية', // paid leave col 2
    'إجازة طارئة', // paid leave col 3
    'دقائق التأخير', 'ساعات الإضافي', 'ملاحظات',
    'تاريخ الميلاد', 'تاريخ التعيين',
    'مدة التأمين السابقة (شهر)', 'رصيد إجازات مرحّل (يوم)',
  ];
  const rows = attendance.map((a, i) => {
    const emp = employees[i];
    return [
      a.code, a.name,
      a.present, a.absent,
      a.annual, a.sick, a.emergency,
      a.late, a.ot, a.notes,
      emp.birth, emp.hire, emp.priorMonths, emp.carriedLeave,
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((_, i) => ({ wch: i === 1 ? 24 : i === 9 ? 30 : 16 }));
  return ws;
}

// ─── 3. Payroll sheet ─────────────────────────────────────────────────────────
function buildPayrollSheet() {
  const headers = [
    'كود الموظف', 'اسم الموظف', 'الإدارة', 'كود مركز التكلفة',
    'كود حساب المصروف', 'اسم حساب المصروف',
    'الراتب الأساسي', 'إضافي', 'مكافآت', 'حافز KPI', 'استحقاقات أخرى',
    'تأمينات اجتماعية', 'ضريبة كسب العمل',
    'سلف', 'جزاءات', 'خصومات أخرى',
    'ملاحظات',
    'تاريخ الميلاد', 'تاريخ التعيين',
    'مدة التأمين السابقة (شهر)', 'رصيد إجازات مرحّل (يوم)',
  ];
  const rows = payrollRows.map(r => [
    r.code, r.name, r.dept, r.ccCode,
    r.expCode, r.expName,
    r.basic, r.overtime, r.bonus, r.incentiveKpi, r.otherEarnings,
    r.si, r.tax,
    r.advances, r.penalties, r.otherDeductions,
    r.notes,
    r.birth, r.hire, r.priorMonths, r.carriedLeave,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((_, i) => ({ wch: i === 1 ? 24 : i === 5 ? 26 : 16 }));
  return ws;
}

// ─── Write files ──────────────────────────────────────────────────────────────
function save(wb, filename) {
  const filePath = join(OUT_DIR, filename);
  // xlsx.mjs ESM does not have fs access — write via buffer
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  writeFileSync(filePath, buf);
  console.log(`  ✓  ${filename}`);
}

console.log('\nGenerating HR sample Excel files → public/hr-samples/\n');

// File 1 — Employees
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildEmployeesSheet(), 'الموظفون');
  save(wb, 'employees_sample.xlsx');
}

// File 2 — Attendance (June 2026)
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildAttendanceSheet(), 'بصمة يونيو 2026');
  save(wb, 'attendance_June2026.xlsx');
}

// File 3 — Payroll (June 2026)
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildPayrollSheet(), 'كشف رواتب يونيو 2026');
  save(wb, 'payroll_June2026.xlsx');
}

console.log('\nDone. Files saved to: public/hr-samples/\n');

// ─── Print a quick summary ────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════');
console.log('  الموظفون العشرة:');
employees.forEach((e, i) => {
  const p = payrollRows[i];
  const gross = p.basic + p.overtime + p.bonus;
  const totalDed = p.si + p.tax + p.advances + p.penalties + p.otherDeductions;
  const net = gross - totalDed;
  console.log(
    `  ${e.code}  ${e.name.padEnd(22)}  ${e.dept.padEnd(18)}`
    + `  أساسي: ${String(e.basic).padStart(6)}  صافي: ${String(net).padStart(6)}`
  );
});
console.log('═══════════════════════════════════════════════════════════\n');
