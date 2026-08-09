-- Per-project IPC cover letterhead logos (override company_info defaults).
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "cover_logo_left" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "cover_logo_center" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "cover_logo_right" TEXT;
