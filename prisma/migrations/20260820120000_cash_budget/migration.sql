-- Site-accountant custody floor on COA leaves (12102…)
ALTER TABLE "chart_of_accounts" ADD COLUMN IF NOT EXISTS "min_balance" DECIMAL(18,3) NOT NULL DEFAULT 0;

-- Cash budget periods (planning only — no GL)
CREATE TABLE IF NOT EXISTS "cash_budget_periods" (
    "id" TEXT NOT NULL,
    "period_number" TEXT NOT NULL,
    "period_type" TEXT NOT NULL,
    "period_start" TEXT NOT NULL,
    "period_end" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "opening_bank" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "opening_cash" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by" TEXT,
    "approved_by" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_budget_periods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cash_budget_periods_period_number_key" ON "cash_budget_periods"("period_number");
CREATE INDEX IF NOT EXISTS "cash_budget_periods_status_is_deleted_idx" ON "cash_budget_periods"("status", "is_deleted");
CREATE INDEX IF NOT EXISTS "cash_budget_periods_period_start_idx" ON "cash_budget_periods"("period_start");

CREATE TABLE IF NOT EXISTS "cash_budget_lines" (
    "id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "due_date" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "origin_type" TEXT,
    "origin_id" TEXT,
    "project_id" TEXT,
    "contract_id" TEXT,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_budget_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cash_budget_lines_period_id_is_deleted_idx" ON "cash_budget_lines"("period_id", "is_deleted");
CREATE INDEX IF NOT EXISTS "cash_budget_lines_origin_type_origin_id_idx" ON "cash_budget_lines"("origin_type", "origin_id");

DO $$ BEGIN
  ALTER TABLE "cash_budget_lines"
    ADD CONSTRAINT "cash_budget_lines_period_id_fkey"
    FOREIGN KEY ("period_id") REFERENCES "cash_budget_periods"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
