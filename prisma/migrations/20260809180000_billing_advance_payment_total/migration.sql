-- Cover-JLL: Total Advance Payment (distinct from period recovery)
ALTER TABLE "billing" ADD COLUMN IF NOT EXISTS "advance_payment_total" DECIMAL(18,3) NOT NULL DEFAULT 0;
