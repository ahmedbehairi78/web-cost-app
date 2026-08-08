PRAGMA foreign_keys = OFF;

-- ═══════════════════════════════════════════════════════════════════════════════
-- شجرة الأصناف
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS material_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS material_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER NOT NULL REFERENCES material_groups(id),
  code        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  unit        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_material_categories_group ON material_categories(group_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ربط بنود BOQ بالأصناف
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS boq_item_materials (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  boq_item_id          TEXT    NOT NULL REFERENCES boq_items(id),
  material_category_id INTEGER NOT NULL REFERENCES material_categories(id),
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(boq_item_id, material_category_id)
);

CREATE INDEX IF NOT EXISTS idx_boq_item_materials_boq ON boq_item_materials(boq_item_id);
CREATE INDEX IF NOT EXISTS idx_boq_item_materials_cat ON boq_item_materials(material_category_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- فواتير المشتريات (رأس الفاتورة)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS purchase_invoices (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id      TEXT    NOT NULL UNIQUE,
  invoice_number  TEXT,
  invoice_date    TEXT    NOT NULL,
  supplier_name   TEXT,
  status          TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'posted')),
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_status ON purchase_invoices(status);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_date ON purchase_invoices(invoice_date);

-- ═══════════════════════════════════════════════════════════════════════════════
-- تعديل بنود فاتورة الشراء
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE purchase_invoice_lines ADD COLUMN material_category_id INTEGER REFERENCES material_categories(id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- مخزون العقد (إعادة بناء مع quantity_reserved و avg_unit_cost)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS contract_inventory_new (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id              TEXT    NOT NULL,
  material_category_id     INTEGER REFERENCES material_categories(id),
  item_description         TEXT,
  unit                     TEXT    NOT NULL,
  quantity_in              REAL    NOT NULL DEFAULT 0 CHECK (quantity_in >= 0),
  quantity_consumed        REAL    NOT NULL DEFAULT 0 CHECK (quantity_consumed >= 0),
  quantity_transferred_out REAL    NOT NULL DEFAULT 0 CHECK (quantity_transferred_out >= 0),
  quantity_transferred_in  REAL    NOT NULL DEFAULT 0 CHECK (quantity_transferred_in >= 0),
  quantity_reserved        REAL    NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  avg_unit_cost            REAL    NOT NULL DEFAULT 0 CHECK (avg_unit_cost >= 0),
  quantity_balance         REAL    GENERATED ALWAYS AS (
    quantity_in + quantity_transferred_in - quantity_consumed - quantity_transferred_out - quantity_reserved
  ) STORED,
  created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO contract_inventory_new (
  id, contract_id, material_category_id, item_description, unit,
  quantity_in, quantity_consumed, quantity_transferred_out, quantity_transferred_in,
  quantity_reserved, avg_unit_cost, created_at, updated_at
)
SELECT
  id, contract_id, NULL, item_description, unit,
  quantity_in, quantity_consumed, quantity_transferred_out, quantity_transferred_in,
  0, unit_cost, created_at, updated_at
FROM contract_inventory;

DROP TABLE contract_inventory;
ALTER TABLE contract_inventory_new RENAME TO contract_inventory;

CREATE INDEX IF NOT EXISTS idx_contract_inventory_contract ON contract_inventory(contract_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_inventory_contract_material
  ON contract_inventory(contract_id, material_category_id)
  WHERE material_category_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- أوامر الصرف
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS consumption_orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number  TEXT    NOT NULL UNIQUE,
  contract_id   TEXT    NOT NULL,
  order_date    TEXT    NOT NULL,
  recorded_by   TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_consumption_orders_contract ON consumption_orders(contract_id, status);

CREATE TABLE IF NOT EXISTS consumption_order_lines (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id             INTEGER NOT NULL REFERENCES consumption_orders(id) ON DELETE CASCADE,
  boq_item_id          TEXT    NOT NULL,
  material_category_id INTEGER NOT NULL REFERENCES material_categories(id),
  quantity             REAL    NOT NULL CHECK (quantity > 0),
  unit_cost            REAL    NOT NULL CHECK (unit_cost >= 0),
  total_cost           REAL    NOT NULL CHECK (total_cost >= 0),
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_consumption_order_lines_order ON consumption_order_lines(order_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- تحويلات المخزون — rejection_reason + material على البنود
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE inventory_transfers ADD COLUMN rejection_reason TEXT;

ALTER TABLE inventory_transfer_lines ADD COLUMN material_category_id INTEGER REFERENCES material_categories(id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- تسجيل تكلفة فعلية على BOQ (من الصرف المؤكد)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS boq_actual_costs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  boq_item_id          TEXT    NOT NULL,
  contract_id          TEXT    NOT NULL,
  material_category_id INTEGER,
  consumption_order_id INTEGER REFERENCES consumption_orders(id),
  quantity             REAL    NOT NULL,
  unit_cost            REAL    NOT NULL,
  total_cost           REAL    NOT NULL,
  cost_element         TEXT    NOT NULL DEFAULT 'materials',
  recorded_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_boq_actual_costs_boq ON boq_actual_costs(boq_item_id, contract_id);

PRAGMA foreign_keys = ON;
