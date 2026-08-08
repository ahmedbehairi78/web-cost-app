-- Add direct penalties input column to attendance imports
ALTER TABLE "attendance_import_lines"
ADD COLUMN "direct_penalties" DECIMAL(18,3) NOT NULL DEFAULT 0;

