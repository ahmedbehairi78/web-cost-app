# خطة عمل — مخزن المشروع المركزي + صرف + إرجاع

**التاريخ:** 2026-05-20  
**آخر تحديث:** 2026-05-31 — تحويلات مخازن المشاريع + قيد GL (127…)  
**الغرض:** وثيقة تسليم لبدء محادثة/تنفيذ جديد — إعادة هيكلة دورة المواد من «مخزون per-contract + مصروف GL فوري» إلى «مخزن مشروع مركزي → صرف → إرجاع».

**مرجع تقني:** `CLAUDE.md` · `CONTEXT.md` · `docs/WORKFLOW.md`

---

## 1. الهدف التشغيلي

### النموذج المستهدف

```
فاتورة مشتريات (100 طن)
        ↓
مخزن المشروع (100 طن + تكلفة كاملة شاملة ض.ق.م)
        ↓
أمر صرف (مثلاً 40 طن → عقد A + بند BOQ)
        ↓
تكلفة فعلية على BOQ للعقد (40 طن فقط)
        ↓
[اختياري] إذن إرجاع (مثلاً 5 طن → مخزن المشروع)
```

### قواعد محاسبية ثابتة

| الحدث | المخزون | GL | BOQ |
|-------|---------|-----|-----|
| فاتورة مشtريات | +100% الكمية والتكلفة على **مخزن المشروع** | مدين **`12701001` مخزون مشروع** / دائن مورد + WHT | لا شيء |
| أمر صرف | −كمية من مخزن المشروع | مدين **مصروف/WIP عقد** / دائن مخزون | +تكلفة على البند |
| إذن إرجاع | +كمية إلى مخزن المشروع | عكس جزئي للصرف | −تكلفة من البند |

- **تكلفة الوحدة في المخزون** = سعر الشراء + ض.ق.م المحتسبة (متوسط مرجح عند كل وارد).
- **لا يوجد «عقد مخزن»** — المخزن مرتبط **بالمشروع** (`project_id`)، والصرف يُحمّل على **عقد تنفيذ** محدد.
- **العملة:** جنيه مصري. **الوضع المحلي:** `VITE_DATA_BACKEND=local` + `local:api`.

---

## 2. الوضع الحالي (ما يجب تغييره)

### 2.1 المخزون

| الآن | المطلوب |
|------|---------|
| `contract_inventory` (per `contract_id`) | `project_inventory` (per `project_id`) للمخزن المركزي |
| فاتورة موزعة → وارد على عقود متعددة + فرق على عقد التوزيع | فاتورة → **100%** وارد مخزن المشروع |
| أمر صرف يخصم من مخزون **نفس العقد** | أمر صرف يخصم من **مخزن المشروع** |

**ملفات رئيسية:**
- `server/src/modules/sqliteCore.ts` — فاتورة موزعة + وارد مخزون
- `server/src/modules/consumptionOrders.ts` — أوامر صرف
- `server/src/modules/inventory.ts` — عرض الرصيد
- `server/src/modules/inventoryHelpers.ts` — متوسط مرجح، `upsertInventoryReceipt`
- `src/components/ActualCosts.tsx` — واجهة فاتورة المشتريات
- `src/components/Inventory.tsx` + `ConsumptionOrderModal.tsx`

### 2.2 القيد المحاسبي (GL)

| الآن | المطلوب |
|------|---------|
| `recordPurchaseInvoice`: مدين **مصروف (5)** كامل الفاتورة على `costCenterId` = عقد أساسي | مدين **`12701…` مخزون مشروع** على **`projectId`**؛ لا مصروف فوري |
| لا قيد عند الصرف | قيد عند تأكيد أمر الصرف: مصروف عقد ← مخزون |
| لا إرجاع | قيد عكسي عند إذن الإرجاع |

**ملف:** `src/services/accountingService.ts` — `recordPurchaseInvoice` + دوال جديدة للصرف/الإرجاع.

### 2.3 ما لا يوجد

- جدول `project_inventory`
- جدول `return_orders` / `return_order_lines` (إذن إرجاع)
- API إرجاع
- واجهة إذن إرجاع
- حساب COA لمخزون المشروع تحت **`12701…`** (انظر §3.1)

---

## 3. قرارات معتمدة ✅

> **2026-05-20** — اعتماد: COA **`12701001`** · إزالة توزيع العقود · `contract_inventory` legacy.

### 3.1 حساب GL — مخزون المشروع (`12701001`)

**القرار:** المخزون المركزي يُقيَّد على **`12701…`** — مخزون مشروع.

| المستوى | مثال | الوصف |
|---------|------|--------|
| مجموعة | `127` | أصول متداولة — مخزون |
| مجموعة | `12701` | مخزون مشاريع |
| **ورقة** | **`12701001`** | **مخزون مشروع X** |
| ورقة | `12701002` | مخزون مشروع Y (تسلسلي تحت `12701`) |

