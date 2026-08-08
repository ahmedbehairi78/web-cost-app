-- Persist BOQ unit-rate cost breakdown (materials / labour / equipment + OH / profit %)
ALTER TABLE "boq_items" ADD COLUMN "rate_materials" DECIMAL(18,3) NOT NULL DEFAULT 0;
ALTER TABLE "boq_items" ADD COLUMN "rate_labour" DECIMAL(18,3) NOT NULL DEFAULT 0;
ALTER TABLE "boq_items" ADD COLUMN "rate_equipment" DECIMAL(18,3) NOT NULL DEFAULT 0;
ALTER TABLE "boq_items" ADD COLUMN "rate_direct" DECIMAL(18,3) NOT NULL DEFAULT 0;
ALTER TABLE "boq_items" ADD COLUMN "rate_overhead_pct" DECIMAL(8,2) NOT NULL DEFAULT 10;
ALTER TABLE "boq_items" ADD COLUMN "rate_profit_pct" DECIMAL(8,2) NOT NULL DEFAULT 12;
