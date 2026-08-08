-- Link project ↔ 127… warehouse COA (mirrors Firestore projectId / inventoryAccountCode)

ALTER TABLE projects ADD COLUMN inventory_account_code TEXT;
ALTER TABLE chart_of_accounts ADD COLUMN project_id TEXT REFERENCES projects(id);

CREATE INDEX IF NOT EXISTS idx_coa_project_id ON chart_of_accounts(project_id);
CREATE INDEX IF NOT EXISTS idx_projects_inventory_code ON projects(inventory_account_code);

-- Backfill COA.project_id from naming convention «مخزون مشروع - {project_name}»
UPDATE chart_of_accounts
SET project_id = (
  SELECT p.id FROM projects p
  WHERE p.is_deleted = 0
    AND (
      chart_of_accounts.account_name = 'مخزون مشروع - ' || p.project_name
      OR chart_of_accounts.account_name_en = 'Project Inventory - ' || COALESCE(NULLIF(p.project_name_en, ''), p.project_name)
    )
  LIMIT 1
)
WHERE is_group = 0
  AND account_code GLOB '127?????'
  AND (project_id IS NULL OR project_id = '');

-- Backfill projects.inventory_account_code from linked COA
UPDATE projects
SET inventory_account_code = (
  SELECT MIN(c.account_code) FROM chart_of_accounts c
  WHERE c.project_id = projects.id
    AND c.is_group = 0
    AND c.account_code GLOB '127?????'
    AND c.status = 'active'
)
WHERE (inventory_account_code IS NULL OR inventory_account_code = '')
  AND is_deleted = 0;
