# Workflow التنفيذ الكامل — web-cost-app
**آخر تحديث:** 2026-05-16 · **حالة حية:** راجع **`CONTEXT.md`** و **`CLAUDE.md`** (مثلاً تحويل مخازن المشاريع + GL — 2026-05-31).

> هذا الملف خطة تنفيذ تاريخية. للمسارات والصلاحيات الحالية استخدم **`CONTEXT.md` §7–8**.

---

## ① تحليل الوضع الحالي (ما هو موجود فعلاً)

### Schema SQLite ✅ مكتمل تماماً
جميع الجداول المطلوبة موجودة بالفعل في migrations:

| الجدول | Migration | الحالة |
|---|---|---|
| `purchase_invoice_lines` | 001 | ✅ موجود |
| `purchase_invoice_allocations` | 001 | ✅ موجود + trigger validation |
| `contract_inventory` | 001 | ✅ موجود + computed `quantity_balance` |
| `inventory_consumption` | 001 | ✅ موجود |
| `inventory_transfers` | 001 | ✅ موجود + status machine كامل |
| `inventory_transfer_lines` | 001 | ✅ موجود |
| `subcontractors` | 001 | ✅ موجود |
| `subcontract_assignments` | 001 | ✅ موجود |
| `subcontract_extracts` | 001 | ✅ موجود |
| `projects`, `contracts`, `users`, etc. | 002 | ✅ موجود |

### Backend API الموجود ✅
| Endpoint | الحالة |
|---|---|
| `POST /api/sqlite-core/purchase-invoices/distributed` | ✅ يعمل — فاتورة موزعة + رفع مخزون |
| `/api/projects`, `/api/contracts`, `/api/boq-items` | ✅ CRUD عبر `crud.ts` |
| `/api/billing`, `/api/gl`, `/api/reports` | ✅ موجود |
| `/api/auth/login|logout|me|users` | ✅ موجود |

### Frontend الموجود ✅
- `UserRole`: `admin | projects_manager | project_accountant | user`
- `ModuleCrudPermission`: `{ view, create, edit }` per module
- `useUserAccessScope` hook جاهز للفلترة حسب `assignedContractIds`

---

## ② الفجوات (ما ينقص فعلاً)

### Backend (ينقص 3 modules كاملة):
1. `server/src/modules/inventory.ts` — لا يوجد بعد
2. `server/src/modules/inventoryTransfers.ts` — لا يوجد بعد
3. `server/src/modules/subcontractor.ts` — لا يوجد بعد

### Migration إضافي (migration 003):
- إضافة `boq_item_id` لجدول `purchase_invoice_lines` (backlog H1)

### Frontend (ينقص component-ان):
1. `src/components/Inventory.tsx` — موديول المخازن كامل
2. `src/components/SubcontractorExtracts.tsx` — مستخلصات الباطن

### نظام الصلاحيات:
- **Server-side** (`server/src/permissions.ts`): flat booleans فقط — يحتاج إضافة `inventory` + `transfers` + `subcontractor`
- **Frontend** (`src/types.ts`): ModuleCrudPermission per module — كافٍ

---

## ③ Workflow التنفيذ المرحلي

```
Migration 003 → Inventory Backend → Transfers Backend → Subcontractor Backend
     ↓                ↓                    ↓                    ↓
  app.ts تسجيل ←──────────────────────────────────────────────────
     ↓
  Inventory Frontend → SubcontractorExtracts Frontend → Permission Guards
```

---

## ④ تفاصيل كل مرحلة

---

### المرحلة 1 — Migration 003: إضافة boq_item_id
**ملف:** `server/sqlite/migrations/003_boq_link.sql`

```sql
ALTER TABLE purchase_invoice_lines ADD COLUMN boq_item_id TEXT;
```

**سبب التأجير:** لا يكسر أي شيء، optional field.

---

### المرحلة 2 — Backend: موديول المخزون (G1)
**ملف جديد:** `server/src/modules/inventory.ts`

**Endpoints:**
| Method | Path | الوصف | الصلاحية |
|---|---|---|---|
| GET | `/api/inventory` | رصيد المخزون | `costs` |
| GET | `/api/inventory/:contractId/summary` | ملخص رصيد عقد | `costs` |
| POST | `/api/inventory/consume` | تسجيل صرف للموقع | `costs` |
| GET | `/api/inventory/consumption` | سجل الصرف | `costs` |
| GET | `/api/inventory/items` | كل أصناف مخزون (عبر عقود المستخدم) | `costs` |

**منطق `POST /api/inventory/consume`:**
```
1. تحقق أن inventory_item.contract_id == المستخدم له صلاحية
2. تحقق quantity <= quantity_balance (بعد خصم المحجوز)
3. UPDATE contract_inventory SET quantity_consumed = quantity_consumed + :qty
4. INSERT INTO inventory_consumption
5. إرجاع الرصيد الجديد
```

