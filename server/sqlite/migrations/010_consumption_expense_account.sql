-- Store user-selected expense account on consumption orders (for GL posting)
ALTER TABLE consumption_orders ADD COLUMN expense_account_code TEXT;
ALTER TABLE consumption_orders ADD COLUMN expense_account_name TEXT;
