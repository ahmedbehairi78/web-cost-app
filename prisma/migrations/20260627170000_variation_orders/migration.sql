-- Variation orders (VO) — BOQ change documents per contract
CREATE TABLE "variation_orders" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "vo_number" TEXT NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "vo_date" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "total_value" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variation_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "variation_order_lines" (
    "id" TEXT NOT NULL,
    "variation_order_id" TEXT NOT NULL,
    "line_type" TEXT NOT NULL,
    "boq_item_id" TEXT,
    "created_boq_item_id" TEXT,
    "item_code" TEXT,
    "description" TEXT,
    "unit" TEXT,
    "chapter_code" TEXT,
    "chapter_name" TEXT,
    "work_type_code" TEXT,
    "section_code" TEXT,
    "section_name" TEXT,
    "tender_qty" DECIMAL(18,3),
    "unit_rate_total" DECIMAL(18,3),
    "new_tender_qty" DECIMAL(18,3),
    "new_unit_rate" DECIMAL(18,3),
    "line_amount" DECIMAL(18,3) NOT NULL DEFAULT 0,

    CONSTRAINT "variation_order_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "variation_orders_contract_id_vo_number_key" ON "variation_orders"("contract_id", "vo_number");
CREATE INDEX "variation_orders_contract_id_status_idx" ON "variation_orders"("contract_id", "status");
CREATE INDEX "variation_order_lines_variation_order_id_idx" ON "variation_order_lines"("variation_order_id");

ALTER TABLE "variation_orders" ADD CONSTRAINT "variation_orders_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variation_orders" ADD CONSTRAINT "variation_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variation_order_lines" ADD CONSTRAINT "variation_order_lines_variation_order_id_fkey" FOREIGN KEY ("variation_order_id") REFERENCES "variation_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "variation_order_lines" ADD CONSTRAINT "variation_order_lines_boq_item_id_fkey" FOREIGN KEY ("boq_item_id") REFERENCES "boq_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