**قاعدة المخزون المحجوز:**
```sql
-- الكمية المحجوزة = مجموع بنود التحويلات المعلقة
SELECT COALESCE(SUM(itl.quantity), 0)
FROM inventory_transfer_lines itl
JOIN inventory_transfers it ON itl.transfer_id = it.id
WHERE itl.inventory_item_id = :item_id
  AND it.status IN ('pending_b', 'pending_projects')
```

---

### المرحلة 3b — تحويل مخازن المشاريع + GL ✅ (2026-05-31)
- `project_inventory_transfers` (011–012) · `projectInventoryTransfers.ts`
- مسار `/api/inventory/project-transfers` · قيد **Dr وجهة 127… / Cr مصدر 127…** عند `approve-projects`
- تفاصيل: `CONTEXT.md` · `CLAUDE.md` · `docs/workflow-perf-checklist.md` (G2b)

### المرحلة 3 — Backend: تحويلات المخزون (G2 — عقود legacy)
**ملف:** `server/src/modules/inventoryTransfers.ts`

**Endpoints:**
| Method | Path | الوصف | الصلاحية |
|---|---|---|---|
| GET | `/api/inventory-transfers` | قائمة التحويلات | `costs` |
| POST | `/api/inventory-transfers` | إنشاء طلب (status: `pending_b`) | `costs` |
| POST | `/:id/approve-b` | محاسب B يقبل | `costs` |
| POST | `/:id/reject-b` | محاسب B يرفض | `costs` |
| POST | `/:id/approve-projects` | مسؤول المشاريع يعتمد | `projects` |
| POST | `/:id/reject-projects` | مسؤول المشاريع يرفض | `projects` |
| POST | `/:id/cancel` | إلغاء (صاحب الطلب فقط) | `costs` |

**State Machine:**
```
CREATED  ──────────────────────────────►  pending_b
                                              │
                                    ┌─────────┼─────────┐
                                rejected_b        ↓ (same project)
                                              approved  ◄──── نفس المشروع
                                              │
                                         ↓ (different project)
                                       pending_projects
                                              │
                                    ┌─────────┼──────────┐
                              rejected_projects           approved
```

**الأثر المحاسبي عند `approved` فقط:**
```sql
-- داخل transaction واحد:
UPDATE contract_inventory
  SET quantity_transferred_out = quantity_transferred_out + :qty
WHERE id = :from_item_id;

-- إيجاد أو إنشاء صنف في عقد B بنفس unit_cost الأصلي:
INSERT OR IGNORE INTO contract_inventory (contract_id, item_description, unit, quantity_in, unit_cost)
  VALUES (:to_contract, :desc, :unit, 0, :original_cost);

UPDATE contract_inventory
  SET quantity_transferred_in = quantity_transferred_in + :qty
WHERE contract_id = :to_contract AND item_description = :desc AND unit = :unit;
```

**قواعد التحقق عند الإنشاء:**
- `from_contract` لا يساوي `to_contract`
- كل صنف: `quantity <= quantity_balance - reserved_quantity`
- المستخدم لديه صلاحية على `from_contract`

**قاعدة نفس/مختلف المشروع:**
```
-- fetch contracts to compare project_id
SELECT project_id FROM contracts WHERE id IN (:from_contract_id, :to_contract_id)
```

---

### المرحلة 4 — Backend: مستخلصات مقاول الباطن (G4)
**ملف جديد:** `server/src/modules/subcontractor.ts`

**Endpoints:**
| Method | Path | الوصف | الصلاحية |
|---|---|---|---|
| GET/POST | `/api/subcontractors` | قائمة وإنشاء | `suppliers` |
| GET/PUT | `/api/subcontractors/:id` | عرض وتعديل | `suppliers` |
| GET/POST | `/api/subcontract-assignments` | إسناد بنود BOQ | `costs` |
| GET | `/api/subcontract-assignments/:id` | تفاصيل إسناد | `costs` |
| GET/POST | `/api/subcontract-extracts` | مستخلصات | `billing` |
| GET | `/api/subcontract-extracts/:id` | تفاصيل مستخلص | `billing` |
| PUT | `/api/subcontract-extracts/:id/status` | تغيير الحالة | `billing` |

**معادلة المستخلص (computed في backend):**
```
gross_amount = executed_quantity × unit_price
performance_guarantee_amount = gross_amount × (performance_guarantee_rate / 100)
net_payable = gross_amount - performance_guarantee_amount
            - advance_payment_deduction - delay_penalty
```

---

