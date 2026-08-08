/**
 * sampleData.ts
 * Browser-side sample Excel file generators for QA / module testing.
 *
 * - All files are generated in memory and downloaded as blobs.
 * - Nothing is written to the server or public/ folder.
 * - Exposed via Settings → بيانات تجريبية (admin only).
 */

import * as XLSX from 'xlsx';

// ─── Shared download helper ────────────────────────────────────────────────────
function downloadWorkbook(wb: XLSX.WorkBook, filename: string): void {
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function makeSheet(headers: string[], rows: unknown[][]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 4, 16) }));
  return ws;
}

// ─── Module definitions ────────────────────────────────────────────────────────

export type SampleFileSpec = {
  id: string;
  labelAr: string;
  labelEn: string;
  descAr: string;
  descEn: string;
  generate: () => void;
};

export type SampleModuleDef = {
  id: string;
  labelAr: string;
  labelEn: string;
  descAr: string;
  descEn: string;
  colorClass: string;
  files: SampleFileSpec[];
};

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 1: HR / Payroll  (الموارد البشرية)
// ═══════════════════════════════════════════════════════════════════════════════

const HR_EMPLOYEES = [
  { code: 'EMP-001', name: 'أحمد محمد علي',       dept: 'الإدارة المالية',   title: 'محاسب أول',         expCode: '52101001', expName: 'رواتب وأجور إدارية', basic: 12000, birth: '1985-03-15', hire: '2018-01-01', prior: 36,  phone: '+201012345678', wa: 'نعم', leave: 5  },
  { code: 'EMP-002', name: 'سارة عبدالله حسن',    dept: 'إدارة المشاريع',    title: 'مهندسة مشاريع',     expCode: '51102001', expName: 'عمالة مباشرة',       basic: 15000, birth: '1990-07-22', hire: '2020-06-01', prior: 0,   phone: '+201123456789', wa: 'نعم', leave: 3  },
  { code: 'EMP-003', name: 'محمود إبراهيم سعد',   dept: 'الموارد البشرية',   title: 'مدير موارد بشرية', expCode: '52101001', expName: 'رواتب وأجور إدارية', basic: 18000, birth: '1978-11-05', hire: '2015-03-15', prior: 60,  phone: '+201234567890', wa: 'نعم', leave: 8  },
  { code: 'EMP-004', name: 'نورهان خالد المنصور', dept: 'تقنية المعلومات',  title: 'مطورة برمجيات',     expCode: '52101001', expName: 'رواتب وأجور إدارية', basic: 16000, birth: '1993-02-28', hire: '2021-09-01', prior: 12,  phone: '+201345678901', wa: 'لا',  leave: 0  },
  { code: 'EMP-005', name: 'خالد عمر الرشيدي',   dept: 'الإدارة العليا',    title: 'مدير عام',           expCode: '52101001', expName: 'رواتب وأجور إدارية', basic: 35000, birth: '1975-05-10', hire: '2010-01-01', prior: 120, phone: '+201456789012', wa: 'نعم', leave: 12 },
  { code: 'EMP-006', name: 'فاطمة علي سليمان',   dept: 'هندسة التصميم',    title: 'مهندسة مدنية',      expCode: '51102001', expName: 'عمالة مباشرة',       basic: 13000, birth: '1988-09-14', hire: '2019-04-01', prior: 24,  phone: '+201567890123', wa: 'نعم', leave: 2  },
  { code: 'EMP-007', name: 'عمر أحمد الزيداني',  dept: 'المشتريات',         title: 'مسؤول مشتريات أول', expCode: '52101001', expName: 'رواتب وأجور إدارية', basic: 10000, birth: '1991-12-03', hire: '2022-01-01', prior: 0,   phone: '+201678901234', wa: 'لا',  leave: 0  },
  { code: 'EMP-008', name: 'ريم محمد الأحمدي',   dept: 'التنفيذ الميداني', title: 'مشرف موقع',         expCode: '51102001', expName: 'عمالة مباشرة',       basic: 11000, birth: '1987-06-20', hire: '2017-07-01', prior: 48,  phone: '+201789012345', wa: 'نعم', leave: 4  },
  { code: 'EMP-009', name: 'يوسف عبدالرحمن',     dept: 'المحاسبة',          title: 'محاسب تكاليف',      expCode: '52101001', expName: 'رواتب وأجور إدارية', basic: 9500,  birth: '1995-04-08', hire: '2023-02-01', prior: 0,   phone: '+201890123456', wa: 'لا',  leave: 0  },
  { code: 'EMP-010', name: 'منى سعد العمري',      dept: 'الإدارة المالية',   title: 'مراجع داخلي',       expCode: '52101001', expName: 'رواتب وأجور إدارية', basic: 14000, birth: '1983-08-25', hire: '2016-05-01', prior: 72,  phone: '+201901234567', wa: 'نعم', leave: 7  },
];

