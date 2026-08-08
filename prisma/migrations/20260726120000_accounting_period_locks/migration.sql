-- Accounting period locks (quarterly GL freeze + per-period allowed users)
CREATE TABLE "accounting_period_locks" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "period_start" TEXT NOT NULL,
    "period_end" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'locked',
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "allowed_user_ids" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_period_locks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_period_locks_period_start_period_end_key" ON "accounting_period_locks"("period_start", "period_end");

CREATE INDEX "accounting_period_locks_status_period_start_period_end_idx" ON "accounting_period_locks"("status", "period_start", "period_end");
