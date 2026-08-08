# خطة تنفيذ — توزيع أمر الصرف على عدة بنود BOQ

> **المشروع:** Web Cost App  
> **الموديول:** المخازن → أمر صرف للموقع (`ConsumptionOrderModal`)  
> **التاريخ:** 2026-06-15  
> **الحالة:** ✅ مراحل 1–9 مكتملة (G2–G10 يدوياً عند الحاجة)

---

## ملخص القرار المعماري (Hybrid Spec)

| البند | القرار |
|-------|--------|
| **نموذج البيانات** | عدة أسطر في `consumption_order_lines` — **بدون** جدول `consumption_order_allocations` |
| **سطر واحد** | = توزيع على بند BOQ واحد (نفس الصنف) |
| **أمر واحد** | = عدة أسطر لنفس `materialCategoryId` |
| **تكلفة BOQ** | `boq_actual_costs` — سجل لكل سطر عند التأكيد |
| **مركز التكلفة GL** | `transactions.costCenterId = contractId` (**العقد** — وليس بند BOQ) |
| **قيد GL** | **قيد واحد** — عدة Dr مصروف + Cr مخزون واحد |
| **تسعير** | `avgUnitCost` من `project_inventory` (متوسط مرجح — كما هو اليوم) |
| **GL** | داخل `POST /:id/confirm` في `prisma.$transaction` (لا من الواجهة) |

### شكل القيد المحاسبي

```
مرجع: CON-YYYYMMDD-NNNN
projectId = المشروع
costCenterId = العقد (contractId)

Dr 51101001  cost₁   (بند 3.1.1)
Dr 51101001  cost₂   (بند 3.2.1)
Dr 51101001  cost₃   (بند 3.3.1)
Cr 12701xxx  Σcost   (مخزون المشروع)
```

---

## تتبع التقدّم

| المرحلة | الوصف | الحالة |
|---------|--------|--------|
| 0 | Baseline — خط أساس | ✅ |
| 1 | مكتبة التوزيع + اختبارات | ✅ |
| 2 | API بنود BOQ حسب الصنف | ✅ |
| 3 | تحقق خادم — POST متعدد الأسطر | ✅ |
| 4 | الواجهة — Allocation Modal | ✅ |
| 5 | GL ذري على الخادم | ✅ |
| 6 | قوالب التوزيع | ✅ |
| 7 | تحسين عرض التاريخ | ✅ |
| 8 | Regression شامل | ✅ |
| 9 | نشر + توثيق | ✅ |

**ترتيب التنفيذ الموصى به:** `0 → 1 → 2 → 3 → 4 → 5 → 8 → 6 → 7 → 9`

---

## المرحلة 0 — Baseline (خط أساس)

**المدة:** 0.5 يوم · **المخاطر:** —

### قبل أي تعديل

```powershell
cd "D:\cost web app\web-cost-app"
npm run lint
npm run test
npm run dev:local
```

### سجّل الحالة الحالية

- [ ] أمر صرف بسطر واحد يعمل من تبويب الرصيد
- [ ] مسودة + تأكيد من تبويب «الصرف والإرجاع» (`handleConfirmDraft`)
- [ ] إرجاع جزئي من سطر صرف
- [ ] `boq_actual_costs` يظهر في التقارير
- [ ] GL: قيد `CON-…` بسطر Dr واحد + Cr مخزن

### ملفات مرجعية (لا تُعدَّل في هذه المرحلة)

| ملف | الدور |
|-----|------|
| `server/src/modules/consumptionOrders.ts` | create + confirm |
| `src/components/inventory/ConsumptionOrderModal.tsx` | UI + GL من client (يُغيّر لاحقاً) |
| `src/services/accountingService.ts` | `recordConsumptionIssue` |
| `prisma/schema.prisma` | `ConsumptionOrder` / `ConsumptionOrderLine` |

---

## المرحلة 1 — مكتبة التوزيع

