-- Per closing period: which indirect cost centers participate in OHA allocation
ALTER TABLE "overhead_allocation_periods" ADD COLUMN "included_indirect_center_ids" JSONB;
