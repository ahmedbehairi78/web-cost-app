-- AlterTable
ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "payment_type" TEXT;
