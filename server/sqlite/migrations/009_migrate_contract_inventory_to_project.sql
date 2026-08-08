-- Migration 009: ترحيل أرصدة contract_inventory legacy → project_inventory (مرة واحدة)
-- يدمج الرصيد المتبقي (balance + reserved) per (project_id, material_category_id)
-- لا يحذف contract_inventory — للتوافق والتحويلات القديمة فقط

INSERT INTO project_inventory (
  project_id,
  material_category_id,
  item_description,
  unit,
  quantity_in,
  quantity_issued,
  quantity_returned,
  quantity_reserved,
  avg_unit_cost,
  updated_at
)
SELECT
  c.project_id,
  ci.material_category_id,
  MAX(COALESCE(ci.item_description, mc.name, '')),
  MAX(COALESCE(ci.unit, mc.unit, '—')),
  SUM(ci.quantity_balance + ci.quantity_reserved),
  0,
  0,
  0,
  CASE
    WHEN SUM(ci.quantity_balance + ci.quantity_reserved) > 0
    THEN SUM((ci.quantity_balance + ci.quantity_reserved) * ci.avg_unit_cost)
         / SUM(ci.quantity_balance + ci.quantity_reserved)
    ELSE MAX(ci.avg_unit_cost)
  END,
  datetime('now')
FROM contract_inventory ci
JOIN contracts c ON ci.contract_id = c.id
LEFT JOIN material_categories mc ON ci.material_category_id = mc.id
WHERE c.project_id IS NOT NULL
  AND ci.material_category_id IS NOT NULL
  AND (ci.quantity_balance + ci.quantity_reserved) > 0.000001
GROUP BY c.project_id, ci.material_category_id
ON CONFLICT(project_id, material_category_id) DO UPDATE SET
  quantity_in = project_inventory.quantity_in + excluded.quantity_in,
  avg_unit_cost = CASE
    WHEN (project_inventory.quantity_in + excluded.quantity_in) > 0
    THEN (
      project_inventory.quantity_in * project_inventory.avg_unit_cost
      + excluded.quantity_in * excluded.avg_unit_cost
    ) / (project_inventory.quantity_in + excluded.quantity_in)
    ELSE project_inventory.avg_unit_cost
  END,
  item_description = COALESCE(project_inventory.item_description, excluded.item_description),
  unit = COALESCE(project_inventory.unit, excluded.unit),
  updated_at = datetime('now');
