# ميزة مستخلص التشوينات (Material On-Site — MOS)

## السياق

هذا تطبيق إدارة تكاليف مقاولات يعمل بـ:
- **Frontend:** React 19 + TypeScript + Tailwind v4 + Vite 6
- **Cloud:** Firebase Firestore + Auth
- **Local backend:** Express (TypeScript) + SQLite (`better-sqlite3`) — يعمل على المنفذ 3001
- **وضع التشغيل:** `VITE_DATA_BACKEND=local`

---

## المفهوم التجاري — اقرأه جيداً قبل أي كود

**مستخلص التشوين (MOS)** = توريد خامات للموقع قبل تركيبها. عند توريد الخامة يحق للشركة تقديم مستخلص تشوين تستحق بموجبه **نسبة متفاوضة** (مثلاً 60%) من **قيمة البند** في BOQ — وليس من قيمة الخامة نفسها.

### منطق الكميات المتراكمة

التشوين لا يُعامَل كبند مستقل. يُحسب على أنه **كمية معادلة** تُضاف إلى `previous_quantity` في المستخلصات اللاحقة للبند نفسه:

```
البند X: 100 وحدة × 1,000 ج = 100,000 ج

مستخلص تشوين:
  الكمية الموردة        = 100 وحدة
  نسبة الصرف           = 60%
  الكمية المعادلة       = 60 وحدة  ← تُحفظ وتُستخدم لاحقاً كـ "سابق"

مستخلص تنفيذ رقم 1 (بعد تركيب 70 وحدة):
  الكمية المنفذة حتى الآن   = 70 وحدة
  الكمية السابقة             = 60 وحدة  ← من التشوين
  الكمية في هذا المستخلص    = 10 وحدة
  القيمة                     = 10,000 ج

مستخلص تنفيذ رقم 2 (بعد تركيب 100 وحدة):
  الكمية المنفذة حتى الآن   = 100 وحدة
  الكمية السابقة             = 70 وحدة  ← (60 تشوين + 10 تنفيذ)
  الكمية في هذا المستخلص    = 30 وحدة
```

الخصم يحدث **تلقائياً** لأن الكمية المعادلة تدخل في حساب `previous_quantity`، ولا حاجة لجدول خصم منفصل.

---

## ما يجب تنفيذه — خطوة بخطوة

---

### الخطوة 1 — Migration SQLite (014)

أنشئ الملف:
`server/sqlite/migrations/014_material_on_site_extracts.sql`

```sql
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

  transaction_id      INTEGER,               -- id القيد في جدول transactions
  created_by          TEXT,
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_mos_contract    ON material_on_site_extracts(contract_id);
CREATE INDEX IF NOT EXISTS idx_mos_boq_item    ON material_on_site_extracts(boq_item_id);
CREATE INDEX IF NOT EXISTS idx_mos_status      ON material_on_site_extracts(status);
CREATE INDEX IF NOT EXISTS idx_mos_firestore   ON material_on_site_extracts(firestore_id);
```

**تسجيل Migration:**
في `server/src/db.ts` (أو الملف الذي يُشغّل migrations) أضف `014_material_on_site_extracts.sql` إلى قائمة الـ migrations بنفس نمط الإدراج المستخدم لـ 013.

---

### الخطوة 2 — نوع TypeScript مشترك

في `src/types.ts` أضف:

```typescript
export interface MosExtract {
  id: string;
  firestoreId?: string;
  contractId: string;
  boqItemId: string;

  suppliedQuantity: number;
  onSitePercentage: number;
  equivalentQuantity: number;
  unitPrice: number;
  claimedAmount: number;

  deliveryNoteRef?: string;
  extractNumber?: string;
  extractDate?: string;
  notes?: string;

  status: 'draft' | 'approved' | 'superseded';
  transactionId?: number;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;

  // حقول مُدمجة من Firestore (للعرض فقط)
  boqItemDescription?: string;
  boqItemUnit?: string;
}
```

---

### الخطوة 3 — Firestore collection: `material_on_site`

**لا تُعدّل** collection `billing` الموجودة. أنشئ collection مستقلة.

