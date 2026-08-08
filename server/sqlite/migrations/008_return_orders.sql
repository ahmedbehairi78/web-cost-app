-- Migration 008: إذن إرجاع مواد من الموقع إلى مخزن المشروع

CREATE TABLE IF NOT EXISTS return_orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  return_number TEXT    NOT NULL UNIQUE,
  project_id    TEXT    NOT NULL REFERENCES projects(id),
  contract_id   TEXT    NOT NULL REFERENCES contracts(id),
  return_date   TEXT    NOT NULL,
  recorded_by   TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS return_order_lines (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  return_order_id           INTEGER NOT NULL REFERENCES return_orders(id) ON DELETE CASCADE,
  consumption_order_line_id INTEGER NOT NULL REFERENCES consumption_order_lines(id),
  material_category_id      INTEGER NOT NULL REFERENCES material_categories(id),
  boq_item_id               TEXT    NOT NULL,
  quantity                  REAL    NOT NULL CHECK (quantity > 0),
  unit_cost                 REAL    NOT NULL,
  total_cost                REAL    NOT NULL,
  reason                    TEXT
);

CREATE INDEX IF NOT EXISTS idx_return_orders_contract ON return_orders(contract_id);
CREATE INDEX IF NOT EXISTS idx_return_orders_project ON return_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_return_order_lines_col ON return_order_lines(consumption_order_line_id);