const HR_ATTENDANCE = [
  { code: 'EMP-001', present: 20, absent: 0, annual: 2, sick: 0, emergency: 0, late: 0,  ot: 8,  notes: 'تحت التدريب أثناء الإجازة' },
  { code: 'EMP-002', present: 22, absent: 0, annual: 0, sick: 0, emergency: 0, late: 30, ot: 16, notes: 'مشروع طارئ — إضافي معتمد' },
  { code: 'EMP-003', present: 21, absent: 0, annual: 0, sick: 1, emergency: 0, late: 0,  ot: 0,  notes: 'إجازة مرضية بشهادة طبية' },
  { code: 'EMP-004', present: 19, absent: 1, annual: 2, sick: 0, emergency: 0, late: 0,  ot: 4,  notes: 'يوم غياب بدون إذن' },
  { code: 'EMP-005', present: 22, absent: 0, annual: 0, sick: 0, emergency: 0, late: 0,  ot: 0,  notes: '' },
  { code: 'EMP-006', present: 20, absent: 0, annual: 0, sick: 1, emergency: 1, late: 15, ot: 0,  notes: 'إجازة طارئة وفاة قريب' },
  { code: 'EMP-007', present: 21, absent: 1, annual: 0, sick: 0, emergency: 0, late: 60, ot: 0,  notes: 'تأخيرات متكررة — إنذار أول' },
  { code: 'EMP-008', present: 22, absent: 0, annual: 0, sick: 0, emergency: 0, late: 0,  ot: 24, notes: 'إضافي موقع — معتمد مشرف المشروع' },
  { code: 'EMP-009', present: 22, absent: 0, annual: 0, sick: 0, emergency: 0, late: 20, ot: 0,  notes: 'تأخير بسبب المواصلات' },
  { code: 'EMP-010', present: 19, absent: 0, annual: 3, sick: 0, emergency: 0, late: 0,  ot: 0,  notes: 'إجازة سنوية مرحّلة' },
];

function calcSI(basic: number): number {
  return Math.round(Math.min(basic, 9400) * 0.11);
}
function calcTax(gross: number, si: number): number {
  const annual = (gross - si) * 12;
  let t = 0;
  if (annual > 400000)      t = 1500 + 3750 + 26000 + 29250 + (annual - 400000) * 0.25;
  else if (annual > 200000) t = 1500 + 3750 + 26000 + (annual - 200000) * 0.225;
  else if (annual > 70000)  t = 1500 + 3750 + (annual - 70000) * 0.20;
  else if (annual > 55000)  t = 1500 + (annual - 55000) * 0.15;
  else if (annual > 40000)  t = (annual - 40000) * 0.10;
  return Math.round(t / 12);
}