نوع المستند في Firestore:
```typescript
// src/types.ts — أضف
export interface MosFirestoreDoc {
  contractId: string;
  boqItemId: string;
  boqItemDescription?: string;
  boqItemUnit?: string;

  suppliedQuantity: number;
  onSitePercentage: number;
  equivalentQuantity: number;
  unitPrice: number;
  claimedAmount: number;

  deliveryNoteRef?: string;
  extractNumber?: string;
  extractDate?: string;
  notes?: string;

  status: 'draft' | 'approved' | 'superseded';
  sqliteId?: string;       // id في SQLite بعد الاعتماد
  transactionId?: number;  // قيد GL

  createdBy?: string;
  createdAt?: Timestamp | Date | string;
  updatedAt?: Timestamp | Date | string;
  isDeleted?: boolean;
}
```

---

### الخطوة 4 — API Backend

أنشئ `server/src/modules/mosExtracts.ts`

**القواعد العامة قبل الكود:**
- استخدم `requireAuth` و `requirePermission` من `server/src/middleware/auth.ts`
- صلاحية القراءة: `billing` أو `costs`
- صلاحية الإنشاء/التعديل: `billing`
- صلاحية الاعتماد: `role === 'admin' || role === 'projects_manager'` — استخدم `requireRole(['admin','projects_manager'])`
- لا تستخدم `any` — استخدم أنواع صريحة
- كل عملية تُغيّر الـ `status` يجب أن تُحدّث `updated_at`

**Endpoints:**

```typescript
// GET /api/mos-extracts?contractId=&boqItemId=&status=
// يُرجع قائمة مستخلصات التشوين مع فلترة اختيارية

// POST /api/mos-extracts
// body: { firestoreId, contractId, boqItemId, suppliedQuantity,
//         onSitePercentage, unitPrice, deliveryNoteRef?, extractDate?, notes? }
// يحسب تلقائياً: equivalentQuantity = suppliedQuantity × onSitePercentage / 100
//                claimedAmount = equivalentQuantity × unitPrice
// يُولّد extractNumber: MOS-YYYY-NNN (تسلسلي من آخر رقم في نفس السنة)
// status = 'draft'

// POST /api/mos-extracts/:id/approve
// - يتحقق من role (admin أو projects_manager فقط)
// - يُنشئ قيد GL في SQLite transactions:
//   Dr 12201001 (RECEIVABLES) × claimedAmount
//   Cr 41101001 (REVENUE)     × claimedAmount
//   reference = extractNumber, description = 'تشوين - ' + boqItemDescription
//   costCenterId = contractId
// - يُحدّث status → 'approved' + transaction_id
// - يُحدّث Firestore doc (sqliteId + transactionId + status) عبر Admin SDK
//   ملاحظة: إذا لم يكن Admin SDK متاحاً في Express، أرجع sqliteId وdعه الـ frontend يُحدّث Firestore

// GET /api/mos-extracts/boq-summary?boqItemId=&contractId=
// يُرجع: { totalEquivalentQty, approvedCount, items: MosExtract[] }
// يُستخدم من الـ frontend لحساب previous_quantity
```

**توليد `extractNumber`:**
```typescript
// داخل POST /api/mos-extracts
const year = new Date().getFullYear();
const lastRow = db.prepare(
  `SELECT extract_number FROM material_on_site_extracts
   WHERE extract_number LIKE 'MOS-${year}-%'
   ORDER BY extract_number DESC LIMIT 1`
).get() as { extract_number: string } | undefined;

let seq = 1;
if (lastRow) {
  const parts = lastRow.extract_number.split('-');
  seq = parseInt(parts[parts.length - 1], 10) + 1;
}
const extractNumber = `MOS-${year}-${String(seq).padStart(3, '0')}`;
```

**سجّل الـ router في `server/src/app.ts`:**
```typescript
import mosExtractsRouter from './modules/mosExtracts';
app.use('/api/mos-extracts', mosExtractsRouter);
```

---

### الخطوة 5 — Client API Wrapper

في `src/services/local/modulesApi.ts` أضف:

```typescript
export const mosExtractsApi = {
  list: (params: { contractId?: string; boqItemId?: string; status?: string }) =>
    localApi.get<MosExtract[]>('/mos-extracts', { params }),

  create: (data: {
    firestoreId?: string;
    contractId: string;
    boqItemId: string;
    suppliedQuantity: number;
    onSitePercentage: number;
    unitPrice: number;
    deliveryNoteRef?: string;
    extractDate?: string;
    notes?: string;
  }) => localApi.post<MosExtract>('/mos-extracts', data),

  approve: (id: string) =>
    localApi.post<MosExtract>(`/mos-extracts/${id}/approve`, {}),

  boqSummary: (boqItemId: string, contractId: string) =>
    localApi.get<{ totalEquivalentQty: number; approvedCount: number; items: MosExtract[] }>(
      '/mos-extracts/boq-summary',
      { params: { boqItemId, contractId } }
    ),
};
```

