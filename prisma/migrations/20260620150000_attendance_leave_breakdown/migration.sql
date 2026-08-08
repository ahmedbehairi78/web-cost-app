-- Per-leave-type breakdown on each attendance line (map of leaveTypeCode -> days)
ALTER TABLE "attendance_import_lines" ADD COLUMN "leave_breakdown" JSONB;