function generateHrEmployees(): void {
  const headers = ['كود الموظف','اسم الموظف','الإدارة','المسمى الوظيفي','كود حساب المصروف','اسم حساب المصروف','الراتب الأساسي','الحالة','تاريخ الميلاد','تاريخ التعيين','مدة التأمين السابقة (شهر)','رقم الهاتف','إشعارات واتساب','رصيد إجازات مرحّل (يوم)'];
  const rows = HR_EMPLOYEES.map(e => [e.code, e.name, e.dept, e.title, e.expCode, e.expName, e.basic, 'active', e.birth, e.hire, e.prior, e.phone, e.wa, e.leave]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, makeSheet(headers, rows), 'الموظفون');
  downloadWorkbook(wb, 'نموذج_موظفين_10.xlsx');
}

function generateHrAttendance(): void {
  const headers = ['كود الموظف','اسم الموظف','أيام الحضور','أيام الغياب (بدون أجر)','إجازة سنوية','إجازة مرضية','إجازة طارئة','دقائق التأخير','ساعات الإضافي','ملاحظات','تاريخ الميلاد','تاريخ التعيين','مدة التأمين السابقة (شهر)','رصيد إجازات مرحّل (يوم)'];
  const rows = HR_ATTENDANCE.map((a, i) => {
    const e = HR_EMPLOYEES[i];
    return [a.code, e.name, a.present, a.absent, a.annual, a.sick, a.emergency, a.late, a.ot, a.notes, e.birth, e.hire, e.prior, e.leave];
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, makeSheet(headers, rows), 'بصمة يونيو 2026');
  downloadWorkbook(wb, 'نموذج_بصمة_يونيو2026.xlsx');
}

function generateHrPayroll(): void {
  const headers = ['كود الموظف','اسم الموظف','الإدارة','كود مركز التكلفة','كود حساب المصروف','اسم حساب المصروف','الراتب الأساسي','إضافي','مكافآت','حافز KPI','استحقاقات أخرى','تأمينات اجتماعية','ضريبة كسب العمل','سلف','جزاءات','خصومات أخرى','ملاحظات','تاريخ الميلاد','تاريخ التعيين','مدة التأمين السابقة (شهر)','رصيد إجازات مرحّل (يوم)'];
  const rows = HR_EMPLOYEES.map((e, i) => {
    const a = HR_ATTENDANCE[i];
    const dailyRate = e.basic / 22;
    const ot = Math.round(a.ot * (dailyRate / 8) * 1.25);
    const absDeduct = Math.round(a.absent * dailyRate);
    const lateDeduct = a.late > 30 ? Math.round(0.5 * dailyRate) : 0;
    const si = calcSI(e.basic);
    const tax = calcTax(e.basic + ot, si);
    return [e.code, e.name, e.dept, '', e.expCode, e.expName, e.basic, ot, 0, 0, 0, si, tax, 0, lateDeduct, absDeduct, a.notes, e.birth, e.hire, e.prior, e.leave];
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, makeSheet(headers, rows), 'كشف رواتب يونيو 2026');
  downloadWorkbook(wb, 'نموذج_كشف_رواتب_يونيو2026.xlsx');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 2: Materials Tree  (الأصناف والمواد)
// ═══════════════════════════════════════════════════════════════════════════════

function generateMaterialsTree(): void {
  const headers = ['Group Code','Group Name','Category Code','Category Name','Unit'];
  const rows: unknown[][] = [
    // Group 01 — أعمال الخرسانة
    ['01','أعمال الخرسانة','','',''],
    ['01','أعمال الخرسانة','01-001','أسمنت بورتلاندي عادي 42.5','طن'],
    ['01','أعمال الخرسانة','01-002','رمل مغسول ناعم','م3'],
    ['01','أعمال الخرسانة','01-003','زلط مقاس 20mm','م3'],
    ['01','أعمال الخرسانة','01-004','حديد تسليح 10mm','طن'],
    ['01','أعمال الخرسانة','01-005','حديد تسليح 16mm','طن'],
    ['01','أعمال الخرسانة','01-006','حديد تسليح 25mm','طن'],
    // Group 02 — أعمال البناء
    ['02','أعمال البناء','','',''],
    ['02','أعمال البناء','02-001','طوب أحمر 25×12×6','ألف قطعة'],
    ['02','أعمال البناء','02-002','طوب أجوف 20×20×40','ألف قطعة'],
    ['02','أعمال البناء','02-003','بلوك خرساني عادي 20×20×40','ألف قطعة'],
    ['02','أعمال البناء','02-004','ملاط أسمنتي م25','م3'],
    // Group 03 — أعمال التشطيبات
    ['03','أعمال التشطيبات','','',''],
    ['03','أعمال التشطيبات','03-001','بلاط سيراميك أرضية 60×60','م2'],
    ['03','أعمال التشطيبات','03-002','بلاط جرانيت درج','م2'],
    ['03','أعمال التشطيبات','03-003','دهان بلاستيك داخلي وجهين','م2'],
    ['03','أعمال التشطيبات','03-004','دهان أكريليك خارجي','م2'],
    ['03','أعمال التشطيبات','03-005','جبس بورد 12.5mm','م2'],
    // Group 04 — أعمال الحديد والألمنيوم
    ['04','أعمال الحديد والألمنيوم','','',''],
    ['04','أعمال الحديد والألمنيوم','04-001','شباك ألمنيوم مزدوج 120×150','طقم'],
    ['04','أعمال الحديد والألمنيوم','04-002','باب حديد مطلي 90×210','طقم'],
    ['04','أعمال الحديد والألمنيوم','04-003','حديد مشغول بالقطعة','كجم'],
    // Group 05 — أعمال التمديدات الصحية
    ['05','أعمال التمديدات الصحية','','',''],
    ['05','أعمال التمديدات الصحية','05-001','أنبوب PPR ¾"','م.ط'],
    ['05','أعمال التمديدات الصحية','05-002','أنبوب PVC 4"','م.ط'],
    ['05','أعمال التمديدات الصحية','05-003','حوض صحي كامل','طقم'],
    // Group 06 — أعمال التمديدات الكهربائية
    ['06','أعمال التمديدات الكهربائية','','',''],
    ['06','أعمال التمديدات الكهربائية','06-001','كابل NYY 1.5mm²','م.ط'],
    ['06','أعمال التمديدات الكهربائية','06-002','كابل NYY 4mm²','م.ط'],
    ['06','أعمال التمديدات الكهربائية','06-003','لوحة توزيع كهربائية 20خط','طقم'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, makeSheet(headers, rows), 'Materials');
  downloadWorkbook(wb, 'نموذج_شجرة_الأصناف.xlsx');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 3: BOQ  (جدول الكميات)
// ═══════════════════════════════════════════════════════════════════════════════

function generateBoq(): void {
  const headers = ['كود الفصل','اسم الفصل','كود نوع العمل','كود القسم','اسم القسم','كود البند','وصف البند','الوحدة','الكمية','تكلفة المواد','تكلفة العمالة','تكلفة المعدات','نسبة المصاريف العمومية %','نسبة الربح %','تاريخ بدء العمل','مدة التنفيذ المتوقعة'];
  const rows: unknown[][] = [
    // Chapter 01 — أعمال الحفر
    ['01','أعمال الحفر والردم','01','01','الحفر اليدوي والآلي','1.1','حفر في جميع أنواع التربة بالآلات','م3',500,0,25,45,10,12,'2026-07-01',20],
    ['01','أعمال الحفر والردم','01','01','الحفر اليدوي والآلي','1.2','حفر خنادق عمق ≤ 2م','م3',200,0,30,35,10,12,'2026-07-05',15],
    ['01','أعمال الحفر والردم','01','02','الردم والدكة','1.3','ردم بالتراب المنتج من الحفر ودك بالآلات','م3',350,0,20,30,10,12,'2026-07-21',10],
    // Chapter 02 — أعمال الخرسانة
    ['02','أعمال الخرسانة','01','01','الأساسات','2.1','قواعد خرسانة مسلحة B300 دعامات منفصلة','م3',180,900,250,50,10,12,'2026-08-01',30],
    ['02','أعمال الخرسانة','01','01','الأساسات','2.2','حصيرة خرسانية B300 Raft','م3',95,900,280,60,10,12,'2026-08-10',25],
    ['02','أعمال الخرسانة','01','02','الأعمدة','2.3','أعمدة خرسانية مسلحة B350','م3',120,950,300,55,10,12,'2026-09-01',40],
    ['02','أعمال الخرسانة','01','03','الأسقف','2.4','بلاطة مصمتة بسماكة 18cm','م3',210,900,270,50,10,12,'2026-10-01',45],
    ['02','أعمال الخرسانة','01','03','الأسقف','2.5','كمرات خرسانية مسلحة B350','م3',85,950,310,60,10,12,'2026-10-15',30],
    // Chapter 03 — أعمال البناء
    ['03','أعمال البناء والحوائط','01','01','الحوائط الخارجية','3.1','بناء طوب أحمر سمك 25cm بالملاط م25','م2',850,120,110,0,10,12,'2026-11-01',35],
    ['03','أعمال البناء والحوائط','01','02','الحوائط الداخلية','3.2','بناء طوب أجوف سمك 12cm','م2',1200,80,90,0,10,12,'2026-11-15',30],
    // Chapter 04 — التشطيبات الداخلية
    ['04','أعمال التشطيبات الداخلية','01','01','الأرضيات','4.1','تركيب بلاط سيراميك 60×60 + بودرة لاصقة','م2',920,180,80,0,10,12,'2027-01-01',40],
    ['04','أعمال التشطيبات الداخلية','01','01','الأرضيات','4.2','تركيب رخام طبيعي درجات ومداخل','م2',220,650,120,0,10,12,'2027-01-20',20],
    ['04','أعمال التشطيبات الداخلية','01','02','الدهانات','4.3','دهان بلاستيك 3 وجوه + بلاستر حرارة','م2',2800,35,45,0,10,12,'2027-02-01',35],
    ['04','أعمال التشطيبات الداخلية','01','03','الأسقف المستعارة','4.4','جبس بورد 12.5mm على هيكل معدني','م2',650,120,95,0,10,12,'2027-02-15',25],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, makeSheet(headers, rows), 'BOQ');
  downloadWorkbook(wb, 'نموذج_BOQ_مبنى_اداري.xlsx');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 4: Fixed Assets  (الأصول الثابتة)
// ═══════════════════════════════════════════════════════════════════════════════

function generateFixedAssets(): void {
  const headers = ['اسم الأصل','مجموعة الأصول','تاريخ الاقتناء','قيمة الأصل','قيمة الخردة','العمر المفيد (سنوات)','نموذج الإهلاك','كود حساب الأصل','اسم حساب الأصل','كود حساب مجمع الإهلاك','اسم حساب مجمع الإهلاك','كود حساب مصروف الإهلاك','اسم حساب مصروف الإهلاك','كود مركز التكلفة','نوع مركز التكلفة','ملاحظات'];
  const rows: unknown[][] = [
    // معدات ثقيلة
    ['حفار هيدروليكي كاتربيلار 320',      'معدات ثقيلة',   '2022-01-15', 1850000, 185000, 10, 'straight_line', '11101001','معدات وآلات','11201001','مجمع إهلاك المعدات','53101001','إهلاك المعدات والآلات','','indirect','ترخيص رقم HE-2022-001'],
    ['لودر أمامي كيس 721F',                'معدات ثقيلة',   '2021-06-01', 950000,  95000,  8,  'straight_line', '11101001','معدات وآلات','11201001','مجمع إهلاك المعدات','53101001','إهلاك المعدات والآلات','','indirect',''],
    ['مضخة خرسانة Putzmeister M52',        'معدات ثقيلة',   '2023-03-20', 2200000, 220000, 12, 'straight_line', '11101001','معدات وآلات','11201001','مجمع إهلاك المعدات','53101001','إهلاك المعدات والآلات','','indirect',''],
    ['رافعة برجية Liebherr 280 EC-H',      'معدات ثقيلة',   '2023-09-01', 3500000, 350000, 15, 'straight_line', '11101001','معدات وآلات','11201001','مجمع إهلاك المعدات','53101001','إهلاك المعدات والآلات','','indirect','إيجار شهري للمشاريع'],
    // سيارات ومركبات
    ['سيارة تويوتا هايلوكس مزدوجة 2023',  'مركبات',        '2023-01-10', 380000,  38000,  5,  'straight_line', '11102001','مركبات','11202001','مجمع إهلاك المركبات','53102001','إهلاك المركبات','','indirect','لوحة رقم ABC-123'],
    ['ميكروباص إيسوزو 30 راكب',            'مركبات',        '2022-07-01', 520000,  52000,  7,  'straight_line', '11102001','مركبات','11202001','مجمع إهلاك المركبات','53102001','إهلاك المركبات','','indirect','نقل عمال المشاريع'],
    ['شاحنة مرسيدس أكتروس 3336',          'مركبات',        '2021-03-15', 1100000, 110000, 8,  'straight_line', '11102001','مركبات','11202001','مجمع إهلاك المركبات','53102001','إهلاك المركبات','','indirect',''],
    // معدات مكتبية وحاسبات
    ['خادم Dell PowerEdge R750',           'معدات تقنية',   '2024-01-01', 95000,   5000,   5,  'straight_line', '11103001','أجهزة وحاسبات','11203001','مجمع إهلاك أجهزة الحاسب','53103001','إهلاك الأجهزة والحاسبات','','indirect',''],
    ['أجهزة حاسب شخصي 10 وحدة',           'معدات تقنية',   '2023-08-01', 75000,   5000,   4,  'straight_line', '11103001','أجهزة وحاسبات','11203001','مجمع إهلاك أجهزة الحاسب','53103001','إهلاك الأجهزة والحاسبات','','indirect',''],
    // أثاث ومفروشات
    ['أثاث مكتبي — غرفة الاجتماعات',      'أثاث ومفروشات', '2022-04-01', 85000,   8500,   7,  'straight_line', '11104001','أثاث ومفروشات','11204001','مجمع إهلاك الأثاث','53104001','إهلاك الأثاث والمفروشات','','indirect',''],
    ['أثاث مكتبي — مكاتب الموظفين 15 مكتب','أثاث ومفروشات', '2021-09-01', 120000, 12000,  7,  'straight_line', '11104001','أثاث ومفروشات','11204001','مجمع إهلاك الأثاث','53104001','إهلاك الأثاث والمفروشات','','indirect',''],
    // منشآت وتحسينات
    ['تحسينات مقر الشركة المستأجر',       'تحسينات',       '2020-06-01', 450000,  0,      5,  'straight_line', '11105001','تحسينات الممتلكات المستأجرة','11205001','مجمع إهلاك التحسينات','53105001','إهلاك التحسينات','','indirect','مدة الإيجار 5 سنوات'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, makeSheet(headers, rows), 'الأصول الثابتة');
  downloadWorkbook(wb, 'نموذج_الأصول_الثابتة.xlsx');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 5: Suppliers  (الموردون)
// ═══════════════════════════════════════════════════════════════════════════════

function generateSuppliers(): void {
  const headers = ['اسم المورد','نوع المورد','رقم التسجيل الضريبي','رقم السجل التجاري','العنوان','رقم الهاتف','البريد الإلكتروني','شروط السداد (يوم)','ملاحظات'];
  const rows: unknown[][] = [
    ['شركة المصرية للمواد البنائية',   'مورد',           '100-234-567', '12345678', 'القاهرة — مدينة نصر',         '+20222345678', 'info@egyptian-bm.com',       30, 'مواد خرسانة وحديد'],
    ['مصنع الخليج للمواد العازلة',     'مورد',           '200-345-678', '23456789', 'الجيزة — أكتوبر',             '+20238456789', 'sales@gulf-insulation.com',  45, 'عوازل مائية وحرارية'],
    ['مؤسسة النيل للتشطيبات',          'مورد',           '300-456-789', '34567890', 'الإسكندرية — المنتزه',        '+20345678901', 'nile.finish@example.com',    30, 'دهانات وسيراميك وتشطيبات'],
    ['شركة الدلتا للحديد والصلب',      'مورد',           '400-567-890', '45678901', 'الدلتا — المنصورة',           '+20456789012', 'delta.steel@example.com',    60, 'حديد تسليح بجميع المقاسات'],
    ['شركة رشيد لمعدات البناء',        'مورد',           '500-678-901', '56789012', 'القاهرة — شبرا',              '+20567890123', 'rashid.equip@example.com',   30, 'تأجير وبيع معدات البناء'],
    ['مصنع الأهرام للخرسانة الجاهزة',  'مورد',           '600-789-012', '67890123', 'الجيزة — شيخ زايد',          '+20678901234', 'pyramids.concrete@mail.com', 14, 'خرسانة جاهزة ومونة'],
    ['مقاول عبدالرحيم للأعمال الكهربائية','مقاول باطن',  '700-890-123', '78901234', 'القاهرة — مصر الجديدة',       '+20789012345', 'abdo.elec@example.com',      30, 'أعمال كهربائية فقط'],
    ['مجموعة المشرق لأعمال التكييف',   'مقاول باطن',    '800-901-234', '89012345', 'القاهرة — العباسية',          '+20890123456', 'mashreq.hvac@example.com',   45, 'تكييف وتهوية'],
    ['شركة الوطنية للسباكة والصرف',    'مقاول باطن',    '900-012-345', '90123456', 'الجيزة — إمبابة',             '+20901234567', 'national.plumb@example.com', 30, 'أعمال صحية'],
    ['مؤسسة الأمانة للنقل والشحن',    'مورد',           '150-222-333', '11223344', 'القاهرة — المرج',             '+20150223344', 'amana.freight@example.com',  15, 'نقل ومناولة مواد'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, makeSheet(headers, rows), 'الموردون');
  downloadWorkbook(wb, 'نموذج_الموردون_والمقاولون.xlsx');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Public API — module registry
// ═══════════════════════════════════════════════════════════════════════════════

export const SAMPLE_MODULES: SampleModuleDef[] = [
  {
    id: 'hr',
    labelAr: 'الموارد البشرية والرواتب',
    labelEn: 'HR & Payroll',
    descAr: 'بيانات 10 موظفين من 6 إدارات مختلفة مع بصمة شهرية وكشف رواتب محسوب',
    descEn: '10 employees across 6 departments with monthly attendance and computed payroll',
    colorClass: 'text-blue-500',
    files: [
      {
        id: 'hr_employees',
        labelAr: 'بيانات الموظفين',
        labelEn: 'Employee Master',
        descAr: 'ملف استيراد سجلات 10 موظفين (أسماء، إدارات، رواتب، تواريخ، رصيد إجازات)',
        descEn: '10 employee records with departments, salaries, dates and leave balances',
        generate: generateHrEmployees,
      },
      {
        id: 'hr_attendance',
        labelAr: 'بصمة الحضور — يونيو 2026',
        labelEn: 'Attendance Sheet — June 2026',
        descAr: 'كشف بصمة شهري بسيناريوهات متنوعة (إجازات سنوية / مرضية / طارئة / تأخير / إضافي)',
        descEn: 'Monthly attendance with varied scenarios (annual, sick, emergency leave, late, overtime)',
        generate: generateHrAttendance,
      },
      {
        id: 'hr_payroll',
        labelAr: 'كشف الرواتب — يونيو 2026',
        labelEn: 'Payroll Sheet — June 2026',
        descAr: 'كشف رواتب جاهز للاستيراد مع تأمينات وضريبة وجزاءات محسوبة تلقائياً',
        descEn: 'Ready-to-import payroll with auto-computed insurance, tax and penalties',
        generate: generateHrPayroll,
      },
    ],
  },
  {
    id: 'materials',
    labelAr: 'شجرة الأصناف والمواد',
    labelEn: 'Materials Tree',
    descAr: '6 مجموعات رئيسية بـ 25 صنفاً مع الوحدة لاستخدامها في المخازن والصرف',
    descEn: '6 main groups with 25 categories and units for warehouse and consumption use',
    colorClass: 'text-emerald-500',
    files: [
      {
        id: 'materials_tree',
        labelAr: 'شجرة الأصناف',
        labelEn: 'Materials Tree',
        descAr: 'خرسانة / بناء / تشطيبات / حديد وألمنيوم / صحي / كهربائي',
        descEn: 'Concrete / masonry / finishes / metalwork / plumbing / electrical',
        generate: generateMaterialsTree,
      },
    ],
  },
  {
    id: 'boq',
    labelAr: 'جدول الكميات (BOQ)',
    labelEn: 'Bill of Quantities',
    descAr: 'مبنى إداري نموذجي — 4 فصول، 14 بنداً بأسعار تقديرية واقعية',
    descEn: 'Sample office building — 4 chapters, 14 items with realistic unit rates',
    colorClass: 'text-amber-500',
    files: [
      {
        id: 'boq_building',
        labelAr: 'BOQ — مبنى إداري',
        labelEn: 'BOQ — Office Building',
        descAr: 'حفر / خرسانة / بناء / تشطيبات — جاهز للاستيراد في موديول BOQ',
        descEn: 'Earthwork / concrete / masonry / finishes — ready to import in BOQ module',
        generate: generateBoq,
      },
    ],
  },
  {
    id: 'fixed_assets',
    labelAr: 'الأصول الثابتة',
    labelEn: 'Fixed Assets',
    descAr: '12 أصلاً في 5 مجموعات (معدات / مركبات / تقنية / أثاث / تحسينات) مع بيانات الإهلاك',
    descEn: '12 assets across 5 groups (equipment / vehicles / tech / furniture / improvements)',
    colorClass: 'text-violet-500',
    files: [
      {
        id: 'fixed_assets_register',
        labelAr: 'سجل الأصول الثابتة',
        labelEn: 'Fixed Asset Register',
        descAr: 'قيمة الاقتناء / العمر المفيد / حسابات الأصل ومجمع الإهلاك والمصروف',
        descEn: 'Acquisition value / useful life / asset, accumulated depr. and expense accounts',
        generate: generateFixedAssets,
      },
    ],
  },
  {
    id: 'suppliers',
    labelAr: 'الموردون والمقاولون',
    labelEn: 'Suppliers & Subcontractors',
    descAr: '10 موردين / مقاولي باطن من قطاعات مختلفة مع بيانات الاتصال والشروط التجارية',
    descEn: '10 suppliers/subcontractors across sectors with contact info and payment terms',
    colorClass: 'text-rose-500',
    files: [
      {
        id: 'suppliers_list',
        labelAr: 'قائمة الموردين والمقاولين',
        labelEn: 'Suppliers & Subcontractors List',
        descAr: 'للاستخدام كمرجع عند إضافة موردين يدوياً في موديول التكاليف الفعلية',
        descEn: 'Reference when adding suppliers manually in Actual Costs module',
        generate: generateSuppliers,
      },
    ],
  },
];
