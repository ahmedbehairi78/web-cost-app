-- Transfer metadata + InstaPay (IPN) fields on bank movements
ALTER TABLE "bank_movements" ADD COLUMN IF NOT EXISTS "transfer_scope" TEXT;
ALTER TABLE "bank_movements" ADD COLUMN IF NOT EXISTS "transfer_channel" TEXT;
ALTER TABLE "bank_movements" ADD COLUMN IF NOT EXISTS "transfer_direction" TEXT;
ALTER TABLE "bank_movements" ADD COLUMN IF NOT EXISTS "instapay_beneficiary" TEXT;
ALTER TABLE "bank_movements" ADD COLUMN IF NOT EXISTS "instapay_fee" DECIMAL(18,3);
