-- Migration 011: تحويلات مخزون المشروع (project_inventory)

CREATE TABLE IF NOT EXISTS project_inventory_transfers (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_number       TEXT    NOT NULL UNIQUE,
  transfer_date         TEXT    NOT NULL,
  from_project_id       TEXT    NOT NULL REFERENCES projects(id),
  to_project_id         TEXT    NOT NULL REFERENCES projects(id),
  status                TEXT    NOT NULL CHECK (
    status IN (
      'pending_b',
      'rejected_b',
      'pending_projects',
      'rejected_projects',
      'approved',
      'cancelled'
    )
  ),
  created_by            TEXT    NOT NULL,
  approved_by_b         TEXT,
  approved_by_projects  TEXT,
  rejection_reason      TEXT,
  notes                 TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pit_from_project ON project_inventory_transfers(from_project_id);
CREATE INDEX IF NOT EXISTS idx_pit_to_project ON project_inventory_transfers(to_project_id);
CREATE INDEX IF NOT EXISTS idx_pit_status ON project_inventory_transfers(status);

CREATE TABLE IF NOT EXISTS project_inventory_transfer_lines (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id           INTEGER NOT NULL REFERENCES project_inventory_transfers(id) ON DELETE CASCADE,
  project_inventory_id  INTEGER NOT NULL REFERENCES project_inventory(id),
  material_category_id  INTEGER NOT NULL REFERENCES material_categories(id),
  quantity              REAL    NOT NULL CHECK (quantity > 0),
  unit_cost             REAL    NOT NULL CHECK (unit_cost >= 0),
  total_cost            REAL    NOT NULL CHECK (total_cost >= 0),
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pitl_transfer ON project_inventory_transfer_lines(transfer_id);