**المدة:** 0.5–1 يوم · **المخاطر:** منخفضة

### الملفات

| ملف | العمل |
|-----|------|
| `src/lib/consumptionAllocation.ts` | **جديد** |
| `src/lib/consumptionAllocation.test.ts` | **جديد** |

### دوال مقترحة

```typescript
allocateByWeights(totalQty, items[], basis: 'boq_qty' | 'boq_value')
validateAllocation(totalIssued, lines[], maxAvailable, epsilon = 0.01)
assertNoDuplicateBoqItems(lines[])
roundQty(n)  // 2 decimal places
```

### اختبارات وحدة

| # | الحالة | المتوقع |
|---|--------|---------|
| 1 | 3 بنود أوزان 200:100:100، إجمالي 50 | Σ = 50 |
| 2 | بند واحد | 100% للإجمالي |
| 3 | أوزان صفر | خطأ |
| 4 | largest remainder | لا فرق > 0.01 |
| 5 | Σ ≠ إجمالي | fail |
| 6 | إجمالي > متاح | fail |
| 7 | كمية سالبة | fail |
| 8 | تكرار `boqItemId` | fail |

### التحقق

```powershell
npm run test -- src/lib/consumptionAllocation.test.ts
```

### فحص التعارض

- [ ] لا تأثير على باقي الموديولات (ملف معزول)

---

## المرحلة 2 — API: بنود BOQ المرتبطة بصنف

**المدة:** 0.5 يوم · **المخاطر:** منخفضة

### الملفات

| ملف | العمل |
|-----|------|
| `server/src/modules/boqMaterials.ts` | `GET /by-material/:materialCategoryId?contractId=` |
| `src/services/local/modulesApi.ts` | `boqMaterialsApi.byMaterial(...)` |

### Endpoint

```
GET /api/boq-materials/by-material/:materialCategoryId?contractId=<uuid>
Permission: costs
```

### Response (مثال)

```json
[{
  "boqItemId": "uuid",
  "itemCode": "3.1.1",
  "description": "...",
  "sectionName": "...",
  "unit": "م³",
  "tenderQty": 200,
  "tenderAmount": 1500000
}]
```

> `tenderAmount` للحساب الداخلي فقط — **لا يُعرض** في الواجهة.

### اختبار API

| # | السيناريو | المتوقع |
|---|-----------|---------|
| 1 | صنف مربوط بـ 3 بنود | 3 صفوف |
| 2 | صنف غير مربوط | `[]` |
| 3 | بدون `contractId` | 400 |
| 4 | `GET /:boqItemId/allowed` القديم | لا يزال يعمل |

### فحص التعارض

- [ ] BOQ module — لا تغيير
- [ ] صلاحيات — `requirePermission('costs')`

---

## المرحلة 3 — تحقق خادم: POST متعدد الأسطر

**المدة:** 1 يوم · **المخاطر:** متوسطة

### الملفات

| ملف | العمل |
|-----|------|
| `server/src/modules/consumptionOrders.ts` | تعزيز `POST /` |
| `server/src/modules/inventoryHelpers.ts` | (اختياري) helper تحقق |

### قواعد `POST /api/consumption-orders`

| Rule | التنفيذ |
|------|---------|
| Σ qty لنفس `materialCategoryId` ≤ متاح المخزن | 400 |
| لا تكرار `boqItemId` في نفس الطلب | 400 |
| كل سطر: `assertBoqMaterialAllowed` | موجود |
| qty > 0 | موجود |
| أمر بسطر واحد (قديم) | 201 كما اليوم ✓ |

### Body مثال

```json
{
  "contractId": "...",
  "projectId": "...",
  "orderDate": "2026-06-15",
  "expenseAccountCode": "51101001",
  "expenseAccountName": "مواد البناء",
  "lines": [
    { "boqItemId": "a", "materialCategoryId": 5, "quantity": 20 },
    { "boqItemId": "b", "materialCategoryId": 5, "quantity": 30 }
  ]
}
```

