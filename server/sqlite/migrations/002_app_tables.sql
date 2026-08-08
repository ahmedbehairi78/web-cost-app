PRAGMA foreign_keys = ON;

-- Session store
CREATE TABLE IF NOT EXISTS sessions (
  sid        TEXT    PRIMARY KEY,
  sess       TEXT    NOT NULL,
  expired_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired_at);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id            TEXT    PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE,
  display_name  TEXT,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'user',
  permissions   TEXT    NOT NULL DEFAULT '{}',
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id              TEXT    PRIMARY KEY,
  project_code    TEXT    NOT NULL UNIQUE,
  project_name    TEXT    NOT NULL,
  project_name_en TEXT,
  client_name     TEXT    NOT NULL,
  client_name_en  TEXT,
  status          TEXT    NOT NULL DEFAULT 'active',
  boq_value       REAL    NOT NULL DEFAULT 0,
  vo_value        REAL    NOT NULL DEFAULT 0,
  budget          REAL    NOT NULL DEFAULT 0,
  is_deleted      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_deleted ON projects(is_deleted, project_code);

-- Contracts
CREATE TABLE IF NOT EXISTS contracts (
  id               TEXT    PRIMARY KEY,
  project_id       TEXT    NOT NULL REFERENCES projects(id),
  contract_name    TEXT    NOT NULL,
  contract_name_en TEXT,
  contract_number  TEXT    NOT NULL,
  contract_value   REAL    NOT NULL DEFAULT 0,
  start_date       TEXT,
  end_date         TEXT,
  is_deleted       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id, is_deleted);

