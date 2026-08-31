# سياق مشروع web-cost-app
**آخر تحديث:** 2026-08-31 (إصلاح إقلاع التطبيق — لا تستورد costCenterAttribution من serviceContractor)

> **قبل أي إصلاح أو تحسين:** راجع **`CLAUDE.md`** · **`DEPLOYMENT_PLAN.md`** · **`docs/DEVELOPER_GUIDE.md`** — ثم **حدّث هذه الملفات** بعد نجاح التنفيذ.
>
> للتفاصيل التقنية الكاملة (قواعد الكود، أكواد الحسابات، المكونات): **`CLAUDE.md`** هو المرجع المعماري.

---

## 1. نظرة عامة

تطبيق ويب لإدارة تكاليف المقاولات — **الوضع الحالي:** Postgres مركزي + Firebase Auth.

| الطبقة | التقنية | الغرض |
|---|---|---|
| Frontend | React 19 + Vite 6 + TypeScript + Tailwind v4 | shell (نوافذ / ERP)، ثيمات **dark · soft · light · erp**، ar/en |
| مصدر الحقيقة (local/Railway) | **PostgreSQL + Prisma** | تشغيل + نواة مالية |
| Firebase | Auth + Firestore (legacy/cloud) | Google sign-in؛ سحابة legacy عند عدم `VITE_DATA_BACKEND=local` |
| Backend API | Express `:3001` | CRUD، صلاحيات، OHA، رواتب، push-to-production |
| SQLite legacy | migrations 001–013 | **معطّل في الإنتاج** — لا ميزات جديدة |

**الوضع المحلي (`VITE_DATA_BACKEND=local`):** `npm run dev:local` — Postgres = مصدر الحقيقة.

**Shell:** موديول واحد (`shellWindowPolicy.ts`)؛ الآلة الحاسبة استثناء. ERP = `TopNavBar` + `ErpWorkspace`.

**جلسة:** لا toast للموقع الجغرافي عند الدخول (`useActivitySession`). الخمول بعد **3 دقائق** على مستوى **الجهاز** (Electron `powerMonitor`) → شاشة دخول باسم المستخدم **مع كلمة المرور** (التطبيق لا يُغلق؛ النوافذ تبقى تحت القفل). المتصفح/قشرة قديمة: نشاط النافذة فقط. يُيقاف أثناء الانقطاع أو مسودة/طابور (`idleGate`). `mousemove`/`scroll`/`wheel` في وضع النافذة مُقيَّدة بـ **1 ثانية**.

**API (2026-08-22):** إنتاج يرفض CORS إن لم يُضبط `CORS_ORIGIN` / `RAILWAY_PUBLIC_DOMAIN`. جسم JSON الافتراضي 2mb (استيراد النسخة 50mb). معدل محاولات الدخول يعتمد على `req.ip` وليس ترويسة `X-Forwarded-For`.

**تحديث Railway (Electron):** حوار أصلي في القشرة **الآن أو لاحقاً** (لاحقاً = الافتراضي). إعادة تحميل SPA **ليست** cold start — تبقى كوكيز الجلسة (`keepSessionOnLoad` + `DESKTOP_WINDOW_SESSION_KEY`). 401 أثناء النشر → إعادة تحقق ثم قفل كلمة مرور (لا إغلاق التطبيق). إغلاق **معاينة الطباعة** لا يُعيد تحميل النافذة كبداية باردة (Blob iframe + حراسة `about:blank` في القشرة). قشرة **≥ 1.0.9** عبر `electron:publish`.

**Offline sync (محلي/ريلواي):** مسودات نماذج في IndexedDB + طابور إرسال (`safe_save` تلقائي · `confirm_required` بمراجعة يدوية) — شريط حالة + `PendingSyncPanel`. يشمل المشتريات/التكاليف/البنوك/المخزون/الرواتب/الأصول/**BOQ·VO**/GL. مفاتيح: `src/lib/offline/`. دليل: موضوع `tools.offline.sync`.

**إدخال شبيه بإكسل (2026-08-08):** عند التركيز على حقل نص/رقم يُحدَّد المحتوى بالكامل (الكتابة تستبدل القيمة). الأسهم ←→↑↓ تنتقل بين الحقول (جداول + أقرب حقل مكانياً داخل dialog/`fixed inset-0` فقط — بدون مسح `#root`)؛ **لا** تغيّر قيمة `type=number`. التثبيت من `main.tsx` عبر `installExcelLikeInputBehavior()` (`src/lib/excelLikeInputs.ts`). استثناء: `data-excel-nav="off"`.

**تفكيك ActualCosts / Inventory (2026-08-08):** مكونات عرضية تحت `actualCosts/` و`inventory/` (قوائم · محررات بنود · مودالات صغيرة · طباعة صرف · استيراد افتتاحي) مع `memo`/`useCallback` — مسارات الكتابة المحاسبية والمخزنية تبقى في الـ parent.

---

## 2. بنية المجلدات (مختصرة)