---

### الخطوة 6 — تعديل حساب `previous_quantity` في `Billing.tsx`

**هذا هو التعديل الأكثر أهمية** — يجب التعامل معه بحذر شديد.

في `Billing.tsx`، حيث يُحسب `previousQty` لكل بند BOQ عند إنشاء/عرض مستخلص:

**ابحث عن المنطق الحالي الذي يحسب الكمية السابقة** من مستخلصات `billing` المعتمدة.

**أضف بجانبه:**

```typescript
// في useMemo أو useEffect المسؤول عن تجميع بيانات البنود
// بعد تحميل billing docs الحالية

// جلب مجموع التشوينات المعتمدة لكل بند في العقد الحالي
const [mosEquivalentMap, setMosEquivalentMap] = useState<Record<string, number>>({});

useEffect(() => {
  if (!selectedContractId || !isLocalBackend) return;
  mosExtractsApi
    .list({ contractId: selectedContractId, status: 'approved' })
    .then(items => {
      const map: Record<string, number> = {};
      for (const item of items) {
        map[item.boqItemId] = (map[item.boqItemId] || 0) + item.equivalentQuantity;
      }
      setMosEquivalentMap(map);
    })
    .catch(() => {}); // لا تكسر الـ UI إذا فشل الجلب
}, [selectedContractId]);

// عند حساب previousQty لكل بند:
const previousQty = (existingBillingQty ?? 0) + (mosEquivalentMap[boqItemId] ?? 0);
```

**قاعدة مهمة:** لا تُعدّل الـ `billing` Firestore collection أو منطق الـ IPC الحالي. أضف `mosEquivalentMap` كطبقة إضافية فقط.

---

### الخطوة 7 — واجهة المستخدم: نافذة مستخلصات التشوين

أنشئ `src/components/MosExtracts.tsx`

**الهيكل العام:**

```
MosExtracts (نافذة كاملة كباقي النوافذ)
├── فلتر: اختيار المشروع → العقد
├── زر: + مستخلص تشوين جديد → فتح MosExtractModal
├── جدول المستخلصات (مع حالة كل مستخلص)
└── زر اعتماد (للـ admin / projects_manager فقط)
```

**`MosExtractModal` (نموذج الإنشاء):**

```
اختيار بند BOQ (SearchableSelect من boq_items للعقد المحدد)
  ↓ عند الاختيار: يظهر تلقائياً
    - وحدة القياس
    - سعر الوحدة (من BOQ)
    - إجمالي التشوينات السابقة المعتمدة للبند (من mosEquivalentMap)

الكمية الموردة   [input رقمي]
نسبة الصرف %    [input رقمي] ← قابل للتعديل
─────────────────────────────
الكمية المعادلة  = [محسوبة تلقائياً = الكمية × النسبة / 100]
المبلغ المستحق  = [محسوبة تلقائياً = الكمية المعادلة × سعر الوحدة]

مرجع إذن الاستلام [نص]
تاريخ التشوين    [date]
ملاحظات          [textarea]
```

**قواعد الـ UI:**
- استخدم `useLanguage()` لكل النصوص — لا نصوص مضمّنة
- استخدم نفس مكونات الـ UI الموجودة في التطبيق (SearchableSelect، Modal pattern من ActualCosts أو Inventory)
- استخدم `useUserAccessScope()` لإخفاء زر الاعتماد عن غير المفوّضين
- أضف loading state على زر الاعتماد
- بعد الاعتماد: أعد تحميل القائمة + أعرض toast نجاح

---

### الخطوة 8 — تسجيل النافذة في النظام

**في `src/constants/modules.ts`:**
```typescript
// أضف في STARTUP_MODULES وMODULE_LABELS
'mos_extracts': 'مستخلصات التشوين'
// أو ما يتناسب مع نمط الملف الحالي
```

**في `src/components/Sidebar.tsx` (أو الملف المسؤول عن القائمة):**
أضف عنصر للنافذة الجديدة مع أيقونة مناسبة (مثلاً `PackageCheck` من lucide-react) وضع الصلاحية `billing.view`.

