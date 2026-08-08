-- Link subcontractor IPC / custody settlement → boq_actual_costs (reports only; GL unchanged)
ALTER TABLE "boq_actual_costs"
  ADD COLUMN IF NOT EXISTS "purchase_transaction_id" TEXT,
  ADD COLUMN IF NOT EXISTS "custody_settlement_id" TEXT;

CREATE INDEX IF NOT EXISTS "boq_actual_costs_purchase_transaction_id_idx"
  ON "boq_actual_costs"("purchase_transaction_id");

CREATE INDEX IF NOT EXISTS "boq_actual_costs_custody_settlement_id_idx"
  ON "boq_actual_costs"("custody_settlement_id");