### اختبار

| # | السيناريo | المتوقع |
|---|-----------|---------|
| 1 | 20+30، متاح 120 | 201 draft + 2 lines |
| 2 | تكرار `boqItemId` | 400 |
| 3 | qty 60، متاح 50 | 400 |

### فحص التعارض

- [ ] `confirm` — يمر على كل سطر (لا تغيير بعد)
- [ ] `returnOrders` — `consumptionOrderLineId` لكل سطر
- [ ] **لا migration**

---

## المرحلة 4 — الواجهة: Allocation Modal

**المدة:** 2–3 أيام · **المخاطر:** متوسطة

### الملفات

| ملف | العمل |
|-----|------|
| `src/components/inventory/ConsumptionOrderModal.tsx` | إعادة هيكلة |
| `src/components/inventory/ConsumptionAllocationModal.tsx` | **جديد** |
| `src/context/LanguageContext.tsx` | مفاتيح `consume_alloc_*` |

### تدفق UX

1. اختيار **الصنف** (من رصيد المشروع + مربوط بـ BOQ)
2. **الكمية الإجمالية** (`max = quantityAvailable`)
3. حساب المصروف · التاريخ · ملاحظات
4. زر **[توزيع على بنود BOQ]** → Allocation Modal
5. راديو: حسب كمية العقد | حسب قيمة العقد | (قالب — مرحلة 6)
6. جدول: ✓ | بند | كمية عقد | % | كمية موزعة
7. لوحة: **صادر / موزّع / متبقي**
8. حفظ → `create({ lines[] })` + `confirm`

### Validation Panel (إلزامي)

```
صادر: 100    موزّع: 100    متبقي: 0 ✓
المتاح في المخزن: 120
```

- زر «تأكيد» معطّل حتى `remaining === 0` و `allocated ≤ available`

### Golden Path 1 (يدوي)

- [ ] صرف 50 على 3 بنود (20+15+15)
- [ ] تبويب الصرف والإرجاع — 3 صفوف بنفس `CON-…`
- [ ] رصيد المخزن −50
- [ ] 3 سجلات في `boq_actual_costs`

### فحص التعارض

- [ ] `preselectedItem` من تبويب الرصيد
- [ ] كل النصوص عبر `t()` — لا hardcode ar/en
- [ ] Firestore — لا مس (local/API فقط)

---

## المرحلة 5 — GL ذري على الخادم ⚠️

**المدة:** 2 يوم · **المخاطر:** **عالية**

### الهدف

نقل ترحيل GL من الواجهة إلى `POST /:id/confirm` داخل `prisma.$transaction`.

### الملفات

| ملف | العمل |
|-----|------|
| `server/src/modules/consumptionOrders.ts` | confirm + GL |
| `server/src/accounting/consumptionJournal.ts` | **جديد** — بناء entries |
| `prisma/schema.prisma` | (اختياري) `transactionId` على `consumption_orders` |
| `src/services/accountingService.ts` | توسيع أو `recordConsumptionIssueMulti` |
| `src/components/inventory/ConsumptionOrderModal.tsx` | **حذف** استدعاء GL |
| `src/components/Inventory.tsx` | `handleConfirmDraft` — GL من الخادم |

### تسلسل داخل `$transaction`

```
1. assertProjectAccess
2. لكل سطر: assertBoqMaterialAllowed + رصيد
3. issueProjectInventory (Σ qty per material — مرة واحدة)
4. boq_actual_cost لكل سطر
5. createTransaction (GL) — idempotent by reference CON-…
6. status = confirmed
7. (اختياري) transactionId على الأمر
```

### Idempotency

- مرجع `CON-…` موجود → لا قيد مكرر (`journal.ts`)
- confirm مرتين → `Cannot confirm from status: confirmed`

### Golden Path 2 — GL