**فاتورة مشtريات:**
```
مدين  12701001  مخزون مشروع X     (base + VAT)
دائن  21101…    مورد
دائن  21402…    WHT
```
- `projectId` على القيد · **`costCenterId` = null** (لا عقد عند الشراء).

**أمر صرف:**
```
مدين  51101001  مواد بناء          (costCenterId = العقد)
دائن  12701001  مخزون مشروع X
```

**إذن إرجاع:**
```
مدين  12701001  مخزون مشروع X
دائن  51101001  مواد بناء          (costCenterId = العقد)
```

**تنفيذ:** `AccountCodes` + `chartOfAccountsSeed.ts` · `recordPurchaseToProjectInventory()` · ربط `projects.inventoryAccountCode` (اختياري).

### 3.2 مصير `contract_inventory` — توضيح

**السؤال:** ماذا نفعل بجدول **`contract_inventory`** (مخزون **لكل عقد**) بعد **`project_inventory`**؟

**القرار:**

| الجدول | بعد التعديل |
|--------|-------------|
| **`project_inventory`** | المصدر الرئيسي — مشtريات، صرف، إرجاع |
| **`contract_inventory`** | **Legacy فقط** — بيانات قديمة، **لا وارد جديد**، يُخفى من الواجهة |
| **`inventory_transfers`** | **مُجمَّد** في هذه الخطة |

**باختصار:** كل الحركات الجديدة عبر **مخزن المشروع**؛ جدول مخزون العقد يبقى للتاريخ فقط.

### 3.3 فاتورة المشتريات — **إزالة توزيع العقود** ✅

**القرار:** **حذف توزيع العقود بالكامل** من فاتورة المشتريات.

| يُزال | يُبقى |
|-------|--------|
| صفوف «التوزيع على العقود» في `ActualCosts.tsx` | **المشروع** + مورد + بنود |
| `purchase_invoice_allocations` (مسار جديد) | صنف، كمية، سعر، ض.ق.م |
| `primaryContractId` للGL | ربط BOQ **اختياري** (مرجع) |
| `surplusContractId` / surplus | **100%** → `project_inventory` |

**Payload (بدون `allocations`):**
```json
{
  "projectId": "…",
  "vatPct": 14,
  "lines": [{ "materialCategoryId": 1, "quantity": 100, "unitCost": 10000 }]
}
```

### 3.4 أمر الصرف — الحقول الإلزامية

- `projectId` (موروث من المخزن)
- `contractId` (عقد التحميل)
- `boqItemId`
- `materialCategoryId`
- `quantity`
- `orderDate` · `notes`

### 3.5 إذن الإرجاع — الحقول الإلزامية

- `projectId`
- `contractId` (مصدر الإرجاع)
- `consumptionOrderId` أو `consumptionOrderLineId` (ربط بأمر الصرف الأصلي — **مُفضّل**)
- `materialCategoryId`
- `quantity` (≤ الكمية المصروفة غير المرتجعة سابقاً)
- `returnDate` · `reason` · `notes`

---

## 4. خطة التنفيذ على مراحل

### المرحلة 0 — تحضير (نصف يوم)

- [x] COA **`12701001`** · إزالة توزيع العقود · `contract_inventory` legacy.
- [ ] إنشاء فرع git: `feature/project-central-warehouse`.
- [ ] تشغيل golden path حالي وتسجيل baseline (فاتورة → مخزون → صرف) للمقارنة.

---

### المرحلة 1 — Schema: مخزن المشروع (Migration 006)

**ملف:** `server/sqlite/migrations/006_project_inventory.sql`

```sql
-- project_inventory: مخزون مركزي per (project_id, material_category_id)
-- quantity_in, quantity_issued, quantity_returned, quantity_reserved
-- quantity_balance = in + returned - issued - reserved (generated)
-- avg_unit_cost (متوسط مرجح)

-- purchase_invoices: ADD project_id (إلزامي للفواتير الجديدة)

-- [اختياري] project_inventory_movements — سجل حركات (audit)
```

**مهام:**
- [ ] جدول `project_inventory` + فهارس + unique `(project_id, material_category_id)`.
- [ ] `upsertProjectInventoryReceipt()` في `inventoryHelpers.ts`.
- [ ] `getProjectInventoryByMaterial()`, `getProjectAvailableQuantity()`.
- [ ] **لا تحذف** `contract_inventory` بعد — coexistence during migration.

**اختبار:** migration على DB فارغ + DB موجود؛ `npm run local:api` يقلع بدون أخطاء.

---

### المرحلة 2 — Backend: فاتورة مشتريات → مخزن المشروع

**ملفات:**
- `server/src/modules/sqliteCore.ts`
- `src/components/ActualCosts.tsx`
- `src/services/local/modulesApi.ts`