```
web-cost-app/
├── src/
│   ├── components/
│   │   ├── Projects.tsx          # مشاريع — بطاقات memo + ميزانية من حقول المشروع (لا all-BOQ)
│   │   ├── projects/             # ProjectCard · ProjectFormModal (state محلي)
│   │   ├── BOQ.tsx               # parent — حفظ/VO/استيراد؛ صفوف عبر BoqItemRow
│   │   ├── boq/                  # Item/Contract forms · BoqItemRow · boqRowViewModel · VO · DeleteBlocked
│   │   ├── MaterialsTree.tsx   # مجموعات/أصناف + تصدير/استيراد Excel
│   │   ├── Inventory.tsx       # مخازن — parent؛ تبويبات + اعتماد تحويلات / ربط 127
│   │   ├── inventory/          # أوراق: تحويل مشروع · حركات · دليل · طباعة صرف · استيراد افتتاحي · …
│   │   ├── ActualCosts.tsx     # تكاليف — parent (حفظ/اعتماد/GL)؛ UI في actualCosts/
│   │   ├── actualCosts/        # قائمة · بنود فاتورة · شبكة IPC · مودالات صغيرة · بانر مخزون
│   │   ├── FixedAssets.tsx     # سجل أصول · إهلاك · قوائم 119/52/مركز تكلفة
│   │   ├── GeneralSettings.tsx # سمة، لغة، شاشة البداية، طباعة (admin)
│   │   ├── Settings.tsx        # إعدادات النظام — admin sections عبر usePermissions().isAdmin
│   │   ├── Calculator.tsx      # آلة حاسبة (ت coexist مع موديول واحد)
│   │   ├── TopNavBar.tsx       # ERP — قوائم + canOpenModuleView
│   │   ├── ErpWorkspace.tsx    # ERP — slot موديول واحد
│   │   ├── Banks.tsx           # بنوك — حسابات · حركات · شيكات · كشوف · كشف حساب GL
│   │   └── banks/
│   │       ├── BankChequesTab.tsx      # شيكات — رصيد بنك + طرف مقابل (GlAccountBalanceHint)
│   │       └── BankMovementsTab.tsx    # تحويل/إيداع/سحب — نفس تلميحات الرصيد
│   ├── lib/
│   │   ├── shellWindowPolicy.ts    # سياسة موديول واحد (كل الثيمات)
│   │   ├── glAccountBalance.ts     # buildGlAccountBalanceMap — أرصدة GL لتلميحات البنوك
│   │   ├── shellNavigation.ts      # resolveSavedDefaultModulePreference · «none» ≠ ledger · pending views/focus
│   │   ├── notificationNavigation.ts # bell → module/view + permission gate
│   │   ├── userPreferences.ts      # saveUserPreferences · canPersistUserPreferences · USER_PREFS_UPDATED_EVENT
│   │   ├── moduleViewPermissions.ts # SETTINGS_ADMIN_VIEW_IDS · canOpenModuleView
│   │   ├── dataBackend.ts          # isLocalBackend — local أو prod+/api
│   │   ├── utils.ts                # listKey · compositeListKey — مفاتيح React آمنة (لا key="")
│   │   ├── boqPricing.ts           # tenderAmountExcludingProfit — تكلفة BOQ تقديرية للتقارير
│   │   ├── chartOfAccountsPicker.ts # chartLeafAccountOptions — pickers 8-digit
│   │   ├── glBilingual.ts          # كشف الحساب: resolveEntrySide + الحساب المقابل = الطرف المعاكس فقط
│   │   ├── materialsTreeExcel.ts
│   │   ├── inventoryOpeningExcel.ts  # قالب/استيراد أرصدة مخزون افتتاحية
│   │   ├── spaBuild.ts               # كشف نشر Railway + تطبيق التحديث من الجرس
│   │   ├── firestoreListen.ts
│   │   └── permissions.ts
│   ├── hooks/                  # useFirestoreQuery, useUserAccessScope, useGlAccountBalances (Banks)
│   ├── services/local/modulesApi.ts
│   └── constants/modules.ts    # STARTUP_MODULES, normalizeDefaultModule()
├── server/
│   ├── src/modules/
│   │   ├── materials.ts        # + POST /import
│   │   ├── boqMaterials.ts
│   │   ├── consumptionOrders.ts
│   │   ├── inventory.ts              # + `/inventory/project-transfers` · `POST …/opening-import`
│   │   ├── projectInventoryTransfers.ts
│   │   ├── inventoryTransfers.ts     # legacy عقود
│   │   ├── ensureLocalProject.ts     # مرآة مشروع Firestore → SQLite
│   │   ├── accounting/projectWarehouseGl.ts
│   │   ├── accounting/openingInventoryJournal.ts  # قيد أرصدة افتتاحية Dr 127 / Cr 31401001
│   │   ├── accounting/returnInventoryJournal.ts   # قيد مرتجع متعدد: Dr 127 / Cr مصروف (مجموعات)
│   │   ├── sqliteCore.ts
│   │   ├── purchaseTransactions.ts   # purchase_transactions + items؛ IPC `POST /:id/approve`
│   │   ├── custodySettlements.ts     # custody_settlements + `POST /:id/approve` (GL عند الاعتماد)
│   │   └── subcontractor.ts
│   └── sqlite/migrations/      # 001 → 013 (legacy — الإنتاج Postgres)
├── prisma/schema.prisma        # 43+ جدول — مصدر الحقيقة
├── CLAUDE.md                   # مرجع المطور (إنجليزي)
├── CONTEXT.md                  # هذا الملف
├── DEPLOYMENT_PLAN.md          # نشر Railway · حالة التقدّم
└── docs/DEVELOPER_GUIDE.md     # دليل المطوّر (ar)
```

---

## 3. جداول SQLite (migrations 001–012)

### 001 — القلب المالي (أساس)
`purchase_invoice_lines`, `purchase_invoice_allocations`, `contract_inventory`, `inventory_transfers`, `inventory_transfer_lines`, `subcontractors`, `subcontract_assignments`, `subcontract_extracts`, …

### 002 — تشغيل + مصادقة
`users`, `sessions`, `projects`, `contracts`, `boq_items`, `billing`, `transactions`, …

### 003 — ربط BOQ + عقود المستخدم
`boq_item_id` على بنود الفاتورة، `assigned_contract_ids` على المستخدمين.

### 004 — شجرة أصناف + مخزون v2 + أوامر صرف
| الجدول | الغرض |
|---|---|
| `material_groups` / `material_categories` | شجرة الأصناف (مجموعة → صنف + وحدة) |
| `boq_item_materials` | الأصناف المسموح صرفها لكل بند BOQ |
| `purchase_invoices` | رأس فاتورة موزعة (`draft` / `confirmed` / `posted`) |
| `project_inventory` | **مخزن المشروع المركزي** per `project_id` + `material_category_id` |
| `project_inventory_movements` | سجل حركات (وارد / صرف / مرتجع / حجز) |
| `return_orders` / `return_order_lines` | إذن إرجاع من الموقع إلى مخزن المشروع |
| `contract_inventory` | **Legacy** — ترحيل 009 إلى `project_inventory`؛ تحويلات عقود فقط |
| `consumption_orders` / `consumption_order_lines` | أوامر صرف (مسودة → تأكيد) من مخزن المشروع |
| `boq_actual_costs` | تكلفة فعلية على BOQ: صرف (`materials`) · مصروف عقد (`other`) · مستخلص باطن عند الاعتماد (`subcontractor`) · عهدة مربوطة اختيارياً (`custody`) · OHA (`overhead`) — تقارير؛ Dashboard يستخدم `materials` فقط عبر spent-by-contract |

