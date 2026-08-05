-- Warehouse receipts (unpriced qty) + consumption pending_cost

ALTER TABLE "project_inventory" ADD COLUMN IF NOT EXISTS "quantity_unpriced" DECIMAL(18,3) NOT NULL DEFAULT 0;

ALTER TABLE "consumption_orders" ADD COLUMN IF NOT EXISTS "requires_cost_approval" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "warehouse_receipts" (
    "id" TEXT NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "receipt_date" TEXT NOT NULL,
    "supplier_invoice_ref" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "supplier_account_code" TEXT,
    "supplier_account_name" TEXT,
    "transaction_id" TEXT,
    "purchase_transaction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_receipts_receipt_number_key" ON "warehouse_receipts"("receipt_number");
CREATE INDEX IF NOT EXISTS "warehouse_receipts_project_id_status_idx" ON "warehouse_receipts"("project_id", "status");
CREATE INDEX IF NOT EXISTS "warehouse_receipts_status_idx" ON "warehouse_receipts"("status");

CREATE TABLE IF NOT EXISTS "warehouse_receipt_lines" (
    "id" SERIAL NOT NULL,
    "receipt_id" TEXT NOT NULL,
    "material_category_id" INTEGER NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(18,3),
    "total_cost" DECIMAL(18,3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_receipt_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "warehouse_receipt_lines_receipt_id_idx" ON "warehouse_receipt_lines"("receipt_id");

DO $$ BEGIN
  ALTER TABLE "warehouse_receipts" ADD CONSTRAINT "warehouse_receipts_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "warehouse_receipt_lines" ADD CONSTRAINT "warehouse_receipt_lines_receipt_id_fkey"
    FOREIGN KEY ("receipt_id") REFERENCES "warehouse_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "warehouse_receipt_lines" ADD CONSTRAINT "warehouse_receipt_lines_material_category_id_fkey"
    FOREIGN KEY ("material_category_id") REFERENCES "material_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
