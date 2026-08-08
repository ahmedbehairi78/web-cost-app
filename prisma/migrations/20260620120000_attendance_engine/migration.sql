-- Attendance rules (company-wide payroll attendance policy)
CREATE TABLE "attendance_rules" (
    "id" TEXT NOT NULL,
    "working_days_per_month" INTEGER NOT NULL DEFAULT 26,
    "daily_work_hours" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "overtime_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.25,
    "late_grace_mins" INTEGER NOT NULL DEFAULT 5,
    "late_tier1_mins" INTEGER NOT NULL DEFAULT 15,
    "late_tier2_mins" INTEGER NOT NULL DEFAULT 30,
    "late_tier3_mins" INTEGER NOT NULL DEFAULT 60,
    "late_above_tier3" TEXT NOT NULL DEFAULT 'full',
    "absence_deduction" TEXT NOT NULL DEFAULT 'daily_rate',
    "absence_fixed_amount" DECIMAL(18,3) DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_rules_pkey" PRIMARY KEY ("id")
);

INSERT INTO "attendance_rules" (
    "id",
    "working_days_per_month",
    "daily_work_hours",
    "overtime_multiplier",
    "late_grace_mins",
    "late_tier1_mins",
    "late_tier2_mins",
    "late_tier3_mins",
    "late_above_tier3",
    "absence_deduction",
    "absence_fixed_amount",
    "updated_at"
) VALUES (
    gen_random_uuid()::text,
    26,
    8,
    1.25,
    5,
    15,
    30,
    60,
    'full',
    'daily_rate',
    0,
    CURRENT_TIMESTAMP
);

-- Attendance import batches
CREATE TABLE "attendance_imports" (
    "id" TEXT NOT NULL,
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "imported_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_imports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendance_imports_period_year_period_month_idx" ON "attendance_imports"("period_year", "period_month");

-- Attendance import lines (monthly summary per employee)
CREATE TABLE "attendance_import_lines" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "employee_code" TEXT NOT NULL,
    "employee_name" TEXT,
    "days_present" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "days_absent" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "late_minutes" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "overtime_hours" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "attendance_import_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendance_import_lines_import_id_idx" ON "attendance_import_lines"("import_id");
CREATE INDEX "attendance_import_lines_employee_code_idx" ON "attendance_import_lines"("employee_code");

ALTER TABLE "attendance_import_lines" ADD CONSTRAINT "attendance_import_lines_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "attendance_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
