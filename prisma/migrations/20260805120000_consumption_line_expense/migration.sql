-- Per-line expense account on consumption order lines (multi-material issues).
ALTER TABLE "consumption_order_lines"
  ADD COLUMN IF NOT EXISTS "expense_account_code" TEXT,
  ADD COLUMN IF NOT EXISTS "expense_account_name" TEXT;