**مهام:**
- [ ] Payload فاتورة: `projectId` إلزامي؛ **بدون `allocations`**.
- [ ] عند `status: confirmed`: وارد **100%** → `project_inventory` · `unitCostInclVat`.
- [ ] إزالة منطق `contract_id` / `surplusContractId` / `purchase_invoice_allocations` من المسار الجديد.
- [ ] **GL:** `recordPurchaseToProjectInventory` — مدين **`12701001`** · دائن مورد + WHT · `projectId` · **بدون `costCenterId`**.
- [ ] واجهة ActualCosts: **مشروع + بنود فقط** (حذف UI التوزيع على العقود).
- [ ] Firestore: `projectId` + `invoiceLines` بدون allocations.

**اختبار:**
- [ ] فاتورة 100 طن → `project_inventory` = 100 · `avg_unit_cost` incl VAT.
- [ ] GL متوازن · لا مصروف class 5 على العقد.
- [ ] `npm run lint` + `npm run test` (accountingService إن وُجد).

---

### المرحلة 3 — Backend + UI: أمر صرف من مخزن المشروع

**ملفات:**
- `server/src/modules/consumptionOrders.ts`
- `server/src/modules/inventory.ts`
- `src/components/inventory/ConsumptionOrderModal.tsx`
- `src/components/Inventory.tsx`

**مهام:**
- [ ] `consumption_orders`: ADD `project_id` (أو استنتاج من `contract.project_id`).
- [ ] التحقق: الكمية ≤ **متاح مخزن المشروع** (ليس `contract_inventory`).
- [ ] عند `confirm`:
  - `project_inventory.quantity_issued += qty`
  - `boq_actual_costs` كما هو (عقد + BOQ + material)
  - **GL جديد:** `recordConsumptionIssue()` — مصروف عقد ← مخزون مشروع
- [ ] Modal: اختيار مشروع/عقد/BOQ/صنف؛ عرض **متاح مخزن المشروع**.
- [ ] تبويب الرصيد في Inventory: **«مخزن المشروع»** (فلتر per project) بدل/بالإضافة لرصيد العقد.

**اختبار:**
- [ ] مخزون 100 → صرف 40 → متبقي 60 · BOQ actual = 40 × avg_cost.
- [ ] GL: مصروف 456,000 (مثال) على `costCenterId` = العقد.
- [ ] منع صرف > المتاح.

---

### المرحلة 4 — Backend + UI: إذن إرجاع للمخزن

**ملفات جديدة:**
- `server/sqlite/migrations/007_return_orders.sql`
- `server/src/modules/returnOrders.ts`
- `src/components/inventory/ReturnOrderModal.tsx`

**Schema:**
```sql
return_orders (id, return_number, project_id, contract_id, return_date, recorded_by, status, notes)
return_order_lines (id, return_order_id, consumption_order_line_id, material_category_id, boq_item_id, quantity, unit_cost, total_cost, reason)
```

**مهام:**
- [ ] `POST /api/return-orders` (draft) + `POST /:id/confirm`.
- [ ] Validation: `qty ≤ (issued − already_returned)` لنفس خط الصرف.
- [ ] عند confirm:
  - `project_inventory.quantity_returned += qty` (أو `quantity_in` — يُثبَّت في التصميم)
  - عكس `boq_actual_costs` (سجل سالب أو جدول adjustments)
  - **GL:** `recordReturnToWarehouse()` — مخزون ← مصروف عقد
- [ ] UI: من سجل أوامر الصرف → «إرجاع» · تحديد كمية + سبب.

**اختبار:**
- [ ] صرف 40 → إرجاع 5 → مخزن 65 · BOQ net 35 · GL متوازن.

---

### المرحلة 5 — ترحيل البيانات والتوافق

**مهام:**
- [x] سكربت ترحيل: `009_migrate_contract_inventory_to_project.sql` — دمج أرصدة legacy per `project_id`.
- [ ] فواتير قديمة في SQLite: قراءة فقط أو إعادة ترحيل يدوي.
- [x] **`contract_inventory`:** legacy — مخفي من تبويب الرصيد؛ تحويلات فقط (مجمّدة).
- [x] **`inventory_transfers`:** تجميد طلبات جديدة؛ إكمال المعلّق فقط.
- [x] تحديث `TEST_CHECKLIST_AR.md` (جزئي — راجع `CLAUDE.md` · `CONTEXT.md` عند الحاجة).

---

### المرحلة 6 — تقارير وتدقيق

