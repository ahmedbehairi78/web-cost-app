-- BOQ item scope: basic (primary contract) vs optional (may not be executed)
ALTER TABLE "boq_items" ADD COLUMN IF NOT EXISTS "scope_type" TEXT NOT NULL DEFAULT 'basic';