**في `WindowManager.tsx`:**
```typescript
const MosExtracts = React.lazy(() => import('./components/MosExtracts'));
// أضفها ضمن الـ switch/map الحالي للنوافذ
```

---

### الخطوة 9 — Firestore Rules

في `firestore.rules` أضف قواعد لـ collection `material_on_site`:

```
// اقرأ النمط الحالي لـ billing ثم طبّق نفسه
match /material_on_site/{docId} {
  allow read: if isAuth() && (canModuleUse('billing') || canModuleUse('costs'));
  allow create: if isAuth() && crudPermCreate('billing');
  allow update: if isAuth() && (
    crudPermEdit('billing') ||
    isAdminOrPM()  // للاعتماد
  );
  allow delete: if false; // soft delete فقط
}
```

استخدم نفس helper functions الموجودة في `firestore.rules` الحالي.

---

## قواعد لا تُخالف

### 1. قواعد الكود العامة

- **لا `any`** في أي مكان — استخدم أنواع TypeScript صريحة
- **لا نصوص مضمّنة** في JSX — كل النصوص عبر `t('key')` من `useLanguage()`
- **`listenQuery` / `listenDoc`** بدلاً من `onSnapshot` مباشرةً في المكونات
- **`useFirestoreQuery`** لقراءات Firestore في المكونات الجديدة
- **Soft delete فقط** — لا `deleteDoc()` مباشرةً — استخدم `isDeleted: true`
- **`writeBatch`** لأي عملية تكتب في أكثر من collection واحدة
- **لا `undefined`** في Firestore payloads — استخدم `null` أو احذف الحقل

### 2. القيد المحاسبي — ثوابت

```typescript
// في server/src/modules/mosExtracts.ts — عند approve
// استخدم account codes من AccountCodes enum (لا hardcode)
// Dr 12201001 RECEIVABLES
// Cr 41101001 REVENUE
// reference = extractNumber (مثلاً MOS-2026-001)
// description = 'تشوين - ' + boqItemDescription
// costCenterId = contractId
// projectId = يُحلَّل من contracts table (SELECT project_id FROM contracts WHERE id = ?)
```

### 3. لا تُعدّل هذه الملفات إلا بتعديلات صغيرة محددة

| الملف | التعديل المسموح فقط |
|-------|---------------------|
| `Billing.tsx` | إضافة `mosEquivalentMap` لحساب `previous_quantity` فقط |
| `src/types.ts` | إضافة interfaces جديدة فقط |
| `src/services/local/modulesApi.ts` | إضافة `mosExtractsApi` فقط |
| `src/constants/modules.ts` | إضافة `mos_extracts` فقط |
| `server/src/app.ts` | تسجيل الـ router الجديد فقط |
| `firestore.rules` | إضافة قواعد `material_on_site` فقط |

### 4. لا تُعدّل إطلاقاً

- `accountingService.ts` — لا تُضف دوال جديدة هنا (القيد يتم في backend)
- `billing` Firestore collection — لا تُضف حقول أو وثائق من نوع جديد فيها
- أي migration موجود (001–013) — أنشئ 014 فقط
- منطق الـ IPC الحالي في `ActualCosts.tsx`
- `subcontractor.ts` backend

### 5. تسلسل التنفيذ الإلزامي

```
1. Migration 014 (SQL فقط، لا كود)
2. Types في src/types.ts
3. Backend module + تسجيله في app.ts
4. Client API wrapper في modulesApi.ts
5. تعديل Billing.tsx (mosEquivalentMap فقط)
6. MosExtracts.tsx + MosExtractModal
7. تسجيل النافذة في modules.ts + WindowManager.tsx + Sidebar
8. Firestore rules
```

---

## اختبار بسيط بعد التنفيذ

1. شغّل `npm run dev:local`
2. افتح نافذة مستخلصات التشوين
3. أنشئ مستخلص تشوين لبند BOQ موجود (الكمية 100، النسبة 60%)
4. تحقق أن `equivalent_quantity = 60`
5. اعتمد المستخلص (بحساب admin أو projects_manager)
6. تحقق من وجود القيد في دفتر اليومية (Dr 12201001 / Cr 41101001)
7. افتح نافذة المستخلصات (`Billing.tsx`) للعقد نفسه
8. تحقق أن البند X يظهر `previous_quantity = 60` قبل إدخال أي كمية تنفيذ