- [ ] قيد واحد `CON-…` في General Ledger
- [ ] 3 Dr + 1 Cr متوازن
- [ ] `costCenterId` = contractId
- [ ] لا استدعاء GL من Network tab (المتصفح)

### Golden Path 3 — توافق قديم

- [ ] أمر confirmed قديم بسطر واحد — يظهر كما هو
- [ ] مسودة قديمة — confirm من التاريخ → GL صحيح
- [ ] إرجاع من سطر قديم — يعمل

### اختبار وحدة

```powershell
npm run test -- src/services/accountingService.test.ts
```

- [ ] حالة جديدة: عدة Dr + Cr واحد

### ⚠️ مخاطر حرجة

| الخطر | الوقاية |
|-------|---------|
| قيد GL مزدوج (client + server) | حذف GL من Modal **قبل** تفعيل server |
| confirm بدون GL من التاريخ | تحديث `handleConfirmDraft` مع هذه المرحلة |

---

## المرحلة 6 — قوالب التوزيع

**المدة:** 1–1.5 يوم · **المخاطر:** منخفضة · **اختياري للإنتاج الأول**

### Migration

```prisma
model ConsumptionAllocationTemplate {
  id                 Int      @id @default(autoincrement())
  contractId         String   @map("contract_id")
  materialCategoryId Int      @map("material_category_id")
  name               String?
  basis              String   // boq_qty | boq_value | manual
  weightsJson        String   @map("weights_json")
  createdBy          String   @map("created_by")
  createdAt          DateTime @default(now()) @map("created_at")

  @@index([contractId, materialCategoryId])
  @@map("consumption_allocation_templates")
}
```

### API

```
GET    /api/consumption-allocation-templates?contractId&materialCategoryId
POST   /api/consumption-allocation-templates
DELETE /api/consumption-allocation-templates/:id
```

### UX

- [x] «حفظ كقالب» من Allocation Modal
- [x] راديو «قالب محفوظ» → تطبيق نسب

### اختبار

- [x] حفظ 40:35:25 → على 100 → 40+35+25 (`allocateByPercentages` unit test)
- [ ] حذف قالب لا يؤثر على أوامر confirmed

---

## المرحلة 7 — تحسين عرض التاريخ

**المدة:** 0.5–1 يوم · **المخاطر:** منخفضة (تجميلي)

### الملفات

| ملف | العمل |
|-----|------|
| `src/components/Inventory.tsx` | `ConsumptionHistory` — تجميع صفوف نفس `orderNumber` |

- [x] أمر 3 أسطر — عرض مجمّع أو rowspan على رقم الأمر

---

## المرحلة 8 — Regression شامل

### A) CI

```powershell
npm run test:consumption
npm run test -- src/lib/liquidityMetrics.test.ts
npm run local:verify-postgres
```

- [x] `npm run test:consumption` — **17** حالة
- [x] `npm run local:verify-postgres` — multi-line CON + GL balance (مثال: `CON-20260615-0014`)
- [x] G2 يدوي — مؤكد من المستخدم («يعمل بكفاءة»)

### B) Golden Paths (يدوي — `npm run dev:local`)

| # | المسار | ⬜ |
|---|--------|-----|
| G1 | فاتورة مشتريات → مخزون | |
| G2 | صرف متعدد البنود → مخزون + BOQ + GL | |
| G3 | إrجاع جزئي لبند واحد | |
| G4 | مسودة → confirm من التاريخ | |
| G5 | صرف بند واحد (سلوك قديم) | |
| G6 | BOQ Analysis / Actual Costs | |
| G7 | Reports — Trial Balance (51101 + 127) | |
| G8 | Reports — Income Statement | |
| G9 | Dashboard KPIs | |
| G10 | `project_accountant` — صلاحيات project | |

### C) استعلامات SQL (بعد G2)