### المرحلة 5 — تسجيل Routes في app.ts
**ملف معدّل:** `server/src/app.ts`

```typescript
import { inventoryRouter } from './modules/inventory.js';
import { inventoryTransfersRouter } from './modules/inventoryTransfers.js';
import { subcontractorRouter } from './modules/subcontractor.js';

// إضافة بعد sqliteCoreRouter:
app.use('/api/inventory',            inventoryRouter);
app.use('/api/inventory-transfers',  inventoryTransfersRouter);
app.use('/api/subcontractors',       subcontractorRouter);
app.use('/api/subcontract-assignments', subcontractorRouter);  // نفس الملف، route مختلف
app.use('/api/subcontract-extracts',    subcontractorRouter);
```

---

### المرحلة 6 — Frontend: Inventory.tsx (G3)
**ملف جديد:** `src/components/Inventory.tsx`

**3 تبويبات:**

#### Tab 1: رصيد المخزون
- جدول: الصنف | الوحدة | وارد | مصروف | محوّل خارج | محوّل داخل | **الرصيد** | سعر الوحدة | القيمة
- فلتر: عقد (من عقود المستخدم فقط)
- زر لكل صنف: "تسجيل صرف" → modal
  - modal: الكمية + تاريخ الصرف + ربط ببند BOQ (اختياري)
  - validation: الكمية ≤ الرصيد المتاح

#### Tab 2: تحويل المخزون
- **قسم الإنشاء** (project_accountant فقط):
  - من عقد (عقوده) → إلى عقد (كل العقود)
  - جدول أصناف: اختر من مخزون العقد المصدر + كمية
  - validation: لا تتجاوز المتاح

- **جدول الطلبات المعلقة** (مع أزرار حسب الدور):
  - `pending_b` + المستخدم هو محاسب B → زر قبول/رفض
  - `pending_projects` + الدور `projects_manager` → زر اعتماد/رفض
  - صاحب الطلب + حالة `pending_b` → زر إلغاء

#### Tab 3: سجل الحركات
- جدول تاريخي لكل العمليات (صرف + وارد + تحويلات)
- فلتر: عقد + نوع الحركة + تاريخ

---

### المرحلة 7 — Frontend: SubcontractorExtracts.tsx (G4)
**ملف جديد:** `src/components/SubcontractorExtracts.tsx`

**تبويبان:**

#### Tab 1: إدارة مقاولي الباطن
- قائمة المقاولين: اسم | مهنة | رقم ضريبي | تجاري
- إنشاء/تعديل مقاول

#### Tab 2: المستخلصات
- اختر: مشروع → عقد → مقاول → إسناد بند BOQ
- نموذج المستخلص:
  - فترة من/إلى
  - الكمية المنفذة
  - السعر (من subcontract_assignment)
  - ضمان الأداء % (قابل للتعديل)
  - خصم دفعة مقدمة
  - غرامة تأخير
  - **صافي المستحق (محسوب)**
- جدول المستخلصات مع الحالة: draft → submitted → approved

---

### المرحلة 8 — تحديث نظام الصلاحيات

#### Server-side permissions.ts:
إضافة مفاتيح جديدة:
```typescript
export type PermissionKey =
  | 'dashboard' | 'ledger' | 'projects' | 'boq' | 'billing'
  | 'costs' | 'suppliers' | 'reports' | 'settings'
  | 'inventory'        // جديد: مخزون العقد
  | 'transfers'        // جديد: تحويلات المخزون
  | 'subcontractor';   // جديد: مستخلصات الباطن
```

#### قاعدة RBAC في middleware:
```typescript
// projects_manager: يرى كل التحويلات المعلقة بين مشاريع مختلفة
// project_accountant: يرى تحويلات عقوده فقط

function canApproveTransfer(user, transfer) {
  if (user.role === 'admin') return true;
  if (user.role === 'projects_manager' && transfer.status === 'pending_projects') return true;
  if (user.role === 'project_accountant') {
    // يقبل فقط إذا كان محاسب العقد B
    return user.assignedContractIds?.includes(transfer.to_contract_id);
  }
  return false;
}
```

#### users جدول — حقل assignedContractIds:
```sql
-- Migration 003 يضيف أيضاً:
ALTER TABLE users ADD COLUMN assigned_contract_ids TEXT DEFAULT '[]';
-- JSON array of contract IDs
```

---

## ⑤ ترتيب التنفيذ الزمني

