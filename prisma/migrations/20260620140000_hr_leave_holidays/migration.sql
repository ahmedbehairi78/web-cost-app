-- Attendance import: split paid leave from unpaid absence
ALTER TABLE "attendance_import_lines" ADD COLUMN "days_paid_leave" DECIMAL(18,3) NOT NULL DEFAULT 0;

-- ─── Leave types (configurable, seeded with Egyptian Labour Law defaults) ───────
CREATE TABLE "leave_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "affects_annual_balance" BOOLEAN NOT NULL DEFAULT false,
    "default_annual_days" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "leave_types_code_key" ON "leave_types"("code");

INSERT INTO "leave_types" ("id", "code", "name_ar", "name_en", "paid", "affects_annual_balance", "default_annual_days", "sort_order", "updated_at") VALUES
    (gen_random_uuid()::text, 'annual',    'إجازة سنوية',   'Annual leave',    true,  true,  21, 1, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'casual',    'إجازة عارضة',   'Casual leave',    true,  true,  7,  2, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'sick',      'إجازة مرضية',   'Sick leave',      true,  false, 0,  3, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'official',  'إجازة رسمية',   'Official holiday', true, false, 0,  4, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'maternity', 'إجازة وضع',     'Maternity leave', true,  false, 0,  5, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'hajj',      'إجازة حج',      'Hajj leave',      true,  false, 0,  6, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'unpaid',    'إجازة بدون أجر', 'Unpaid leave',   false, false, 0,  7, CURRENT_TIMESTAMP);

-- ─── Official holidays (Egypt — fixed Gregorian-date holidays for 2026) ─────────
CREATE TABLE "official_holidays" (
    "id" TEXT NOT NULL,
    "holiday_date" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "official_holidays_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "official_holidays_year_idx" ON "official_holidays"("year");

INSERT INTO "official_holidays" ("id", "holiday_date", "year", "name_ar", "name_en", "updated_at") VALUES
    (gen_random_uuid()::text, '2026-01-07', 2026, 'عيد الميلاد المجيد',         'Coptic Christmas',           CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '2026-01-25', 2026, 'عيد الشرطة وثورة 25 يناير',  'Police Day & 25 Jan Revolution', CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '2026-04-12', 2026, 'عيد القيامة المجيد',         'Coptic Easter',              CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '2026-04-13', 2026, 'شم النسيم',                  'Sham El-Nessim',             CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '2026-04-25', 2026, 'عيد تحرير سيناء',            'Sinai Liberation Day',       CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '2026-05-01', 2026, 'عيد العمال',                 'Labour Day',                 CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '2026-06-30', 2026, 'ثورة 30 يونيو',             'June 30 Revolution',         CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '2026-07-23', 2026, 'ثورة 23 يوليو',             'July 23 Revolution',         CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '2026-10-06', 2026, 'عيد القوات المسلحة',         'Armed Forces Day',           CURRENT_TIMESTAMP);

-- ─── Employee leave balances (per employee · leave type · year) ─────────────────
CREATE TABLE "employee_leave_balances" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "entitled_days" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "carried_days" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "used_days" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_leave_balances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_leave_balances_employee_id_leave_type_id_year_key" ON "employee_leave_balances"("employee_id", "leave_type_id", "year");
CREATE INDEX "employee_leave_balances_employee_id_idx" ON "employee_leave_balances"("employee_id");
CREATE INDEX "employee_leave_balances_year_idx" ON "employee_leave_balances"("year");

ALTER TABLE "employee_leave_balances" ADD CONSTRAINT "employee_leave_balances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "payroll_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_leave_balances" ADD CONSTRAINT "employee_leave_balances_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON UPDATE CASCADE;
