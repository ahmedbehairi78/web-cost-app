-- Percent of total payables to settle from bank cash (planning only)
ALTER TABLE "cash_budget_periods" ADD COLUMN IF NOT EXISTS "settlement_pct" DECIMAL(18,3) NOT NULL DEFAULT 100;