```
اليوم 1:
  ├── Migration 003 (SQL فقط - 5 دقائق)
  └── inventory.ts backend (G1) - ~2 ساعة

اليوم 2:
  ├── inventoryTransfers.ts backend (G2) - ~3 ساعات
  └── تسجيل routes في app.ts

اليوم 3:
  └── subcontractor.ts backend (G4) - ~2 ساعة

اليوم 4:
  └── Inventory.tsx frontend (G3) - ~4 ساعات

اليوم 5:
  └── SubcontractorExtracts.tsx frontend (G4 UI) - ~3 ساعات

اليوم 6:
  ├── تحديث نظام الصلاحيات (permissions.ts + middleware)
  └── تسجيل الموديولات الجديدة في WindowManager.tsx
```

---

## ⑥ قواعد التنفيذ (لا تخالفها)

### لكل router جديد:
```typescript
// نمط ثابت — انسخ من sqliteCore.ts
import { getSqliteCoreDb } from '../sqlite/core.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
const db = getSqliteCoreDb(); // NOT getDb() — هذه للجداول الأصلية
```

### لكل transaction:
```typescript
const result = db.transaction(() => {
  // كل العمليات هنا
  // أي throw تلغي كل شيء تلقائياً
})();
```

### Validation صارم (لا تتجاوزه):
```typescript
// مجموع التوزيعات = إجمالي البند ± EPSILON
const EPSILON = 0.000001;
if (Math.abs(allocTotal - lineTotal) > EPSILON) throw new Error('...');
```

### حماية المخزون المحجوز:
```typescript
// في كل عملية صرف أو تحويل جديد
const reserved = getReservedQuantity(itemId); // من inventory_transfer_lines + pending transfers
const available = item.quantityBalance - reserved;
if (requestedQty > available) throw new Error('Insufficient available balance');
```

### اتجاه البيانات — مهم جداً:
- `getSqliteCoreDb()` → جداول Migration 001 (inventory, transfers, subcontractor)
- `getDb()` → جداول Migration 002 (projects, contracts, users, billing...)
- **لا تخلط بينهما** — قاعدتا بيانات مختلفتان مبدئياً (قد تكونان نفس الملف لكن treat كأنهما منفصلتان)

---

## ⑦ نقاط انتباه حرجة

### 1. التحقق من نفس المشروع في التحويلات:
```typescript
// في inventoryTransfers.ts عند approve-b:
const [fromContract, toContract] = db.prepare(
  'SELECT id, project_id FROM contracts WHERE id IN (?, ?)'
).all(fromId, toId) as { id: string; project_id: string }[];

const sameProject = fromContract.project_id === toContract.project_id;
// نفس المشروع → approved مباشرة
// مختلف → pending_projects
```

### 2. الأثر المحاسبي فقط عند approved:
```typescript
if (transfer.status === 'approved') {
  // لا تفعل شيئاً عند pending_b أو pending_projects
  // الأثر يحدث مرة واحدة فقط عند الاعتماد النهائي
}
```

### 3. سعر التكلفة الأصلي في التحويل:
```typescript
// عند إنشاء الصنف في العقد B — لا إعادة تقييم:
const originalCost = fromInventoryItem.unitCost; // ليس average جديد
```

### 4. فلترة البيانات حسب الدور في API:
```typescript
// project_accountant: يرى فقط عقوده
if (user.role === 'project_accountant') {
  const assignedIds = JSON.parse(user.assignedContractIds || '[]');
  conditions.push(`contract_id IN (${assignedIds.map(() => '?').join(',')})`);
  params.push(...assignedIds);
}
```

---

## ⑧ ملفات ستُعدّل (لا تُنشأ)

| الملف | التعديل |
|---|---|
| `server/src/app.ts` | إضافة 3 routes جديدة |
| `server/src/permissions.ts` | إضافة `inventory`, `transfers`, `subcontractor` |
| `server/src/middleware/auth.ts` | إضافة `requireRole()` helper |
| `src/components/WindowManager.tsx` | تسجيل `Inventory` و `SubcontractorExtracts` |
| `CONTEXT.md` | تحديث قسم 5 و 8 بعد كل مرحلة |

## ⑧ ملفات ستُنشأ

| الملف | المرحلة |
|---|---|
| `server/sqlite/migrations/003_boq_link.sql` | 1 |
| `server/src/modules/inventory.ts` | 2 |
| `server/src/modules/inventoryTransfers.ts` | 3 |
| `server/src/modules/subcontractor.ts` | 4 |
| `src/components/Inventory.tsx` | 6 |
| `src/components/SubcontractorExtracts.tsx` | 7 |

---

## ⑨ ترتيب بدء العمل الفوري

```
نبدأ الآن بـ:
  1. Migration 003
  2. inventory.ts (G1) — الأبسط والأكثر استقلالية
  3. اختبار الـ API بـ curl/Postman
  4. inventoryTransfers.ts (G2) — الأعقد
  5. ...
```

**أعطِ الأمر وسأبدأ بالمرحلة 1 فوراً.**