- [x] BOQ: عمود التكلفة من `boq_actual_costs` عبر `boq-actuals` · مخزن المشروع من `project_inventory`.
- [x] تقرير حركة مخزن المشروع: `GET /inventory/project/:id/movements` + UI في تبويب الرصيد.
- [x] Dashboard/Reports: `operatingExpenseFromGl` — استبعاد وارد المخزن (12701) وفواتير 51101 القديمة؛ مواد فعلية من `boq_actual_costs` (محلي).
- [x] `spentByContract` في ActualCosts: `boq_actual_costs` + IPC (بدون فواتير مشتريات).

---

## 5. ترتيب الملفات المتوقع تعديلها

| الأولوية | ملف |
|----------|-----|
| P0 | `server/sqlite/migrations/006_*.sql`, `007_*.sql` |
| P0 | `server/src/modules/inventoryHelpers.ts` |
| P0 | `server/src/modules/sqliteCore.ts` |
| P0 | `server/src/modules/consumptionOrders.ts` |
| P0 | `server/src/modules/returnOrders.ts` (جديد) |
| P0 | `server/src/app.ts` (router) |
| P1 | `src/services/accountingService.ts` |
| P1 | `src/components/ActualCosts.tsx` |
| P1 | `src/components/Inventory.tsx` |
| P1 | `src/components/inventory/ConsumptionOrderModal.tsx` |
| P1 | `src/components/inventory/ReturnOrderModal.tsx` (جديد) |
| P1 | `src/services/local/modulesApi.ts` |
| P2 | `src/data/chartOfAccountsSeed.ts` |
| P2 | `TEST_CHECKLIST_AR.md`, `CLAUDE.md`, `CONTEXT.md` |

---

## 6. سيناريو اختبار E2E (معيار القبول)

```
1. مشروع P + عقد A + BOQ بند + صنف مربوط
2. فاتورة مشتريات: 100 طن @ 10,000 + 14% VAT
   → project_inventory: 100 طن, avg = 11,400
   → GL: Dr 12701001 1,140,000 / Cr مورد ...
   → BOQ actual: 0
3. أمر صرف: 40 طن → عقد A + BOQ
   → project_inventory: 60 متاح
   → boq_actual_costs: 456,000
   → GL: Dr مصروف عقد A / Cr مخزون
4. إذن إرجاع: 5 طن
   → project_inventory: 65
   → boq_actual_costs net: 399,000
   → GL: Dr مخزون / Cr مصروف عقد A
5. محاولة صرف 70 (> 65) → مرفوض
6. صرف غير مربوط BOQ↔material → مرفوض
```

---

## 7. مخاطر وملاحظات

| المخاطرة | التخفيف |
|----------|---------|
| كسر فواتير/مخزون قديم | coexistence + migration script + feature flag |
| ازدواج مصروف (فاتورة + صرف) | إزالة مصروف GL من فاتورة المشتريات في المرحلة 2 |
| `contract_inventory` vs `project_inventory` | قرار واضح في 3.1؛ لا حذف جداول قديمة فوراً |
| Firestore + SQLite غير متزامنين | الفاتورة: Firestore doc + SQLite header؛ GL في Firestore |
| صلاحيات | `project_accountant` scoped بـ `assignedContractIds` + project access |

---

## 8. نص جاهز لبدء المحادثة الجديدة

انسخ التالي كأول رسالة في المحادثة الجديدة:

---

**المطلوب:** تنفيذ خطة «مخزن المشروع المركزي» حسب `web-cost-app/docs/PROJECT_WAREHOUSE_WORKPLAN_AR.md`.

**قرارات معتمدة:**
- GL مخزون: **`12701001`** (مخزون مشروع X) تحت `12701…`
- **إزالة توزيع العقود** من فاتورة المشتريات بالكامل
- `contract_inventory` = legacy فقط

**ابدأ بالمرحلة 1:** migration `006_project_inventory.sql` + helpers في `inventoryHelpers.ts`.

**النموذج المستهدف:**
- فاتورة مشتريات → 100% وارد **مخزن المشروع** (تكلفة = سعر + ض.ق.م) · GL → حساب مخزون لا مصروف.
- أمر صرف → من مخزن المشروع إلى **عقد + BOQ** · GL مصروف عقد ← مخزون.
- إذن إرجاع → من العقد إلى مخزن المشروع · عكس BOQ + GL.

**لا يوجد «عقد مخزن».** المخزن per `project_id`.

**المراجع:** `CLAUDE.md` · `server/src/modules/sqliteCore.ts` · `consumptionOrders.ts` · `ActualCosts.tsx`.

---

## 9. خارج النطاق (هذه الخطة)

- ~~تحويلات مخزون بين مشاريع~~ — **مُنفَّذ** (migration 011–012، `projectInventoryTransfers`، قيد GL عند `approve-projects` — راجع `CONTEXT.md` §7).
- Barcode / RFID.
- تكامل ERP خارجي.
- `web-cost-app-local` (Prisma) — ما لم يُطلب صراحة.

---

*نهاية الوثيقة*
