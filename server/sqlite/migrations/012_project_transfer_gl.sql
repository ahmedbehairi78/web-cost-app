-- Migration 012: ربط تحويل المشروع بقيد دفتر اليومية (SQLite)

ALTER TABLE project_inventory_transfers ADD COLUMN transaction_id TEXT REFERENCES transactions(id);

CREATE INDEX IF NOT EXISTS idx_pit_transaction ON project_inventory_transfers(transaction_id);