```sql
-- توازن GL
SELECT t.reference,
       SUM(e.debit::numeric) AS dr,
       SUM(e.credit::numeric) AS cr
FROM transactions t
JOIN journal_entries e ON e.transaction_id = t.id
WHERE t.reference = 'CON-YYYYMMDD-NNNN'
  AND t.is_deleted = false
GROUP BY t.reference;

-- BOQ actual = مجموع أسطر الأمر
SELECT SUM(total_cost::numeric)
FROM boq_actual_costs
WHERE consumption_order_id = <order_id>;

-- مخزون
SELECT quantity_balance, quantity_issued
FROM project_inventory
WHERE project_id = '<pid>' AND material_category_id = <mid>;
```

### D) مصفوفة التعارض

| المكوّن | التأثير المتوقع | ⬜ |
|---------|-----------------|-----|
| `returnOrders` | `consumptionOrderLineId` — لا تغيير | |
| `inventoryMaintenance/purge` | لا تغيير | |
| `Reports.tsx` | GL + boq_actuals — أرقام صحيحة | |
| `ActualCosts.tsx` | لا مس مباشر | |
| `liquidityMetrics` | لا مس | |
| `GeneralLedger.tsx` | قيد متعدد الأسطر — نفس المجموع | |
| Railway deploy | `prisma migrate deploy` | |

---

## المرحلة 9 — نشر + توثيق

- [x] `npx prisma migrate deploy` — `20260615081500_add_consumption_allocation_templates`
- [ ] Railway redeploy (يدوي — `git push` يشغّل migrate تلقائياً)
- [x] تحديث `CLAUDE.md` — قسم Consumption Order
- [x] توسيع `verifyPostgresGoldenPaths.ts` — multi-line CON + GL balance
- [x] `npm run test:consumption` — 17+ اختبار وحدة

---

## معايير القبول النهائية

- [x] صنف واحد → عدة بنود BOQ في أمر واحد
- [x] توزيع حسب كمية العقد
- [x] توزيع حسب قيمة العقد (بدون عرض قيم)
- [x] قوالب حفظ/استدعاء
- [x] منع الحفظ عند `allocated ≠ issued`
- [x] منع تجاوز الرصيد
- [x] GL: عدة Dr + Cr واحد، متوازن، `reference = CON-…`
- [x] `costCenterId = contractId` (وليس BOQ)
- [x] `boq_actual_costs` لكل بند
- [x] إرجاع جزئي لسطر واحد (per `consumptionOrderLineId` — بدون تغيير)
- [x] أوامر قديمة تعمل بدون كسر
- [x] `npm run test:consumption` PASS

---

## ما **لا** يُنفَّذ (رفض صريح)

| البند | السبب |
|-------|--------|
| جدول `consumption_order_allocations` | مكرر مع `consumption_order_lines` |
| `cost_center_id = boqItemId` في GL | يخالف نموذج التطبيق |
| FIFO | المشروع يستخدم `avgUnitCost` |
| حسابات GL جديدة | غير مطلوب |

---

## PRs مقترحة

| PR | المراحل | ملاحظة |
|----|---------|--------|
| PR-1 | 1 + 2 + 3 | API + tests — بدون UI |
| PR-2 | 4 | UI — confirm بدون GL server مؤقتاً |
| PR-3 | 5 | GL ذري — **مراجعة محاسبية** |
| PR-4 | 6 + 7 | قوالب + عرض |
| PR-5 | 8 + 9 | regression + docs |

---

## مراجع

- `server/src/modules/consumptionOrders.ts`
- `src/components/inventory/ConsumptionOrderModal.tsx`
- `src/services/accountingService.ts` → `recordConsumptionIssue`
- `src/components/billing/MosExtractModal.tsx` — نمط جدول متعدد البنود
- `docs/PROJECT_WAREHOUSE_WORKPLAN_AR.md` — مخازن المشاريع

---

*آخر تحديث: 2026-06-15 — مراحل 1–9 ✅*
