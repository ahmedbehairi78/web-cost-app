PRAGMA foreign_keys = ON;

-- ربط بنود فاتورة الشراء ببند BOQ (اختياري)
ALTER TABLE purchase_invoice_lines ADD COLUMN boq_item_id TEXT;

-- العقود المعينة للمستخدم (JSON array of contract IDs)
ALTER TABLE users ADD COLUMN assigned_contract_ids TEXT NOT NULL DEFAULT '[]';

-- فهرس للبحث السريع عن التحويلات حسب العقد
CREATE INDEX IF NOT EXISTS idx_inv_transfers_from ON inventory_transfers(from_contract_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_transfers_to   ON inventory_transfers(to_contract_id,   status);

-- فهرس لبنود التحويل حسب صنف المخزون
CREATE INDEX IF NOT EXISTS idx_inv_transfer_lines_item
  ON inventory_transfer_lines(inventory_item_id, transfer_id);
