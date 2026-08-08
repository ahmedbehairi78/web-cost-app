-- Per-employee default cost-center split
CREATE TABLE "employee_cost_center_allocations" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "cost_center_id" TEXT NOT NULL,
    "cost_center_type" TEXT,
    "expense_account_code" TEXT,
    "expense_account_name" TEXT,
    "percentage" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_cost_center_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "employee_cost_center_allocations_employee_id_idx" ON "employee_cost_center_allocations"("employee_id");

ALTER TABLE "employee_cost_center_allocations" ADD CONSTRAINT "employee_cost_center_allocations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "payroll_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Monthly per-run-line cost-center split
CREATE TABLE "payroll_run_line_allocations" (
    "id" TEXT NOT NULL,
    "run_line_id" TEXT NOT NULL,
    "cost_center_id" TEXT NOT NULL,
    "cost_center_type" TEXT,
    "expense_account_code" TEXT NOT NULL,
    "expense_account_name" TEXT,
    "percentage" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_run_line_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payroll_run_line_allocations_run_line_id_idx" ON "payroll_run_line_allocations"("run_line_id");

ALTER TABLE "payroll_run_line_allocations" ADD CONSTRAINT "payroll_run_line_allocations_run_line_id_fkey" FOREIGN KEY ("run_line_id") REFERENCES "payroll_run_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