> **`inventory_consumption`** (قديم): استُبدل بمسار **`consumption-orders`** — لا تستخدم `POST /api/inventory/consume`.

### 010 — حساب مصروف أمر الصرف
`consumption_orders.expense_account_code` / `expense_account_name` (للقيد عند التأكيد من الواجهة).

### 011 — تحويلات مخزن المشروع
| الجدول | الغرض |
|---|---|
| `project_inventory_transfers` | رأس طلب (`PTRF-YYYYMMDD-NNNN`) — `pending_b` → `pending_projects` → `approved` |
| `project_inventory_transfer_lines` | بنود: `project_inventory_id`, كمية، تكلفة |

### 012 — ربط التحويل بالقيد
`project_inventory_transfers.transaction_id` → `transactions.id` (قيد SQLite عند الاعتماد النهائي).

---

## 4. نظام الصلاحيات

### مصدر الصلاحيات (2026-08-13)
الوصول = مربعات **عرض / إنشاء / تعديل** المخزّنة في `users.permissions` فقط. أسماء الأدوار (`admin` · `projects_manager` · `project_accountant` · `user`) باقية في العمود للتوافق ولا تمنح موديولات. إعدادات النظام (مستخدمون · نسخ احتياطي) = `settings: true`. العقود: قائمة فارغة = كل العقود.

### الأدوار (عمود قديم — لا يُستخدم للوصول)
| الدور | ملاحظة |
|---|---|
| `admin` / غيره | لا يُفتح منه مسار ولا اعتماد — استخدم JSON الصلاحيات |

### مفاتيح CRUD
`dashboard` | `ledger` | `projects` | `boq` | `billing` | `costs` | `suppliers` | `banks` | **`inventory`** | **`transfers`** | **`subcontractor`** | `reports` | `settings`

- قراءة/إنشاء تحويلات المشاريع: `inventory` **أو** `transfers` **أو** `costs`.
- اعتماد نهائي (`approve-projects`): **`inventory.edit`**.

### التطبيق
- Firestore Rules + `useUserAccessScope` + `requirePermission` على API المحلي.

### ظهور الموديولات في الواجهة (UI فقط — 2026-08-02)
- المدير يضبط لكل مستخدم قائمة `visibleShellModules` من **الإعدادات → المستخدمون**.
- التخزين: `settings` مفتاح `user_prefs:{userId}` (أو `users/{uid}` في cloud).
- يؤثر على Sidebar / TopNav / أوامر الشراء فقط — **لا** يغيّر الصلاحيات ولا عمليات API بين الموديولات المخفية.
- `null` / مفقود = إظهار كل الموديولات المسموحة. أدوات shell (`general` · `calculator` · `manual`) تبقى دائماً.

---

## 5. وحدات الواجهة الرئيسية

| الموديول | Firestore | SQLite (محلي) |
|---|---|---|
| **المشاريع** | `projects` | بطاقات: `boqValue`/`budget`+`voValue` (لا تحميل كل BOQ)؛ GL cap 2000؛ `ProjectCard`/`ProjectFormModal`؛ شعارات كفر IPC اختيارية (`coverLogoLeft|Center|Right` تتجاوز إعدادات الشركة عند الطباعة) |
| **BOQ** | `boq_items`, `billing` | state النماذج داخل المودالات؛ `BoqItemRow`+`boqRowViewModel`؛ rates · VO · مواد |
| **التكاليف الفعلية** | `purchase_transactions`, … | فاتورة → مخزن مشروع + GL `12701001` (لا مصروف 511 من الفاتورة) |
| **المخازن** | `chart_of_accounts` (ربط 127…) | أصناف · رصيد مشروع · **تحويل مشاريع** · صرف/إرجاع · legacy عقود (معلّق فقط) |
| **أوامر الشراء** | — | Postgres `purchase_requests` — متاح لكل المستخدمين · حالة فقط عند التنفيذ (لا فاتورة/GL) · BOQ: كود+وصف · إشعار `purchase_request_pending` + واتساب |
| **موازنة نقدية** | — | Postgres `cash_budget_periods` / `cash_budget_lines` — أرصدة GL حتى نهاية الفترة · **نسبة سداد المديونية** تحدد مبلغ التوزيع (min بنوك 12101، الالتزامات × ٪) · لا عهد/صناديق في المجمع · استعاضة إن قلّ 12102 عن الحد · جدول إجمالي لكل مشروع · **بدون قيد** |
| **البنوك** | `bank_*` + GL | حركات · شيكات · كشوف — **تلميح رصيد GL** تحت اختيار البنك/الطرف المقابل (2026-06-28) |
| **إعدادات العرض** | local: `settings/user-preferences` · cloud: `users/{uid}` | `GeneralSettings.tsx` — سمة · لغة · شاشة البداية (`none` مدعوم) · **طباعة (admin)** — Palette في الشريط |
| **نافذة Electron جديدة** | قشرة سطح المكتب فقط | زر بجانب الإعدادات العامة في Sidebar/TopNav + **Ctrl+N** (`input.code === 'KeyN'` — يعمل مع لوحة عربية) — `requestOpenNewWindow` · نفس `persist:webcost` |
| **الإعدادات (admin)** | cloud backup/users | `Settings.tsx` — مراكز غير مباشرة · سجل نشاط · بيانات تجريبية (admin فقط) · نوافذ عائمة متسلسلة (`SettingsFloatingDialog`) |
| **الآلة الحاسبة** | — | أداة مساعدة — **تبقى مفتوحة** مع موديول واحد (`SHELL_COEXIST_MODULE_IDS`) |

**سياسة shell (2026-06-26):** موديول رئيسي واحد في كل ثيم — فتح Ledger يغلق إعدادات العرض/الإعدادات. ERP: `ErpWorkspace` + overlays. راجع `shellWindowPolicy.ts`.

**أقسام الإعدادات (Settings):**

