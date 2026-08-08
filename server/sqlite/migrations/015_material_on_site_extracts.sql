-- مستخلصات التشوين (Material On-Site — MOS)
-- توريد خامات للموقع قبل التركيب؛ يُحسب جزء من قيمة بند BOQ كـ "كمية معادلة"
-- تُضاف لاحقاً إلى previous_quantity في مستخلصات التنفيذ.

CREATE TABLE IF NOT EXISTS material_on_site_extracts (
  id                  TEXT PRIMARY KEY,
  firestore_id        TEXT UNIQUE,
  contract_id         TEXT NOT NULL,
  boq_item_id         TEXT NOT NULL,        -- Firestore boq_items doc id

  supplied_quantity   REAL NOT NULL,         -- الكمية الموردة فعلاً
  on_site_percentage  REAL NOT NULL,         -- النسبة المتفاوضة (مثلاً 60)
  equivalent_quantity REAL NOT NULL,         -- = supplied_quantity × on_site_percentage / 100
  unit_price          REAL NOT NULL,         -- سعر الوحدة من BOQ
  claimed_amount      REAL NOT NULL,         -- = equivalent_quantity × unit_price

  delivery_note_ref   TEXT,                  -- رقم إذن الاستلام / مرجع المستند
  extract_number      TEXT,                  -- MOS-YYYY-NNN
  extract_date        TEXT,                  -- YYYY-MM-DD
  notes               TEXT,

  status              TEXT NOT NULL DEFAULT 'draft',
  -- draft = مسودة
  -- approved = معتمد وتم القيد
  -- superseded = تم تجاوزه (تنفيذ اكتمل بعده)

  transaction_id      TEXT,                  -- id القيد في جدول transactions (UUID نصي)
  created_by          TEXT,
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_mos_contract    ON material_on_site_extracts(contract_id);
CREATE INDEX IF NOT EXISTS idx_mos_boq_item    ON material_on_site_extracts(boq_item_id);
CREATE INDEX IF NOT EXISTS idx_mos_status      ON material_on_site_extracts(status);
CREATE INDEX IF NOT EXISTS idx_mos_firestore   ON material_on_site_extracts(firestore_id);