-- BOQ Items
CREATE TABLE IF NOT EXISTS boq_items (
  id                TEXT    PRIMARY KEY,
  project_id        TEXT    NOT NULL REFERENCES projects(id),
  contract_id       TEXT    REFERENCES contracts(id),
  chapter_code      TEXT,
  chapter_name      TEXT,
  work_type_code    TEXT,
  section_code      TEXT,
  section_name      TEXT,
  item_code         TEXT    NOT NULL,
  description       TEXT    NOT NULL,
  unit              TEXT    NOT NULL,
  tender_qty        REAL    NOT NULL DEFAULT 0,
  unit_rate_total   REAL    NOT NULL DEFAULT 0,
  tender_amount     REAL    NOT NULL DEFAULT 0,
  expected_duration INTEGER,
  start_date        TEXT,
  is_deleted        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_boq_project ON boq_items(project_id, contract_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_boq_code    ON boq_items(item_code);

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  name_en    TEXT,
  type       TEXT    NOT NULL,
  tax_number TEXT,
  phone      TEXT,
  address    TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_suppliers_type ON suppliers(type, is_deleted);

-- Chart of Accounts
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id              TEXT    PRIMARY KEY,
  account_code    TEXT    NOT NULL UNIQUE,
  account_name    TEXT    NOT NULL,
  account_name_en TEXT,
  parent_code     TEXT    NOT NULL DEFAULT '',
  type            TEXT    NOT NULL,
  is_group        INTEGER NOT NULL DEFAULT 0,
  statement_type  TEXT,
  status          TEXT    NOT NULL DEFAULT 'active',
  supplier_id     TEXT    REFERENCES suppliers(id),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_coa_parent ON chart_of_accounts(parent_code);
CREATE INDEX IF NOT EXISTS idx_coa_group  ON chart_of_accounts(is_group, status);

-- GL Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id             TEXT    PRIMARY KEY,
  date           TEXT    NOT NULL,
  description    TEXT    NOT NULL,
  reference      TEXT,
  project_id     TEXT    REFERENCES projects(id),
  cost_center_id TEXT    REFERENCES contracts(id),
  created_by     TEXT,
  is_deleted     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transactions_date    ON transactions(is_deleted, date);
CREATE INDEX IF NOT EXISTS idx_transactions_project ON transactions(project_id);

-- Journal Entries
CREATE TABLE IF NOT EXISTS journal_entries (
  id             TEXT    PRIMARY KEY,
  transaction_id TEXT    NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  line_no        INTEGER NOT NULL,
  account_code   TEXT    NOT NULL,
  account_name   TEXT,
  debit          REAL    NOT NULL DEFAULT 0,
  credit         REAL    NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_je_account     ON journal_entries(account_code);
CREATE INDEX IF NOT EXISTS idx_je_transaction ON journal_entries(transaction_id);

-- Billing (IPC)
CREATE TABLE IF NOT EXISTS billing (
  id                       TEXT    PRIMARY KEY,
  project_id               TEXT    NOT NULL REFERENCES projects(id),
  contract_id              TEXT    NOT NULL REFERENCES contracts(id),
  billing_number           TEXT    NOT NULL,
  date                     TEXT    NOT NULL,
  works_value_ex_vat       REAL    NOT NULL DEFAULT 0,
  vat_amount               REAL    NOT NULL DEFAULT 0,
  exec_guarantee_amount    REAL    NOT NULL DEFAULT 0,
  wht_amount               REAL    NOT NULL DEFAULT 0,
  labour_insurance_amount  REAL    NOT NULL DEFAULT 0,
  manpower_levy_amount     REAL    NOT NULL DEFAULT 0,
  advance_payment_recovery REAL    NOT NULL DEFAULT 0,
  net_payable              REAL    NOT NULL DEFAULT 0,
  status                   TEXT    NOT NULL DEFAULT 'draft',
  transaction_id           TEXT    REFERENCES transactions(id),
  is_deleted               INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_billing_contract ON billing(contract_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_billing_status   ON billing(status);

-- Billing Items
CREATE TABLE IF NOT EXISTS billing_items (
  id           TEXT PRIMARY KEY,
  billing_id   TEXT NOT NULL REFERENCES billing(id) ON DELETE CASCADE,
  boq_item_id  TEXT,
  item_code    TEXT NOT NULL,
  description  TEXT NOT NULL,
  unit         TEXT NOT NULL,
  rate         REAL NOT NULL DEFAULT 0,
  previous_qty REAL NOT NULL DEFAULT 0,
  current_qty  REAL NOT NULL DEFAULT 0,
  total_qty    REAL NOT NULL DEFAULT 0,
  amount       REAL NOT NULL DEFAULT 0,
  metadata     TEXT
);
CREATE INDEX IF NOT EXISTS idx_billing_items_billing ON billing_items(billing_id);

-- Purchase Transactions
CREATE TABLE IF NOT EXISTS purchase_transactions (
  id                       TEXT    PRIMARY KEY,
  type                     TEXT    NOT NULL,
  supplier_id              TEXT    REFERENCES suppliers(id),
  supplier_account_id      TEXT,
  supplier_name            TEXT    NOT NULL,
  project_id               TEXT    REFERENCES projects(id),
  contract_id              TEXT    REFERENCES contracts(id),
  expense_account_id       TEXT,
  expense_account_name     TEXT,
  date                     TEXT    NOT NULL,
  reference_number         TEXT,
  amount                   REAL    NOT NULL DEFAULT 0,
  vat_amount               REAL    NOT NULL DEFAULT 0,
  wht_amount               REAL    NOT NULL DEFAULT 0,
  exec_guarantee_amount    REAL    NOT NULL DEFAULT 0,
  labour_insurance_amount  REAL    NOT NULL DEFAULT 0,
  manpower_levy_amount     REAL    NOT NULL DEFAULT 0,
  advance_payment_recovery REAL    NOT NULL DEFAULT 0,
  total_amount             REAL    NOT NULL DEFAULT 0,
  description              TEXT,
  status                   TEXT    NOT NULL DEFAULT 'pending',
  transaction_id           TEXT    REFERENCES transactions(id),
  is_deleted               INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pt_type     ON purchase_transactions(type, is_deleted);
CREATE INDEX IF NOT EXISTS idx_pt_contract ON purchase_transactions(contract_id);

-- Purchase Transaction Items
CREATE TABLE IF NOT EXISTS purchase_transaction_items (
  id                      TEXT NOT NULL PRIMARY KEY,
  purchase_transaction_id TEXT NOT NULL REFERENCES purchase_transactions(id) ON DELETE CASCADE,
  payload                 TEXT NOT NULL DEFAULT '{}'
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
  id         TEXT NOT NULL PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  value      TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT NOT NULL PRIMARY KEY,
  user_id    TEXT,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  before     TEXT,
  after      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
