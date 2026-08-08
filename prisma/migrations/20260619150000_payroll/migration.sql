-- HR / Payroll Module
-- Tables: payroll_employees, payroll_runs, payroll_run_lines

CREATE TABLE "payroll_employees" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employee_code" TEXT NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "department" TEXT,
    "job_title" TEXT,
    "default_cost_center_id" TEXT,
    "default_cost_center_type" TEXT,
    "default_expense_account_code" TEXT,
    "default_expense_account_name" TEXT,
    "basic_salary" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "hire_date" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_number" TEXT NOT NULL UNIQUE,
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_label" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "accrual_date" TEXT,
    "accrual_transaction_id" TEXT,
    "payment_date" TEXT,
    "payment_account_code" TEXT,
    "payment_account_name" TEXT,
    "payment_transaction_id" TEXT,
    "total_gross" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "total_net" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "payroll_run_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL REFERENCES "payroll_runs"("id") ON DELETE CASCADE,
    "employee_id" TEXT REFERENCES "payroll_employees"("id"),
    "employee_code" TEXT NOT NULL,
    "employee_name" TEXT NOT NULL,
    "department" TEXT,
    "cost_center_id" TEXT,
    "cost_center_type" TEXT,
    "cost_center_code" TEXT,
    "expense_account_code" TEXT NOT NULL,
    "expense_account_name" TEXT,
    "basic_salary" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "overtime" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "bonus" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "incentive_kpi" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "other_earnings" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "gross_salary" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "social_insurance" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "income_tax" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "advances" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "penalties" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "other_deductions" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "net_salary" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "payroll_employees_status_idx" ON "payroll_employees"("status");
CREATE INDEX "payroll_employees_department_idx" ON "payroll_employees"("department");
CREATE INDEX "payroll_runs_status_idx" ON "payroll_runs"("status");
CREATE INDEX "payroll_runs_period_year_period_month_idx" ON "payroll_runs"("period_year", "period_month");
CREATE INDEX "payroll_run_lines_run_id_idx" ON "payroll_run_lines"("run_id");
CREATE INDEX "payroll_run_lines_employee_id_idx" ON "payroll_run_lines"("employee_id");
CREATE INDEX "payroll_run_lines_cost_center_id_idx" ON "payroll_run_lines"("cost_center_id");

-- New chart-of-accounts leaves for payroll (idempotent — skip if code already exists)
INSERT INTO "chart_of_accounts"
    ("id", "account_code", "account_name", "account_name_en", "parent_code", "type", "is_group", "status", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), '12303',    'سلف العاملين',                'Employee Advances',          '123',    'asset',     true,  'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), '12303001', 'سلف العاملين',                'Employee Advances',          '12303',  'asset',     false, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), '21405',    'ضريبة كسب العمل (دائن)',      'Payroll Income Tax Payable', '214',    'liability', true,  'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), '21405001', 'ضريبة كسب العمل - دائن',      'Payroll Income Tax Payable', '21405',  'liability', false, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), '21501002', 'جزاءات وخصومات محتجزة',       'Withheld Penalties',         '21501',  'liability', false, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), '21501003', 'رواتب وأجور مستحقة الدفع',    'Salaries & Wages Payable',   '21501',  'liability', false, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("account_code") DO NOTHING;
