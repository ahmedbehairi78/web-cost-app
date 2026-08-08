-- Fiscal period closing (P&L → retained earnings → BS approve → opening journal)
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "journal_kind" TEXT;

CREATE INDEX IF NOT EXISTS "transactions_journal_kind_is_deleted_idx"
  ON "transactions"("journal_kind", "is_deleted");

CREATE TABLE IF NOT EXISTS "fiscal_period_closings" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "period_start" TEXT NOT NULL,
    "period_end" TEXT NOT NULL,
    "opening_date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "net_profit" DECIMAL(18,2),
    "balance_gap" DECIMAL(18,2),
    "pl_close_transaction_id" TEXT,
    "opening_transaction_id" TEXT,
    "period_lock_id" TEXT,
    "pl_closed_at" TIMESTAMP(3),
    "pl_closed_by" TEXT,
    "bs_approved_at" TIMESTAMP(3),
    "bs_approved_by" TEXT,
    "opening_posted_at" TIMESTAMP(3),
    "opening_posted_by" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_period_closings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_period_closings_period_start_period_end_key"
  ON "fiscal_period_closings"("period_start", "period_end");

CREATE INDEX IF NOT EXISTS "fiscal_period_closings_status_period_end_idx"
  ON "fiscal_period_closings"("status", "period_end");

DO $$ BEGIN
  ALTER TABLE "fiscal_period_closings"
    ADD CONSTRAINT "fiscal_period_closings_pl_close_transaction_id_fkey"
    FOREIGN KEY ("pl_close_transaction_id") REFERENCES "transactions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "fiscal_period_closings"
    ADD CONSTRAINT "fiscal_period_closings_opening_transaction_id_fkey"
    FOREIGN KEY ("opening_transaction_id") REFERENCES "transactions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
