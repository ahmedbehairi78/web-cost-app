-- CreateTable
CREATE TABLE "custody_settlements" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "settlement_number" TEXT NOT NULL,
    "custody_account_code" TEXT NOT NULL,
    "custody_account_name" TEXT,
    "date" TEXT NOT NULL,
    "description" TEXT,
    "total_amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "transaction_ids" JSONB NOT NULL DEFAULT '[]',
    "created_by" TEXT,
    "approved_by" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custody_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custody_settlement_items" (
    "id" TEXT NOT NULL,
    "custody_settlement_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "custody_settlement_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custody_settlements_settlement_number_key" ON "custody_settlements"("settlement_number");

-- CreateIndex
CREATE INDEX "custody_settlements_project_id_is_deleted_idx" ON "custody_settlements"("project_id", "is_deleted");

-- CreateIndex
CREATE INDEX "custody_settlements_status_idx" ON "custody_settlements"("status");

-- AddForeignKey
ALTER TABLE "custody_settlements" ADD CONSTRAINT "custody_settlements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_settlement_items" ADD CONSTRAINT "custody_settlement_items_custody_settlement_id_fkey" FOREIGN KEY ("custody_settlement_id") REFERENCES "custody_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