| viewId | من يراه | شرط إضافي |
|--------|---------|-----------|
| `database`, `users` | `settings` permission | — |
| `coa` | `settings` + `ledger.view` | — |
| `cost_centers` | **admin** | `isLocalBackend` |
| `activity`, `sample_data` | **admin** | — |

**لا تراجع:** استخدم `usePermissions().isAdmin` في `Settings.tsx` — لا `authApi.me()` منفصل للدور. ERP: `TopNavBar` يمرّر `{ isAdmin }` إلى `canOpenModuleView`.

**الوضع الافتراضي (2026-08-13):** مسح الوحدات بالمجموعات **لا** يحذف المشاريع/العقود/BOQ/الأصناف/حسابات البنوك/طلبات الشراء/التنبيهات. زر **«الوضع الافتراضي — شركة فارغة»** (`POST /api/financial-maintenance/factory-reset`) يفرّغ Postgres ثم يزرع شجرة الحسابات ويبقي `myline78@gmail.com`. بعد النجاح تظهر رسالة + زر **إعادة الدخول** (لا إغلاق مفاجئ). Electron = Railway؛ `dev:local` = Postgres المحلي.

**حفظ إعدادات العرض (2026-06-26):**

| الحقل | التخزين | ملاحظة |
|-------|---------|--------|
| `defaultTheme` | Postgres `user_prefs:{uid}` أو Firestore `users/{uid}` | عبر `saveUserPreferences()` — **لا** `auth.currentUser` فقط |
| `defaultLanguage` | نفس المسار | تبديل اللغة من الشريط → `persistLanguagePreference()` |
| `defaultModule` | نفس المسار | **`none`** = سطح مكتب فارغ — `resolveSavedDefaultModulePreference()`؛ لا `?? DEFAULT_MODULE` |
| طباعة الشركة | `company_info` | **`PrintSettingsPanel`**: بيانات الشركة فقط — **حفظ التصميم** يخزّن شريط الصفحة + الشريط العائم (`selectionPatches` للخلايا **وحقول `.kv-item`** وأجزاء الهيدر/الفوتر) |
| **مستندات التقارير (جديد)** | `src/lib/reportDocument/` | موديول التقارير: معاينة/طباعة/PDF من بيانات منظمة — لا clone للشاشة؛ دخل/ميزانية تحليلية · جدول زمني BOQ · سيولة عبر API · تكاليف BOQ كاملة + totals؛ **تخطيط الصفحة:** هيدر مضغوط + بيانات تملأ الوسط + فوتر 3 أسطر ثابتة أسفل الصفحة (`12mm`)؛ PDF بدون CDN خط ضخم |
| **ميزانية مقابل فعلي (local)** | `Reports` tab `budget` | الفعلي لكل المستويات من `boq-cost-breakdown` (= `boq_actual_costs`) — نفس مصدر تبويب تكاليف BOQ؛ ليس GL كامل |
| **لوحة التحكم «غير موزّع»** | `dashboardMetrics` | مصروف بلا مركز عقد − OHA داخل الفلتر؛ إقفال الفترة لا يصفّره · تاريخ OHA = يوم الإغلاق داخل الربع |
| **تاريخ إثبات القيد** | `businessCalendar` · `stampBusinessToday` | تقويم `Africa/Cairo` من الخادم · ترتيب دفتر اليومية بـ `createdAt` |

- **تسجيل كلمة المرور / Electron:** الجلسة = Express cookie — `canPersistUserPreferences()` = `isLocalBackend || auth.currentUser`.
- **`App.tsx`:** مستمع `USER_PREFS_UPDATED_EVENT` **بعد** تعريف `userPermissions` / `userRole` / `defaultModuleRef` (تجنّب TDZ crash).

**مخفي من الشريط:** `Purchases.tsx`, `SubcontractorExtracts.tsx` (مستخلص الباطن من تبويب التكاليف).

---

## 6. شجرة الأصناف — تصدير / استيراد Excel

**الموقع:** `MaterialsTree.tsx` — أسفل **المشاريع** + تبويب **الأصناف** في **المخازن**.

| زر | من يستخدمه | الوظيفة |
|---|---|---|
| **تصدير** | عرض `projects` | كل المجموعات والأصناف → `.xlsx` |
| **قالب** | admin / projects_manager | ملف نموذجي بصفّين |
| **استيراد** | admin / projects_manager | `POST /api/materials/import` — **ينشئ أو يحدّث** المجموعات/الأصناف حسب الكود |

**أعمدة الملف (مطابقة شجرة مخزن مقاولات v2):** كود المجموعة · **Code** (اسم المجموعة بالإنجليزي → `name_en`، **ليس** الكود) · اسم المجموعة · كود الصنف · اسم الصنف · الوحدة · الرصيد (**يُتجاهل** — الرصيد الافتتاحي من استيراد المخزون). القالب القديم ذو 5 أعمدة ما زال يعمل.  
صف بدون كود صنف = مجموعة فقط.

**ملفات:** `src/lib/materialsTreeExcel.ts` → `materialsApi.importTree()`. عمود DB: `material_groups.name_en`.

---

## 7. سير عمل المخزون والمواد

```
1. شجرة أصناف (يدوي أو Excel)     → /api/materials
2. ربط BOQ بأصناف مسموحة         → BoqMaterialsModal / ربط فوري من الصرف /api/boq-materials
3a. استلام مخزني (كمية بلا قيد)   → warehouse-receipts → quantityUnpriced؛ الاعتماد عبر فاتورة مشتريات (VAT/WHT) → priceUnpriced (لا قيد WR جديد)
3b. فاتورة مشتريات `confirmed`   → ActualCosts → sqlite-core → **project_inventory** + GL مخزون
4. أمر صرف — مسعّر: confirm؛ غير مسعّر: pending_cost + reserve ثم approve-cost
5. إذن إرجاع confirm             → return-orders → عكس BOQ + مخزن المشروع
6. تحويل بين مخازن المشاريع     → `project-inventory-transfers` — `pending_b` → `pending_projects` → `approved`
7. تحويل بين عقود (legacy)       → `inventory-transfers` — إكمال المعلّق فقط (لا طلبات جديدة من الواجهة)
```

