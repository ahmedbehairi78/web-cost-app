PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS purchase_invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id TEXT NOT NULL,
  item_description TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
  total_cost REAL NOT NULL CHECK (total_cost >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_invoice_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_id INTEGER NOT NULL REFERENCES purchase_invoice_lines(id) ON DELETE CASCADE,
  contract_id TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
  total_cost REAL NOT NULL CHECK (total_cost >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contract_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id TEXT NOT NULL,
  item_description TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity_in REAL NOT NULL DEFAULT 0 CHECK (quantity_in >= 0),
  quantity_consumed REAL NOT NULL DEFAULT 0 CHECK (quantity_consumed >= 0),
  quantity_transferred_out REAL NOT NULL DEFAULT 0 CHECK (quantity_transferred_out >= 0),
  quantity_transferred_in REAL NOT NULL DEFAULT 0 CHECK (quantity_transferred_in >= 0),
  quantity_balance REAL GENERATED ALWAYS AS (
    quantity_in + quantity_transferred_in - quantity_consumed - quantity_transferred_out
  ) STORED,
  unit_cost REAL NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_consumption (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_item_id INTEGER NOT NULL REFERENCES contract_inventory(id) ON DELETE CASCADE,
  contract_id TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  consumption_date TEXT NOT NULL,
  boq_item_id TEXT,
  recorded_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_number TEXT NOT NULL UNIQUE,
  transfer_date TEXT NOT NULL,
  from_contract_id TEXT NOT NULL,
  to_contract_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'pending_b',
      'rejected_b',
      'pending_projects',
      'rejected_projects',
      'approved',
      'cancelled'
    )
  ),
  created_by TEXT NOT NULL,
  approved_by_b TEXT,
  approved_by_projects TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_transfer_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES inventory_transfers(id) ON DELETE CASCADE,
  inventory_item_id INTEGER NOT NULL REFERENCES contract_inventory(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
  total_cost REAL NOT NULL CHECK (total_cost >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subcontractors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  trade TEXT NOT NULL,
  contact_info TEXT,
  tax_number TEXT,
  commercial_register TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subcontract_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id TEXT NOT NULL,
  subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id),
  boq_item_id TEXT NOT NULL,
  subcontract_unit_price REAL NOT NULL CHECK (subcontract_unit_price >= 0),
  owner_unit_price REAL NOT NULL CHECK (owner_unit_price >= 0),
  assigned_quantity REAL NOT NULL CHECK (assigned_quantity > 0),
  assigned_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subcontract_extracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES subcontract_assignments(id) ON DELETE CASCADE,
  extract_number TEXT NOT NULL,
  extract_date TEXT NOT NULL,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  executed_quantity REAL NOT NULL CHECK (executed_quantity >= 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0),
  gross_amount REAL NOT NULL CHECK (gross_amount >= 0),
  performance_guarantee_rate REAL NOT NULL DEFAULT 10 CHECK (performance_guarantee_rate >= 0),
  performance_guarantee_amount REAL NOT NULL DEFAULT 0 CHECK (performance_guarantee_amount >= 0),
  advance_payment_deduction REAL NOT NULL DEFAULT 0 CHECK (advance_payment_deduction >= 0),
  delay_penalty REAL NOT NULL DEFAULT 0 CHECK (delay_penalty >= 0),
  net_payable REAL NOT NULL CHECK (net_payable >= 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'approved')),
  approved_by TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_allocations_line_contract
  ON purchase_invoice_allocations(line_id, contract_id);

CREATE INDEX IF NOT EXISTS idx_contract_inventory_contract
  ON contract_inventory(contract_id);

CREATE INDEX IF NOT EXISTS idx_inventory_consumption_contract
  ON inventory_consumption(contract_id);

CREATE INDEX IF NOT EXISTS idx_inventory_transfers_status
  ON inventory_transfers(status);

CREATE INDEX IF NOT EXISTS idx_subcontract_assignments_contract
  ON subcontract_assignments(contract_id);

CREATE TRIGGER IF NOT EXISTS trg_purchase_allocations_guard_insert
BEFORE INSERT ON purchase_invoice_allocations
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN (
      (SELECT COALESCE(SUM(quantity), 0) FROM purchase_invoice_allocations WHERE line_id = NEW.line_id) + NEW.quantity
    ) > (SELECT quantity FROM purchase_invoice_lines WHERE id = NEW.line_id)
    THEN RAISE(ABORT, 'Allocation quantity exceeds source line quantity')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_purchase_allocations_guard_update
BEFORE UPDATE ON purchase_invoice_allocations
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN (
      (SELECT COALESCE(SUM(quantity), 0) FROM purchase_invoice_allocations WHERE line_id = NEW.line_id AND id != NEW.id) + NEW.quantity
    ) > (SELECT quantity FROM purchase_invoice_lines WHERE id = NEW.line_id)
    THEN RAISE(ABORT, 'Allocation quantity exceeds source line quantity')
  END;
END;
