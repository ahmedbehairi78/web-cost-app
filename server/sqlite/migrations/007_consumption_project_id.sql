-- consumption_orders: ربط بمخزن المشروع
ALTER TABLE consumption_orders ADD COLUMN project_id TEXT REFERENCES projects(id);

CREATE INDEX IF NOT EXISTS idx_consumption_orders_project ON consumption_orders(project_id);