**استلام معلّق (2026-08-09):** تبويب مخزون «استلام مخزني» = كمية فقط (رفض متاح) · الاعتماد من **التكاليف الفعلية → فاتورة مشتريات** مع ضريبة وخصم إضافة · إشعار `warehouse_receipt_pending` يفتح تبويب الفاتورة · صرف يمس غير المسعّر → `pending_cost`.

**ربط BOQ↔أصناف (2026-07-24):** شارات عدد الروابط في `BOQ.tsx` · منع حذف بند مربوط (`DeleteBlockedModal` + `can-delete`) · **ربط فوري** من أمر الصرف (`QuickLinkMaterialModal` — قائمة بنود **المشروع** عبر `boqApi.list(?projectId=)`) · تحذير كمية منصرفة في نافذة الربط · تقرير غير المربوط من رصيد المخزون · وراثة روابط للبند الجديد / بنود VO (`POST …/inherit`).

**فاتورة مشتريات — بنود (2026-07-24):** عدة أصناف؛ كل صنف يمكن ربطه بعدة بنود BOQ (`boqItemIds[]`)؛ قائمة BOQ تُفلتر بمركز التكلفة (عقد) أو بمشروع المخزن؛ حقول الوصف/الوحدة/الكمية/التكلفة تخص **الصنف المشترى** فقط.

**فاتورة مشتريات — آجلة / نقدية (2026-07-27):** `paymentType` = `credit` (دائن مورد 21101…) أو `cash` (دائن عهدة/صندوق 12102…)؛ زر «فاتورة جديدة» أعلى الشريط الجانبي.

**تحويل المشاريع:** إنشاء من مشروع المصدر (حجز `quantity_reserved`) → `approve-b` (قبول وجهة) → `approve-projects` (اعتماد PM) → حركة مخزن + **قيد GL** (مدين مخزن الوجهة 127… / دائن مخزن المصدر 127… · مرجع `PTRF-…`).  
**متطلبات:** ربط حساب مخزن **127…** لكل مشروع (تبويب رصيد المخزن)؛ مرآة المشاريع في SQLite (`ensureLocalProject`) قبل الإنشاء.  
**مسارات API:** `/api/inventory/project-transfers` (مفضّل) و`/api/project-inventory-transfers` (اسم قديم).  
**المتاح للتحويل/الصرف** = `quantity_balance` (المحجوز مخصوم في الرصيد المولّد).

---

## 8. API Endpoints (محلي — الأهم)

### مواد
| Method | Path |
|---|---|
| GET/POST | `/api/materials/groups`, `/api/materials/categories` |
| POST | `/api/materials/import` |

### مخزون وصرف
| Method | Path |
|---|---|
| GET | `/api/inventory?contractId=` |
| GET | `/api/inventory/boq-actuals?contractId=` |
| GET/POST | `/api/consumption-orders` |
| POST | `/api/consumption-orders/:id/confirm` |
| GET | `/api/inventory/project/:projectId/summary` | رصيد مخزن المشروع (للتحويل والصرف) |
| GET/POST | `/api/inventory/project-transfers` (+ `approve-b` / `approve-projects` / `reject-*` / `cancel`) |
| GET/POST | `/api/project-inventory-transfers` | نفس المسارات (اسم بديل) |
| POST | `…/approve-projects` | body اختياري: `fromWarehouseAccountCode`, `toWarehouseAccountCode` (+ أسماء) للقيد |
| GET | `/api/health` | يتضمن `features.projectInventoryTransfers` بعد إعادة تشغيل API |
| GET/POST | `/api/inventory-transfers` | legacy عقود — إكمال المعلّق فقط |

### فواتير وربط BOQ
| POST | `/api/sqlite-core/purchase-invoices/distributed` |
| GET/PUT | `/api/boq-materials/...` |
| GET | `/api/boq-materials/contract/:contractId/link-counts` | شارات BOQ |
| GET | `/api/boq-materials/:id/consumed-quantity` | تحذير كمية منصرفة |
| GET | `/api/boq-materials/contract/:contractId/unlinked-report` | تقرير غير المربوط |
| GET | `/api/boq-materials/:id/can-delete` | فحص حذف بند |
| POST | `/api/boq-materials/:id/inherit` | وراثة روابط |
| GET/POST/PUT/DELETE | `/api/purchase-transactions` |
| POST | `/api/purchase-transactions/:id/approve` | مستخلص مقاول — admin / projects_manager |
| GET/POST | `/api/purchase-requests` · `PATCH /:id/status` · `POST /:id/notify-whatsapp` | أوامر شراء — `boq-picker` يعيد `id`/`itemCode`/`description` فقط |
| GET/POST/PUT/DELETE | `/api/custody-settlements` |
| POST | `/api/custody-settlements/:id/approve` | تسوية عهدة — admin أو `ledger.create` |

### مصادقة (محلي)
| POST | `/api/auth/firebase-session` | بعد Google — ربط جلسة SQLite |
| GET | `/api/auth/me` |

---

## 9. إعداد البيئة المحلية

### `.env` (أهم المتغيرات)
```env
VITE_DATA_BACKEND=local
VITE_API_BASE_URL=/api
LOCAL_API_PORT=3001
DATABASE_URL=postgresql://...   # Postgres محلي (web_cost_app)
SESSION_SECRET=replace-with-a-long-random-secret
CORS_ORIGIN=http://localhost:3000
PRODUCTION_DATABASE_URL=...     # اختياري — Push to production (Railway public URL)
```

في **التطوير** يقبل السيرفر أي منفذ `http://localhost:*` (مثلاً Vite على **3002** إذا كان 3000 مشغولاً).

### تشغيل
```powershell
cd "G:\cost web app\web-cost-app"

npm run local:bootstrap-admin   # مرة واحدة
npm run local:api               # terminal 1 — :3001 (يتضمن prisma migrate deploy)
npm run dev                     # terminal 2 — :3000 أو التالي
```

**ملاحظة Node:** `better-sqlite3` مبني لـ Node v24 على الجهاز — عند تغيير إصدار Node: `npm rebuild better-sqlite3`.

---

## 10. ما تم إنجازه (ملخص)

