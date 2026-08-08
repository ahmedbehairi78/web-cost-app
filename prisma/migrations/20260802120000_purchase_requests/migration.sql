-- Purchase requests (requisitions) — no GL / inventory posting
CREATE TABLE IF NOT EXISTS "purchase_requests" (
    "id" TEXT NOT NULL,
    "request_number" TEXT NOT NULL,
    "material_mode" TEXT NOT NULL,
    "material_category_id" INTEGER,
    "material_code" TEXT,
    "material_name" TEXT,
    "unit" TEXT,
    "description" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "project_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "boq_item_id" TEXT,
    "boq_item_code" TEXT,
    "boq_description" TEXT,
    "needed_by_date" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requested_by_user_id" TEXT,
    "status_updated_at" TIMESTAMP(3),
    "status_updated_by_user_id" TEXT,
    "status_note" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_requests_request_number_key" ON "purchase_requests"("request_number");
CREATE INDEX IF NOT EXISTS "purchase_requests_status_is_deleted_idx" ON "purchase_requests"("status", "is_deleted");
CREATE INDEX IF NOT EXISTS "purchase_requests_project_id_is_deleted_idx" ON "purchase_requests"("project_id", "is_deleted");
CREATE INDEX IF NOT EXISTS "purchase_requests_needed_by_date_idx" ON "purchase_requests"("needed_by_date");
CREATE INDEX IF NOT EXISTS "purchase_requests_requested_at_idx" ON "purchase_requests"("requested_at");

DO $$ BEGIN
  ALTER TABLE "purchase_requests"
    ADD CONSTRAINT "purchase_requests_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
