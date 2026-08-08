-- MOS certificates: one document header + lines (replaces per-line extract numbers in UI)

CREATE TABLE "mos_certificates" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "certificate_no" TEXT NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'periodic',
    "extract_date" TEXT,
    "delivery_note_ref" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "total_claimed" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "transaction_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mos_certificates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mos_certificate_lines" (
    "id" TEXT NOT NULL,
    "certificate_id" TEXT NOT NULL,
    "boq_item_id" TEXT NOT NULL,
    "supplied_qty_this_period" DECIMAL(18,3) NOT NULL,
    "supplied_qty_cumulative" DECIMAL(18,3) NOT NULL,
    "on_site_percentage" DECIMAL(18,3) NOT NULL,
    "equivalent_qty" DECIMAL(18,3) NOT NULL,
    "equivalent_cumulative" DECIMAL(18,3) NOT NULL,
    "unit_price" DECIMAL(18,3) NOT NULL,
    "claimed_amount" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "mos_certificate_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mos_certificates_contract_id_certificate_no_key" ON "mos_certificates"("contract_id", "certificate_no");
CREATE INDEX "mos_certificates_contract_id_status_idx" ON "mos_certificates"("contract_id", "status");
CREATE INDEX "mos_certificate_lines_certificate_id_idx" ON "mos_certificate_lines"("certificate_id");
CREATE INDEX "mos_certificate_lines_boq_item_id_idx" ON "mos_certificate_lines"("boq_item_id");

ALTER TABLE "mos_certificates" ADD CONSTRAINT "mos_certificates_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mos_certificates" ADD CONSTRAINT "mos_certificates_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mos_certificate_lines" ADD CONSTRAINT "mos_certificate_lines_certificate_id_fkey" FOREIGN KEY ("certificate_id") REFERENCES "mos_certificates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