| المرحلة | الحالة |
|---|---|
| **B** Lazy modules + `React.memo(WindowFrame)` | ✅ |
| **C** تقليل قراءات Firestore + `useFirestoreQuery` | ✅ |
| **F** SQLite بدل PostgreSQL + RBAC | ✅ |
| **G** موديول مخازن (backend + `Inventory.tsx`) | ✅ |
| **G5 / H** ربط فاتورة بـ BOQ، بطاقة مخزون، أعمدة BOQ | ✅ |
| **004** شجرة أصناف + consumption orders | ✅ |
| **Excel** تصدير/استيراد شجرة الأصناف (قالب v2 · `Code` = name_en · تحديث) | ✅ (2026-08-13) |
| **DisplaySettings** + **Calculator** | ✅ |
| **Shell single-module** + **Settings admin sections** | ✅ (2026-06-26) |
| **حفظ إعدادات العرض** (theme · language · defaultModule `none`) | ✅ (2026-06-26) |
| **إصلاح TDZ** (`App.tsx` hook order) | ✅ (2026-06-26) |
| **Admin + password login** — `useUserAccessScope` + session save + Projects API toasts | ✅ (2026-06-26) |
| **فاتورة أصل ثابت** (ActualCosts — 11… picker · مبلغ · GL + pending_setup) | ✅ (2026-06-26) |
| **الأصول الثابتة** — قوائم 119 / 52 / مركز تكلفة في النموذج | ✅ (2026-06-26) |
| **مال 2dp + قيد مشتريات متوازن** — `buildPurchaseWithholdingJournalLines` · `assertJournalWriteAuth` | ✅ (2026-06-26) |
| **011–012** تحويل مخازن المشاريع + قيد GL | ✅ |
| **تسوية عهدة** — `custody_settlements` · ترقيم لكل مشروع · اعتماد مدير حسابات قبل GL | ✅ (2026-06-27) |
| **مستخلص مقاول IPC** — مسودة → تقديم → اعتماد PM (GL عند الاعتماد فقط) | ✅ (2026-06-27) |
| **فاتورة مشتريات** — فتح/معاينة من الجدول · `invoiceLines` في API | ✅ (2026-06-27) |
| **البنوك — رصيد GL في النماذج** — بنك متاح + طرف مقابل (Dr/Cr) عند شيك/تحويل | ✅ (2026-06-28) |
| **البنوك — تبويب الحسابات** — إجمالي مدين/دائن/رصيد GL لكل حساب بنكي | ✅ (2026-06-28) |
| **BOQ rate breakdown** — migration `20260628120000` · حفظ من `BOQ.tsx` · `npm run local:backfill-boq-rates` | ✅ (2026-06-29) |
| **تقارير — تكلفة BOQ تقديرية** — `boqPricing.ts` (OH بدون ربح · fallback 12%) | ✅ (2026-06-29) |
| **React list keys** — `listKey` / `compositeListKey` · BOQ · COA tree · Inventory · Reports | ✅ (2026-06-29) |
| **ربط BOQ↔أصناف** — شارات · منع حذف · ربط فوري صرف · تقرير · وراثة VO/بند جديد | ✅ (2026-07-24) |
| **فاتورة مشتريات** — فلتر BOQ · `boqItemIds[]` متعدد · بيانات الصنف مستقلة | ✅ (2026-07-24) |
| **لوحة التحكم** — فلاتر تاريخ/مشروع/عقد · مقارنة سيولة · جدول زمني · دلتا فترات · بدون PDF | ✅ (2026-07-28) |
| مرآة مشروع SQLite + إصلاح تحميل أصناف التحويل في الواجهة | ✅ |

---

## 11. تحسينات الأداء (مرجع)

- Listeners مرجعية → `getDocs` / `useFirestoreQuery` حيث يناسب.
- حدود `dataLimits.ts` على استعلامات ثقيلة (تقارير، لوحة، تكاليف).
- تفاصيل: `docs/workflow-perf-checklist.md`.

---

## 12. Backlog (متبقي)

| المعرف | المهمة | الأولوية |
|---|---|---|
| `permission-alignment` | مواءمة صلاحيات Firestore rules مع الواجهة | عالية |
| `firestore-indexes-prod` | نشر `firestore.indexes.json` للإنتاج | عالية |
| `virtualize-lists` | BOQ / GL — قوائم طويلة | متوسطة |
| `baseline-cost` | قياس تكلفة Firestore | متوسطة |
| `sync-pipeline` | مزامنة Firestore → SQLite | منخفضة |
| `report-cutover` | تقارير ثقيلة من SQLite | منخفضة |

---

## 13. قواعد محاسبية ثابتة

