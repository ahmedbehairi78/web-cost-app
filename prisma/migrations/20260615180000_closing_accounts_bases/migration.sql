-- Closing accounts: BOQ loading basis + link BOQ actuals to overhead periods
ALTER TABLE "overhead_allocation_periods"
  ADD COLUMN IF NOT EXISTS "boq_loading_basis" TEXT NOT NULL DEFAULT 'boq_value';

ALTER TABLE "boq_actual_costs"
  ADD COLUMN IF NOT EXISTS "overhead_period_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'boq_actual_costs_overhead_period_id_fkey'
  ) THEN
    ALTER TABLE "boq_actual_costs"
      ADD CONSTRAINT "boq_actual_costs_overhead_period_id_fkey"
      FOREIGN KEY ("overhead_period_id") REFERENCES "overhead_allocation_periods"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "boq_actual_costs_overhead_period_id_idx"
  ON "boq_actual_costs"("overhead_period_id");
