-- Migration 006: مخزن المشروع المركزي (project_inventory)
-- contract_inventory يبقى legacy — لا حذف

-- ═══════════════════════════════════════════════════════════════════════════════
-- purchase_invoices: ربط بالمشروع (nullable للفواتير القديمة)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE purchase_invoices ADD COLUMN project_id TEXT REFERENCES projects(id);

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_project ON purchase_invoices(project_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- مخزون المشروع المركزي per (project_id, material_category_id)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_inventory (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id           TEXT    NOT NULL REFERENCES projects(id),
  material_category_id INTEGER NOT NULL REFERENCES material_categories(id),
  item_description     TEXT,
  unit                 TEXT    NOT NULL,
  quantity_in          REAL    NOT NULL DEFAULT 0 CHECK (quantity_in >= 0),
  quantity_issued      REAL    NOT NULL DEFAULT 0 CHECK (quantity_issued >= 0),
  quantity_returned    REAL    NOT NULL DEFAULT 0 CHECK (quantity_returned >= 0),
  quantity_reserved    REAL    NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  avg_unit_cost        REAL    NOT NULL DEFAULT 0 CHECK (avg_unit_cost >= 0),
  quantity_balance     REAL    GENERATED ALWAYS AS (
    quantity_in + quantity_returned - quantity_issued - quantity_reserved
  ) STORED,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, material_category_id)
);

CREATE INDEX IF NOT EXISTS idx_project_inventory_project ON project_inventory(project_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- سجل حركات المخزن (audit) — اختياري للمراحل اللاحقة
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_inventory_movements (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id           TEXT    NOT NULL,
  material_category_id INTEGER NOT NULL,
  movement_type        TEXT    NOT NULL CHECK (movement_type IN ('receipt', 'issue', 'return', 'reserve', 'release')),
  quantity             REAL    NOT NULL CHECK (quantity > 0),
  unit_cost            REAL,
  reference_type       TEXT,
  reference_id         TEXT,
  notes                TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pim_project ON project_inventory_movements(project_id, material_category_id);
CREATE INDEX IF NOT EXISTS idx_pim_reference ON project_inventory_movements(reference_type, reference_id);