- العملة: **جنيه مصري** — **منزلتان عشريتان** في القيود والعمليات (`roundMoney` · `formatMoney` = `0.00`); **الكميات** أيضاً منزلتان (`formatQuantity` · `roundQty`); التقارير/العرض تستخدم نفس التقريب.
- **فاتورة مشتريات (Actual Costs):** النقر على صف في الجدول → **معاينة** في النافذة؛ الفواتير **المرحّلة** (لها `transactionId`) للقراءة فقط. بنود الفاتورة تُحفظ في Postgres عبر `invoiceLines` على `purchase_transaction_items`. **ربط BOQ اختياري متعدد** (`boqItemIds`)؛ فلتر بنود BOQ حسب مركز التكلفة أو مشروع المخزن؛ حقول السطر = بيانات **الصنف** لا بند BOQ. **نوع السداد:** آجلة (Cr مورد 21101…) أو نقدية (Cr عهدة/صندوق 12102…) عبر `paymentType`.
- **ربط صنف↔BOQ:** يسمح بالصرف فقط على البنود المربوطة؛ من الصرف يمكن **ربط فوري** (بدون أسعار)؛ حذف بند BOQ ممنوع إن وُجدت روابط/صرف/تكاليف فعلية (`DeleteBlockedModal`).
- **فاتورة أصل ثابت (Actual Costs):** Dr **11…** (شامل ض.ق.م) · Cr مورد · Cr خصم — **بدون** مخزن 127 ولا بنود خامات؛ يُنشأ سجل `pending_setup` في **الأصول الثابتة**. إن فشل إنشاء السجل يظهر toast خطأ (لا صمت). **الميزانية ≠ السجل:** BS من أرصدة GL على `11…`؛ السجل من جدول `fixed_assets`. زر **مزامنة من الدفتر** / `POST /api/fixed-assets/sync-from-gl` يستورد قيود مدين يتيمة كـ `pending_setup`. `project_accountant` يملك `assets` CRUD حتى ينجح الإنشاء من فاتورة التكاليف. إن فشل إنشاء السجل يظهر toast خطأ (لا صمت). **الميزانية ≠ السجل:** BS من أرصدة GL على `11…`؛ السجل من جدول `fixed_assets`. زر **مزامنة من الدفتر** / `POST /api/fixed-assets/sync-from-gl` يستورد قيود مدين يتيمة كـ `pending_setup`. `project_accountant` يملك `assets` CRUD حتى ينجح الإنشاء من فاتورة التكاليف.
- **مستخلص مقاول:** `draft` → `submitted` → `approved`؛ القيد **عند الاعتماد فقط** (`POST /api/purchase-transactions/:id/approve` — admin / projects_manager). **رقم:** لكل مقاول وسنة `مستخلص محمد الشيخ-001-2026` (تسلسل منفصل عن مستخلص الخدمة). **طباعة:** العنوان = الرقم + الحالة · الشعار واسم الشركة معاً (شعار بضعف الحجم) · الملخص أسفل البنود (سابق + حالي + إجمالي + ضريبة/محتجزات على الإجمالي − مقدمة − مسدد سابق = المستحق). قيد الاعتماد = زيادة الفترة فقط. عند الاعتماد أيضاً: صفوف `boq_actual_costs` (`subcontractor` = `currentQty×rate`) للتقارير فقط — بدون تغيير القيد. تسوية العهدة: ربط BOQ اختياري → `custody` عند الاعتماد. Backfill: `npm run local:backfill-ipc-custody-boq`. **المسدد (2026-08-30):** `sumContractorCashPaymentsFromGl` — مدين حساب المقاول فقط إذا دائن القيد بنك `12101…` أو صندوق/عهدة `12102…` (يشمل تسوية العهدة) ومركز التكلفة = عقد المستخلص · **لا تقدير من الأعمال السابقة** (صفر إن لم توجد حركة نقدية). **تعبئة تلقائية (2026-08-30):** عند فتح مستخلص جديد ينسخ بنود آخر مستخلص معتمد. **حذف مسودة (2026-08-30):** زر «حذف المستخلص» (أحمر + تأكيد) للمستخلصات غير المعتمدة — `purchaseTransactionsApi.remove(id)` (حذف ناعم).
- **مستخلص خدمة:** `purchase_transactions.type = service_ipc` + `suppliers.serviceKind` (labour/equipment/vehicles/housing تحت 21102). بنود: مركز تكلفة + فصل BOQ اختياري + فئة + سابق/حالي/صافي. قيد الاعتماد يوزّع المدين على العقود (`51102` عمال · `51104` معدات/سيارات · `51103` سكن) دون `boq_actual_costs`. **رقم:** لكل مورد وسنة `مستخلص محمد الشيخ-001-2026` (`serviceIpcNumber.ts`). **طباعة:** العنوان = رقم المستند + الحالة · الشعار واسم الشركة معاً (شعار بضعف الحجم) · محاذاة حقول الرأس من الشريط العائم (`slot: kv`) · الملخص المالي أسفل البنود (سابق + حالي + إجمالي + ضريبة/محتجزات على الإجمالي − مقدمة − مسدد سابق = المستحق). **تنبيه:** `service_ipc_pending` عند التقديم · جرس + deep-link لتبويب `service_ipc`. **موازنة نقدية:** فئة التزام `service` لأوراق 21102 المرتبطة بمقاول خدمة + مستخلصات خدمة مقدَّمة غير معتمدة. **نسب صفر:** لا `Number(pct) || default` — النسبة `0` تُحفظ وتُستعاد؛ نسب الضريبة/الاستقطاع في payload؛ الاحتياطي من المبالغ بـ fallback `0`. **المسدد (2026-08-30):** `sumContractorCashPaymentsFromGl` — مدين حساب المورد فقط إذا دائن القيد بنك `12101…` أو صندوق/عهدة `12102…` لمراكز تكلفة البنود · **لا تقدير من الأعمال السابقة**. **تعبئة تلقائية (2026-08-30):** `useEffect` ينسخ هيكل بنود آخر مستخلص معتمد (`isBlank` check). **حذف مسودة (2026-08-30):** زر «حذف المستخلص» في أسفل النافذة + تأكيد مضمّن للمستخلصات غير المعتمدة (`!readOnly`).
- **تسوية عهدة:** سجل في `custody_settlements` (ليس GL مباشرة)؛ ترقيم `SET-{كود-المشروع}-0001`؛ `submitted` → اعتماد **مدير الحسابات** (`admin` أو `ledger.create`) → GL عبر `postCustodySettlementJournals`.
- **قيد فاتورة مشتريات (127 / 5 / 11):** رصيد الدائن للمورد = (أساس + ض.ق.م) − خصم — لا تقريب مستقل لكل بند يسبب فرق 1 جنيه.
- **ترحيل القيود على Railway/Electron (password):** جلسة Express — **لا** يشترط `auth.currentUser` في الوضع المحلي (`assertJournalWriteAuth`).
- ضمان حسن التنفيذ: **10%** (شامل VAT).
- تأمينات: **5%** (بدون VAT).
- قوى عاملة: **0.3%** (بدون VAT).
- تحويل المخزون: بسعر التكلفة الأصلي — عند **`approve-projects`**: حركة `project_inventory` + قيد **Dr وجهة 127… / Cr مصدر 127…** (Firestore: `recordProjectWarehouseTransfer` · SQLite: `postProjectTransferJournal`).
- المخزون المحجوز (`quantity_reserved`) مخصوم في `quantity_balance` — غير متاح للصرف/تحويل حتى رفض/إلغاء الطلب.
- تشغيل API من **`web-cost-app`** (ليس `web-cost-app-local`) — وإعادة تشغيل `npm run local:api` بعد سحب التحديثات.
- **BOQ — تكلفة تقديرية (تقارير):** `src/lib/boqPricing.ts` — OH بدون ربح؛ عند غياب rates في Postgres: `unitRateTotal ÷ (1 + 12%) × qty`. **Backfill:** `npm run local:backfill-boq-rates`.

