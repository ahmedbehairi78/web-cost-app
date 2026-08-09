-- IPC cover deductions: performance security, syndicate stamp, back charge
ALTER TABLE "billing"
  ADD COLUMN IF NOT EXISTS "performance_security_amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "syndicate_stamp_amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "back_charge_amount" DECIMAL(18,3) NOT NULL DEFAULT 0;