---

## 14. التقارير — ميزان المراجعة والميزانية (ملخص)

| التقرير | قاعدة حقوق الملكية / مخزون |
|---|---|
| **ميزان المراجعة** | حسابات `127…` → **سطر واحد** `127`؛ **الرصيد الختامي = صافي** (مدين − دائن). يحترم فلتر المشروع/العقد و`periodStart`. |
| **الميزانية** | **حقوق الملكية = فرع 3 فقط** (بما فيها `314` جاري الشركاء) — **بدون** دمج إيرادات/مصروفات غير مقفلة. **مخزون 127** سطر واحد صافي. تنويه الفرق **أسفل** الصفحة عند عدم التوازن. على مستوى الشركة (بدون فلتر مشروع). |
| **قائمة الدخل** | نشاط الفترة قبل الإقفال (يُستبعد `fiscal_pl_close` / `YE-PL-*`): إيرادات `4…` − تكاليف عقود `51…` = مجمل ربح العقود − عمومية/إدارية `52…` (− تمويلية `53…`) = ربح قبل الضريبة. وضع كشف (إجماليات) + تحليلي (`showAnalytical`: أوراق + مشاريع). أوراق عبر **`buildIncomeStatementTotals`** / **`buildIncomeStatementLeafBalances`** (جمع كل أسطر القيد — لا `.find()`). |
| **OHA إعادة فتح** | soft-delete لقيود `OHA-*` + حفظ التوزيع السابق كـ **proposed drafts** (`snapshotClosedLinesAsProposed`) — الاعتماد بلا تعديل يعيد نفس التقسيم إن تطابقت البركة؛ وإلا امسح المقترح وأعد التوزيع. |

التفاصيل: **`CLAUDE.md`** → قسم *Reports* / Cost Centers & Overhead Allocation.

### قفل الفترات المحاسبية (2026-07-26)

- جدول **`accounting_period_locks`** — ربع سنوي منفصل عن دورات OHA.
- الفرض في **`createTransaction` / `updateTransaction`** + حذف ناعم للقيود → **423** إن الفترة مقفلة والمستخدم ليس في `allowedUserIds`.
- واجهة: موديول الفترات المحاسبية → تبويب **قفل الفترة** (`PeriodLockPanel`) — إدارة admin فقط.
- API: `/api/accounting-periods` · اختبارات: `server/src/accounting/periodLock.test.ts`.

### إقفال قائمة الدخل + قيد افتتاحي (2026-07-27) — بدون WIP

- **لا** رسملة أعمال تحت التنفيذ (`126…`) — ملغاة بقرار المنتج.
- جدول **`fiscal_period_closings`**: `draft` → `pl_closed` → `bs_approved` → `opening_posted`.
- إقفال الدخل: قيد `YE-PL-…` يصفّر `4/5` إلى **`31301001`** (`journal_kind=fiscal_pl_close`).
- اعتماد الميزانية **مرفوض** إن `|A−(L+E)| > 1` جنيه (409)؛ الفرق ≤ 1 يُعتبر تقريبًا (`BS_BALANCE_TOLERANCE`).
- قيد افتتاحي `OPEN-…` بتاريخ اليوم التالي لنهاية الفترة (`journal_kind=fiscal_opening`) — **يُستبعد** من تجميع تقارير الميزانية/الدخل حتى لا تُضاعف الأرصدة؛ يُقفل نطاق الفترة عبر `accounting_period_locks`.
- واجهة: موديول الفترات → **إعداد قائمة الدخل** (`IncomeStatementClosingPanel`).
- API: `/api/fiscal-closings` · اختبارات: `server/src/accounting/fiscalPeriodClosing.test.ts`.
- Migration: `20260727140000_fiscal_period_closings`.

---

## 15. مراجع سريعة

| الملف | المحتوى |
|---|---|
| `CLAUDE.md` | architecture، AccountCodes، coding rules، handoffs — **أحدث:** قفل فترات محاسبية (2026-07-26) · Electron multi-window (2026-07-25) |
| `DEPLOYMENT_PLAN.md` | Railway · Postgres · Electron · حالة التقدّم — نقطة توقف **2026-07-26** |
| `docs/DEVELOPER_GUIDE.md` | دليل المطوّر — قفل الفترة · §3.9 نوافذ Electron · §6.5 فاتورة |
| `TEST_CHECKLIST_AR.md` | قائمة اختبار يدوي |

---

## 16. تسجيل الدخول بكلمة المرور (Electron / Railway)

- **Electron** يحمّل SPA من Railway — **لا Firebase user** بعد password login؛ الجلسة = cookie Express (`web_cost_sid`).
- **نوافذ متعددة (2026-07-25):** `createAppWindow({ reuseSession: true })` — نفس `persist:webcost`؛ **Ctrl+N** / زر الشريط؛ النافذة الثانوية **لا** تمسح الجلسة ولا تطلب login مجدداً (`sessionProbe` + `isDesktopSessionReuseWindow`). اختصار القشرة يعتمد **`input.code === 'KeyN'`**. كشف New GUI: sync IPC `query-reuse-session` + `?webCostReuseSession=1` (مثبّت معبأ). **مهم:** المثبّت القديميم بدون `open-new-window` لن يفتح نافذة — يلزم Setup **≥ 1.0.7** عبر `electron:publish`.
- **`useUserAccessScope`**: في local mode الدور من **`PermissionsContext`** (يُحدَّث من `App.tsx` عند login)؛ العقود المعيَّنة من **`GET /auth/me`**.
- **لا تراجع:** ربط `role` بـ `onAuthStateChanged` فقط — يكسر admin في Inventory/Projects scoping.
- **`POST /auth/login`**: يستدعي `req.session.save()` قبل الرد (مثل `firebase-session`).
- **ترحيل GL (password):** `assertJournalWriteAuth()` في `accountingService.ts` — local/Railway لا يتطلب `auth.currentUser` (إصلاح «User not authenticated» عند حفظ فواتير).
- **Promote admin على Railway:** `npx tsx server/src/scripts/promoteGoogleAdminPg.ts <email>` مع `DATABASE_URL` = `DATABASE_PUBLIC_URL`.
