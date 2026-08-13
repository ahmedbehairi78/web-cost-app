# خطة النشر والترحيل — Web Cost App (نظام ويب كامل أونلاين)

> **الهدف النهائي:** نظام **ويب كامل أونلاين** ببنية مركزية واحدة:
> **Express API + PostgreSQL** (مصدر الحقيقة لكل البيانات) على **Railway**، و**Firebase للمصادقة فقط (تسجيل دخول Google)**، يُغلَّف في **تطبيق سطح مكتب رقيق (Electron) يفتح التطبيق دون متصفح خارجي**، مع **تحديث تلقائي للمحتوى** عبر الويب.
>
> **هذا المستند مرجع متعدد الجلسات.** في بداية كل جلسة اقرأ **`CLAUDE.md`** · **`CONTEXT.md`** · **`docs/DEVELOPER_GUIDE.md`** و«حالة التقدّم» — **حدّث هذه الملفات** بعد نجاح أي إصلاح أو تحسين.

---

## 1) القرارات المُعتمدة (نهائية)

| القرار | الاختيار | السبب |
|--------|----------|-------|
| نمط النظام | **ويب كامل أونلاين** (عودة من الهجين) | مشاركة البيانات بين كل الأجهزة + تحديث فوري |
| الاستضافة | **(أ) Railway** — API + PostgreSQL مُدار | أقل صيانة، نسخ احتياطي تلقائي، HTTPS |
| النواة المالية | **(B-كامل)** — **كل** بيانات التطبيق في PostgreSQL | حلّ جذري لمشكلة الصلاحيات (مصدر واحد) |
| Firebase | **للمصادقة فقط** (Google sign-in + ID token) | إبقاء تسجيل الدخول المستقر مع إزالة ازدواج مخازن الصلاحيات |
| الواجهة | عميل React يتصل بالـ API المركزي فقط (لا قراءة Firestore مباشرة) | منع تباعد الصلاحيات وأعطال «تحميل البيانات» |
| المخرج | **EXE رقيق (Electron)** يحمّل الموقع المستضاف | تجربة سطح مكتب دون متصفح خارجي |
| التحديث | **تلقائي عبر الويب** (إعادة نشر = تحديث فوري للجميع) | لا حاجة لتثبيت تحديثات على كل جهاز |

### لماذا B-كامل يحلّ مشكلة الصلاحيات نهائياً
آلام النظام الهجين كان لها مصدران: (1) نظامان مستقلّان للصلاحيات (قواعد Firestore + خادم SQLite) يتباعدان، (2) عجز قواعد Firestore عن السماح بـ «قراءة مرجعية» لموديول محظور. في B-كامل: **مصدر صلاحيات واحد في كود الخادم**، والتفريق بين «الوصول للموديول» و«القراءة المرجعية» يصبح سطر كود بسيط. النتيجة: **لا تتكرّر أعطال تحميل البيانات**.

---

## 2) المعمارية المستهدفة

```
                ┌──────────────────────────────────────────┐
                │            Railway (سحابي)                 │
                │  Express API  ◄────►  PostgreSQL (مشترك)   │
                │  (كل البيانات + كل الصلاحيات هنا)          │
                └───────────────▲──────────────────────────┘
                                │ HTTPS REST + Firebase ID token
        ┌───────────────────────┼────────────────────────┐
   جهاز 1 (EXE/متصفح)     جهاز 2 (EXE/متصفح)       جهاز 3 (EXE/متصفح)
   واجهة React            واجهة React             واجهة React
        └───────────────────────┼────────────────────────┘
                                ▼
                   Firebase Auth (Google) — هوية فقط
```

- **PostgreSQL مركزي**: كل الجداول (التشغيلية + النواة المالية) → مشاركة كاملة بين الأجهزة.
- **Firebase**: مصادقة فقط؛ العميل يرسل ID token للخادم الذي يتحقّق منه ويربطه بمستخدم Postgres وصلاحياته.
- **الواجهة**: لا تتصل بـ Firestore لقراءة/كتابة بيانات التطبيق — كله عبر الـ API.
- **EXE**: نافذة Electron تحمّل رابط الإنتاج؛ تحديث المحتوى تلقائي بإعادة النشر.

> **مقايضة:** بإزالة قراءة Firestore المباشرة نفقد التحديث اللحظي (`onSnapshot`). البديل: تحديث دوري (polling) أو لاحقاً WebSocket/SSE من الخادم المركزي حيث يلزم.

---

## 3) حالة الكود الحالية (نتائج الفحص — 2026-06-14)

| العنصر | الحالة |
|--------|--------|
| `prisma/schema.prisma` | ✅ **43 جدولاً** — `init_full_schema` + `add_user_assigned_contracts` + `add_bank_tables` |
| `server/src/db.ts` | عميل Prisma + `@prisma/adapter-pg` جاهز |
| `server/src/env.ts` | `databaseUrl` + متغيّرات SQLite (ستُلغى لاحقاً) |
| `deploy/docker-compose.local.yml` | Postgres 16 جاهز للتطوير المحلي |
| الموديولات `server/src/modules/*` | **✅ Postgres** — كل مسارات `app.ts`؛ صلاحيات CRUD في `server/src/permissions.ts` |
| `server/src/migration/*` | **✅** — Firestore + SQLite importers + users merge + count verification |
| `server/src/scripts/importFirestoreJson.ts` | مستورد **جزئي** Firestore JSON ➜ Postgres (projects/contracts/coa/suppliers/transactions) — أساس لأداة الترحيل |
| الواجهة `src/` | **✅ ~95%** — كل الموديولات على API في local؛ **بنوك:** شغّل `local:import-banks` بعد ترحيل Firestore إن كانت فارغة |
| النسخ الاحتياطي داخل التطبيق | **✅** — local: `settingsApi.exportBackup()` (Postgres) · cloud: Firestore JSON |

### تحديثات 2026-06-26 (مساءً)

| البند | الحالة |
|--------|--------|
| فاتورة **أصل ثابت** في Actual Costs (11… picker · مبلغ · GL) | ✅ |
| موديول **FixedAssets** — pickers 119 / 52 / مركز تكلفة | ✅ |
| **مال 2dp** + `buildPurchaseWithholdingJournalLines` (توازن القيد) | ✅ |
| **assertJournalWriteAuth** — password login يرحّل GL على Railway | ✅ |
| `dataBackend` — fallback prod + `/api` | ✅ |

---

## 4) قرارات مُعلّقة (تُحسم عند الوصول)

- [ ] هل نُبقي تحديثاً تلقائياً لقشرة Electron نفسها عبر `electron-updater`؟ (غالباً غير ضروري لأن المحتوى ويب؛ نضيفه فقط إن تغيّرت القشرة).
- [ ] توقيع الكود (شهادة Windows) لإزالة تحذير SmartScreen — مدفوع، اختياري.
- [ ] استضافة الواجهة: على Railway نفسها أم Vercel/Netlify (مجاني) منفصلة عن الـ API؟
- [ ] استراتيجية التحديث اللحظي (polling افتراضي؛ WebSocket لاحقاً عند الحاجة).

---

## 5) المتطلبات المسبقة (مرة واحدة)

- [ ] حساب **Railway** + ربط **GitHub** (مستودع خاص).
- [ ] **Docker Desktop** على جهاز التطوير (Postgres محلي للتطوير).
- [ ] Node.js 20+.
- [ ] **نسخ احتياطية كاملة قبل أي تفريغ** (انظر القسم 6).

---

## 6) النسخ الاحتياطي والاسترجاع (شبكة الأمان)

البيانات حالياً في مخزنين: **Firestore** (سحابي) + **SQLite** (`server/data/financial-core.sqlite`).

- [x] **SQLite**: تم النسخ إلى `D:\cost web app\backups\<timestamp>\` (ملفات `.sqlite`+`-wal`+`-shm` + ZIP). تنبيه: WAL كان 3.96MB فالملفات الثلاثة ضرورية معاً للاسترجاع.
- [ ] **Firestore**: تصدير من **الإعدادات → Backup & Restore → تنزيل النسخة الاحتياطية** → ملف `backup_YYYY-MM-DD.json`؛ احفظه في مجلد `backups\<timestamp>\firestore\`. (يدوي — يستخدم تسجيل دخول المتصفح؛ لا يوجد مفتاح خدمة في `.env`).
  - بديل: إنشاء مفتاح خدمة Firebase (Console → Project Settings → Service Accounts) لكتابة سكربت تصدير Admin SDK كامل.

**سير العمل:** نأخذ النسختين → نبني B-كامل على Postgres فارغ نظيف → في النهاية نشغّل سكربت الترحيل (المرحلة 4) لتحويل النسخ إلى Postgres. «استرجاع» النظام الجديد = تحويل (سكربت)، وليس نسخاً مباشراً، لأن النموذج موحّد جديد.

---

## 7) المراحل التفصيلية

> كل مرحلة: **المهام + معيار الإنجاز (Done) + حدود الجلسة**. متسلسلة.

### المرحلة 0 — تجهيز البيئة
- [ ] فرع `feat/web-online-postgres`.
- [ ] `docker compose -f deploy/docker-compose.local.yml up -d postgres`.
- [ ] ضبط `.env`: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/web_cost_app`.
- [ ] `npx prisma generate` + اختبار اتصال.
- **Done:** الاتصال بـ Postgres المحلي ناجح.

### المرحلة 1 — إكمال مخطط Prisma (كل الجداول)
- [ ] إضافة نماذج النواة المالية الناقصة: `material_groups`, `material_categories`, `boq_item_materials`, `purchase_invoices`(+lines/allocations), `project_inventory`(+movements), `consumption_orders`(+lines), `return_orders`(+lines), `boq_actual_costs`, `inventory_transfers`(+lines), `project_inventory_transfers`(+lines), `contract_inventory`, `subcontractors`, `subcontract_assignments`, `subcontract_extracts`, `material_on_site_extracts`(MOS), `sessions`.
- [ ] أنواع: `Decimal(18,3)`، تواريخ كنصوص ISO، فهارس مكافئة لـ SQLite.
- [ ] `npx prisma migrate dev --name init_full_schema`.
- **Done:** كل الجداول تُنشأ على Postgres بلا أخطاء؛ تغطية 100%.
- **حد جلسة:** قد تحتاج جلستين.

### المرحلة 2 — تحويل موديولات الخادم (SQLite ➜ Prisma)
تحويل تدريجي؛ المتزامن `db.prepare().get/all/run` → `await prisma.*`، والمعاملات → `prisma.$transaction`.

**بنية تحتية مشتركة (تمت):**
- `server/src/prisma/serialize.ts` — `serialize()` يحوّل `Prisma.Decimal`→`number`، `Date`→ISO، `bigint`→`number` قبل `res.json` (الواجهة تتوقّع أرقاماً كما كانت من SQLite REAL).
- `server/src/prisma/dmmf.ts` — `modelScalarFields()` يصفّي حقول الجسم لحقول المخطط فقط في CRUD العام.
- `server/src/middleware/asyncHandler.ts` — تمرير أخطاء الـ async handlers إلى `next`.
- `server/src/middleware/errors.ts` — `errorHandler` يُترجم أخطاء Prisma (P2002→409, P2003→400, P2025→404, validation→400) مع إبقاء رسائل SQLite أثناء الانتقال.

- [x] `crud.ts` (projects/contracts/boq/suppliers/coa/purchase-transactions) — Prisma delegate عام + تصفية حقول + serialize
- [x] `materials.ts` + `boqMaterials.ts` — مع تسطيح `groupCode`/`groupName` للحفاظ على شكل الاستجابة
- [x] `gl.ts` + `accounting/*` (شريحة GL/COA) — `journal.ts` صار **Postgres async** (`createTransaction(input, userId, txClient?)` لذرّية مع `$transaction` المُستدعي)؛ `ensureJournalCoa` (نسخة `…Pg`)، `ensureCoaSeed`، `syncCoaBatch` على Prisma؛ `gl.ts` + `chartOfAccountsMaintenance.ts` على Prisma + `asyncHandler`.
- [x] `billing.ts` — Postgres كامل (`prisma.$transaction`: قيد IPC عبر `createTransaction(..., tx)` + صف billing/items ذرّياً؛ revert-to-draft)
- [x] `mosExtracts.ts` — Postgres كامل (وصف BOQ يُجلب منفصلاً لعدم وجود علاقة؛ approve يرحّل القيد داخل `$transaction`)
- [x] `inventory.ts` + `inventoryHelpers.ts` + transfers (project/legacy) + `consumptionOrders.ts` + `returnOrders.ts` + `projectWarehouseGl.ts` (قيد Postgres داخل `$transaction`؛ حُذف `journalSqlite.ts`)
- [x] `sqliteCore.ts` (فواتير موزّعة) — Postgres + `inventoryHelpers` داخل `$transaction`؛ حُذف `inventoryHelpersSqlite.ts`
- [x] `subcontractor.ts`
- [x] `reports.ts` + `inventoryMaintenance.ts`
- [x] `auth/*` + جلسات (`connect-pg-simple`) — `users.ts` على Prisma؛ `requireAuth` async
- **Done:** كل مسارات `app.ts` على Postgres؛ `tsc --noEmit` للخادم نظيف؛ golden paths محلياً.
- **حد جلسة:** عدة جلسات.
- **جسر SQLite مؤقّت:** ~~`inventoryHelpersSqlite.ts`~~ **حُذف** — `sqliteCore.ts` يستخدم `inventoryHelpers.ts` (Postgres).
- **ملاحظة حالة مختلطة:** كل مسارات `app.ts` على Postgres (فارغ حتى المرحلة 4). SQLite يبقى لسكربتات الصيانة المحلية فقط. لا أخطاء TS جديدة؛ تبقى TS6059 قديمة (`ensureCoaSeed`، `boqActualCostReport` — rootDir).

### المرحلة 3 — توحيد الصلاحيات في الخادم (جوهر B-كامل)
- [x] التحقق من Firebase ID token في الخادم (`auth/firebaseToken.ts`) — جلسة كوكي + `Authorization: Bearer`
- [x] مصدر صلاحيات واحد: Postgres `users.permissions` (CRUD JSON) + `requireAuth`/`requireReferenceRead`/`requireModuleWrite`
- [x] فصل واضح: `hasModuleView` (وصول موديول) · `hasReferenceRead` (قراءة مرجعية view|create|edit) · `hasModuleWrite` (create|edit)
- [ ] إزالة الاعتماد على قواعد Firestore لبيانات التطبيق — **المرحلة 5** (الواجهة ما زالت تقرأ Firestore)
- **Done (خادم):** محاسب مشروع بـ `costs.create` يقرأ COA مرجعياً دون `ledger.view`؛ الكتابة تتطلب `create|edit`.

### المرحلة 4 — أداة ترحيل البيانات (النسخ ➜ Postgres)
- [x] `server/src/migration/*` — Firestore backup + **SQLite warehouse importer** + users merge + verification
- [x] `migrateToPostgres.ts` — projects/contracts/suppliers/COA/BOQ/billing/GL/purchases + **materials/inventory/consumption/return/MOS/users** + تقرير تحقّق
- [x] ترحيل SQLite (مخازن: materials، project_inventory، consumption، return، transfers، MOS، users)
- [x] ترحيل Railway: migrate **PASS** · backfill-gl **21** قيد · GL **31** · verify-postgres **PASS**
- [x] `verifyMigrationCounts.ts` — PASS مع ⚠
- [ ] `users` من Firestore — **يتطلب** `FIREBASE_SERVICE_ACCOUNT_*`
- **ملاحظة:** للسكربتات المحلية ضد Railway استخدم **`DATABASE_PUBLIC_URL`** (`*.proxy.rlwy.net`) — **ليس** `postgres.railway.internal`
- [x] بنوك (`bank_*`) — جداول Prisma + استيراد في `importFromFirestoreBackup.ts`؛ سكربت `local:import-banks`
- **Done (شبه كامل):** `npm run local:migrate` + `npm run local:verify-postgres` — Firestore core + SQLite مخازن + users (SQLite)؛ GL متوازن؛ **متبقّي:** `users/{uid}` من Firestore (Admin SDK).

### المرحلة 5 — تحويل الواجهة لاستدعاء الـ API المركزي (الأكبر في الواجهة)
- [x] `src/hooks/useApiQuery.ts` — hook عام لجلب قوائم من الـ API
- [x] `useChartOfAccountsRef` — Postgres/API عند `isLocalBackend`
- [x] `Projects.tsx` — projects/contracts/billing/GL من API (بطاقات: لا all-BOQ؛ GL cap 2000؛ `projects/ProjectCard` + `ProjectFormModal`)
- [x] `GeneralLedger.tsx` — Postgres فقط (لا دمج Firestore)
- [x] `ActualCosts.tsx` — suppliers/COA/projects/boq/purchase/GL
- [x] `BOQ.tsx` — projects/contracts/boq/billing · forms/rows معزولة (`BOQItemFormModal` · `BoqItemRow` · `boqRowViewModel`)
- [x] `Billing.tsx` — `billingApi` CRUD + journal عبر الخادم (`billing.ts`, `billingHelpers.ts`)
- [x] `Dashboard.tsx` — KPIs + مرجعيات عبر API
- [x] `Reports.tsx` + `LiquidityReport.tsx` — تقارير + سيولة من Postgres
- [x] **`Inventory.tsx`** — projects/contracts/COA عبر API؛ `ConsumptionOrderModal` · `ReturnOrderModal`
- [x] `Settings.tsx` — users (`authApi.userDirectory`) · `company_info` (`/api/settings`) في local
- [x] `Banks.tsx` — Prisma `bank_*` + `banksApi` + `bankPersistence.ts`؛ كل التبويبات عبر API في local؛ **تلميح رصيد GL** في نماذج الشيكات/الحركات (2026-06-28)
- [x] MOS panel — Postgres فقط في local (لا مرآة Firestore)
- [x] `App.tsx` / `DisplaySettings` — تفضيلات عبر `/api/settings/user-preferences`
- [x] Backup export — `settingsApi.exportBackup()` (Postgres JSON) في local؛ استيراد ما زال Firestore
- [ ] استبدال التحديث اللحظي بـ polling (أو WebSocket لاحقاً)
- [ ] إبقاء Firebase Auth فقط (تسجيل الدخول + ID token)
- **Done عند:** كل موديول في local mode = API فقط؛ cloud mode يبقى Firestore حتى Railway

### المرحلة 6 — نشر الخادم على Railway
- [x] `deploy/railway-api.Dockerfile` — **واجهة + API** على خدمة واحدة
- [x] `railway.toml` + `scripts/start-api-production.mjs` + `scripts/generate-vite-env.mjs`
- [x] `.dockerignore` — بدون SQLite في production
- [x] تحقق production في `env.ts` + `RAILWAY_PUBLIC_DOMAIN` لـ CORS
- [x] `/api/health` + `trust proxy` + `prisma migrate deploy`
- [x] دليل: `docs/RAILWAY_DEPLOY.md`
- [x] **تم:** migrate + backfill-gl + verify-postgres على Postgres Railway ✅
- [x] `local:promote-google-admin` — `myline78@gmail.com` → admin
- [x] **golden paths UI** على `web-cost-app-production.up.railway.app` ✅ (GL 31، مشاريع، مستخلصات، تقارير)

### المرحلة 7 — نشر الواجهة + توجيهها للإنتاج
- [x] `VITE_DATA_BACKEND=local` + `VITE_API_BASE_URL=/api` في بناء Docker
- [x] Express يخدم `dist/` (SPA) على نفس النطاق — لا حاجة لاستضافة منفصلة على Railway
- [x] `.env.production.example` + `npm run build:production`
- [x] Firebase Authorized domain + Google login على Railway
- [x] **Done:** فتح رابط Railway يشغّل التطبيق كاملاً ضد Postgres المركزي — **مُتحقَّق يدوياً**

### المرحلة 8 — تغليف Electron (قشرة رقيقة)
- [x] `electron/main.ts` + `preload.ts` — `WEB_COST_APP_URL` / `production-url.json` / `localhost:3000`
- [x] `electron` + `electron-builder` · `npm run electron:dev` · `electron:pack`
- [x] **preload CommonJS** — `electron/tsconfig.preload.json` (كان ESM → شاشة بيضاء / فشل تحميل)
- [x] **OAuth في Electron** — السماح بنوافذ Google في `main.ts`؛ `signInWithRedirect` في `Login.tsx` + `getRedirectResult` في `App.tsx` (**يحتاج redeploy Railway**)
- [x] `src/lib/electronShell.ts` · F12 DevTools · رسائل `did-fail-load`
- [x] **نوافذ متعددة بنفس الجلسة (2026-07-25)** — `createAppWindow` + `persist:webcost` · Ctrl+N (`input.code`) · IPC `open-new-window` / `query-reuse-session` / `window-reveal` · `?webCostReuseSession=1` · زر Sidebar/TopNav · يلزم Setup **≥ 1.0.7** (القشرة؛ SPA وحدها لا تكفي)
- **Done:** `electron:dev` + Setup.exe يفتح التطبيق ضد Railway ويسجّل الدخول.

### المرحلة 9 — حماية الكود + مزامنة دون اتصال
- [x] `app.asar` + عدم تضمين أسرار (مفاتيح Firebase العامة فقط).
- [x] **Offline sync (2026-08-08):** مسودات IndexedDB + طابور `safe_save` / `confirm_required` + `Idempotency-Key` + شريط حالة + لوحة تأكيد — يشمل BOQ/VO — `src/lib/offline/*`
- [x] **Excel-like inputs (2026-08-08):** select-on-focus + تنقل أسهم داخل جداول التحرير — `src/lib/excelLikeInputs.ts` (مثبّت من `main.tsx`)
- [x] **Split ActualCosts/Inventory UI (2026-08-08):** استخراج عرضي تحت `actualCosts/` · `inventory/` — بدون نقل مسارات الكتابة
- [ ] تعتيم حزمة الواجهة (obfuscator اختياري فوق minify).
- **Done:** فحص الحزمة لا يكشف أسراراً؛ المنطق المالي يبقى على الخادم؛ المسودات/الطابور تمنع ضياع التعبئة عند انقطاع الشبكة.

### المرحلة 10 — مُثبّت `Setup.exe`
- [x] `electron-builder` NSIS — `npm run electron:pack` → `release/Web Cost App Setup 0.0.0.exe`
- [x] **توزيع:** ملف **`Setup.exe` فقط** للأجهزة الأخرى (لا `.env` ولا Postgres)
- [x] تثبيت على **جهاز ثانٍ** — يعمل
- [ ] قرار توقيع الكود (SmartScreen) — اختياري
- **Done:** تثبيت على جهاز Windows (بلا Node) يشغّل التطبيق ضد Postgres المركزي.

### المرحلة 11 — التحديث (تلقائي عبر الويب)
- [ ] المحتوى يتحدّث تلقائياً بإعادة نشر الواجهة (لا عمل لكل جهاز).
- [ ] (اختياري) `electron-updater` للقشرة إن لزم.
- **Done:** إعادة نشر الواجهة تنعكس على كل الأجهزة عند إعادة الفتح.

### المرحلة 12 — اختبار شامل وإطلاق
- [x] Golden paths على Railway (IPC، GL، مشاريع، تقارير، Dashboard)
- [x] **تعدد الأجهزة** — Setup.exe على جهاز ثانٍ؛ **تحويل مخازن (PTRF)** متزامن بين الجهازين ✅
- [ ] golden paths كاملة (فاتورة + **معاينة**، **IPC اعتماد PM**، **تسوية عهدة اعتماد**، صرف، إرجاع، شيكات، MOS) على جهاز ثانٍ
- [ ] اختبار **الصلاحيات المحدودة** (`project_accountant` — لا 403 خاطئة)
- [x] `liquidityMetrics.test.ts` — 17 حالة
- **Done:** مستخدمان على جهازين على نفس Postgres المركزي؛ العمليات التشغيلية تتزامن فوراً.

---

## 8) المخاطر والاعتبارات

- **حجم المرحلة 5 (الواجهة):** تحويل كل قراءات Firestore لاستدعاءات API يلمس معظم الموديولات — الأثقل في الواجهة. ننفّذه تدريجياً.
- **فقدان التحديث اللحظي:** نعوّضه بـ polling؛ WebSocket لاحقاً.
- **الجلسات عبر النطاقات:** `sameSite=None; Secure` + CORS credentials.
- **الاعتماد على الإنترنت:** لا عمل دون اتصال بالخادم المركزي (مقبول — اختيار أونلاين).
- **أمان Firebase:** مفتاح الخدمة على الخادم فقط (Railway env)، لا يُوزّع مع العميل.
- **SmartScreen:** تحذير عند أول تشغيل دون شهادة توقيع.

---

## 9) حالة التقدّم (يُحدّث كل جلسة)

- **2026-08-09:** اعتماد الاستلام المخزني عبر **فاتورة مشتريات** (VAT/WHT + `priceUnpriced`)؛ `/warehouse-receipts/:id/approve` → 410؛ إشعار يفتح تبويب الفاتورة.
- **2026-08-02:** موديول **أوامر الشراء** (`purchase_requests`) — Postgres + API + UI + إشعارات/واتساب؛ تنفيذ = حالة فقط (لا GL). Migration `20260802120000_purchase_requests` مطبّقة محلياً — يلزم `migrate deploy` على Railway عند النشر.

> **نقطة التوقف (2026-07-27):** **فاتورة مشتريات آجلة/نقدية** (`paymentType` · Cr 21101 أو 12102) · زر «فاتورة جديدة» أعلى الشريط الجانبي · migration `20260727120000_purchase_payment_type`.

> **نقطة التوقف (2026-07-24):** **ربط BOQ↔أصناف** (شارات · منع حذف · ربط فوري صرف · تقرير · وراثة) · **فاتورة مشتريات** متعددة BOQ لكل صنف · إصلاح `boqApi.list(?projectId=)` في الصرف.

> **نقطة التوقف (2026-06-26):** **Shell single-module** · **Settings admin** · **حفظ إعدادات العرض** (theme/language/defaultModule `none`) · **إصلاح TDZ crash** · Release **1.0.3** على Railway/Electron.

> **نقطة التوقف (2026-06-27):** **تسوية عهدة** (اعتماد قبل GL) · **IPC مقاول** (اعتماد PM) · **معاينة فاتورة** · migration `20260627120000_custody_settlements`.

### جلسة 2026-07-27 — فاتورة آجلة / نقدية

| المجال | الحالة | ملاحظات |
|--------|--------|---------|
| **paymentType** | ✅ | `credit` \| `cash` على `purchase_transactions` |
| **قيد الدائن** | ✅ | آجلة → 21101… · نقدية → 12102… عبر `supplierAccountCode` |
| **UI** | ✅ | مبدّل في النموذج · زر جديد أعلى الشريط الجانبي |

**Golden paths:**
- [ ] فاتورة آجلة → Cr مورد 21101…
- [ ] فاتورة نقدية → Cr عهدة/صندوق 12102…
- [ ] زر «فاتورة جديدة» أعلى القائمة الجانبية

### جلسة 2026-07-24 — BOQ materials + فاتورة مشتريات + صرف

| المجال | الحالة | ملاحظات |
|--------|--------|---------|
| **شارات / منع حذف / وراثة** | ✅ | `boqMaterials` endpoints · `DeleteBlockedModal` · inherit على بند جديد + VO |
| **ربط فوري من الصرف** | ✅ | `QuickLinkMaterialModal` · قائمة بنود **المشروع** (`?projectId=`) |
| **تقرير غير المربوط** | ✅ | `UnlinkedMaterialsReport` من رصيد المخزون |
| **فاتورة — BOQ متعدد** | ✅ | `boqItemIds[]` · فلتر مركز تكلفة / مشروع مخزن · بيانات الصنف مستقلة |
| **إصلاح 404 boq-items** | ✅ | لا تستدعِ `boqApi.list(id)` بدون query string |

**Golden paths (2026-07-24):**
- [ ] BOQ → شارة عدد الروابط · حذف بند مربوط → نافذة عائمة
- [ ] مخزون → صرف → ربط فوري → بنود مشروع الصرف تظهر
- [ ] مخزون → تقرير الربط
- [ ] فاتورة مشتريات → مركز تكلفة → بنود ذلك العقد فقط · ربط صنف بعدة بنود بدون تغيير وصف الصنف
- [ ] VO جديد ببند جديد → وراثة روابط من المصدر إن وُجدت

### جلسة 2026-07-31 — BOQ report links (IPC + custody)

- ✅ اعتماد مستخلص باطن يكتب `boq_actual_costs` (`subcontractor`) — تقارير فقط، GL كما هو
- ✅ تسوية عهدة: ربط BOQ اختياري → `custody` عند الاعتماد
- ✅ `npm run local:backfill-ipc-custody-boq` للمستندات المعتمدة سابقاً
- ✅ Dashboard `spent-by-contract` = materials فقط

### جلسة 2026-07-31 — Budget vs Actual actuals

- ✅ الفعلي لكل المستويات (مشروع/عقد/بند) من `boq-cost-breakdown` — لا `projectStats.costs` (GL) على مستوى المشروع
- ✅ يطابق تبويب تكاليف BOQ؛ لا يتأثر بإقفال الدخل / مصروف غير مربوط ببند

### جلسة 2026-07-31 — Dashboard unallocated vs period close

- ✅ «غير موزّع» ≠ قفل الفترة / إقفال الدخل — فقط OHA يخصم العمومية من الصف
- ✅ تاريخ قيد OHA = يوم الإغلاق داخل الربع (`resolveOverheadCloseJournalDate`) لا `periodEnd` المستقبلي
- ✅ تصحيح محلي لقيود `OHA-Q3-2026-*` من 09-30 → 07-31 · السكربت: `npx tsx server/src/scripts/fixOhaEarlyCloseDates.ts`

### جلسة 2026-06-27 — Actual Costs (custody · IPC · invoice)

| المجال | الحالة | ملاحظات |
|--------|--------|---------|
| **تسوية عهدة** | ✅ | `custody_settlements` · `SET-{projectCode}-NNNN` · approve → GL |
| **IPC مقاول** | ✅ | draft/submitted/approved · `POST /purchase-transactions/:id/approve` |
| **فاتورة مشتريات** | ✅ | نقر صف → معاينة · `invoiceLines` في API |
| **Migration** | ⬜ نشر | `npx prisma migrate deploy` على Railway بعد push |

### جلسة 2026-06-26 — Shell + Settings admin

| المجال | الحالة | ملاحظات |
|--------|--------|---------|
| **موديول واحد** | ✅ | `shellWindowPolicy.ts` — إغلاق الموديول السابق؛ calculator coexist |
| **ERP workspace** | ✅ | `navigateToModule` · `closeShellOverlayWindows` · `erp.closeWorkspace` |
| **Per-user UI module visibility** | ✅ | Admin Settings → Users · `visibleShellModules` in `user_prefs` · nav filter only (`shellModuleVisibility.ts`) |
| **Settings admin tabs** | ✅ | `cost_centers` / `activity` / `sample_data` — `usePermissions().isAdmin` + `SETTINGS_ADMIN_VIEW_IDS` |
| **اختبارات** | ✅ | `shellWindowPolicy.test.ts` · `moduleViewPermissions.test.ts` |

### جلسة 2026-06-26 (مساءً) — إعدادات العرض + TDZ

| المجال | الحالة | ملاحظات |
|--------|--------|---------|
| **حفظ التفضيلات** | ✅ | `userPreferences.ts` — `saveUserPreferences` · `canPersistUserPreferences` (session cookie ≠ Firebase فقط) |
| **شاشة البداية «دون»** | ✅ | `resolveSavedDefaultModulePreference()` — لا يُعاد mapping إلى `ledger` |
| **طباعة admin** | ✅ | `PrintSettingsPanel` في `GeneralSettings` — `usePermissions().isAdmin` |
| **TDZ crash** | ✅ | `USER_PREFS_UPDATED_EVENT` listener **بعد** `userPermissions`/`defaultModuleRef` في `App.tsx` |
| **اختبارات** | ✅ | `shellNavigation.test.ts` (4) |

**Golden paths (2026-06-26):**
- [ ] كل ثيم: Palette (إعدادات عامة) → Ledger → الإعدادات تُغلق
- [ ] admin + local: Settings → مراكز غير مباشرة + سجل نشاط (sidebar + ERP menu)
- [ ] Calculator مفتوحة → فتح Ledger → الحاسبة تبقى
- [ ] إعدادات العرض: تغيير ثيم/لغة/«دون» → إغلاق التطبيق → القيم محفوظة
- [ ] admin: Palette → إعدادات الطباعة → حفظ → تظهر في التقارير
- [ ] التطبيق يحمّل بدون `Cannot access 'T' before initialization`

### مرجع صيانة (المراحل 0–12 مغلقة)

```
@CLAUDE.md @DEPLOYMENT_PLAN.md
✅ Railway · Postgres · Electron v1.0.3 · GitHub Release v1.0.3 · electron-updater
⬜ (اختياري) export-firestore-users → migrate --users
⬜ (اختياري) توقيع Setup.exe
```

### ما تم التحقق منه (golden paths + Electron + تعدد أجهزة ✅)

- [x] تسجيل Google · admin `myline78@gmail.com`
- [x] دفتر اليومية — **31** قيد
- [x] المشاريع / العقود / BOQ
- [x] المستخلصات (IPC)
- [x] التقارير / Dashboard (KPIs)
- [x] **Setup.exe** — جهاز 1 + **جهاز 2** (Windows، بلا Node)
- [x] **تحويل مخازن بين المشاريع (PTRF)** — يظهر على الجهازين فوراً
- [x] **Golden paths:** فاتورة مشتريات · صرف · شيكات (Railway + Electron)
- [x] **صرف متعدد BOQ** — GL ذري (عدة Dr + Cr) · `docs/CONSUMPTION_MULTI_BOQ_PLAN.md` · `npm run test:consumption`
- [x] **BOQ rate breakdown** — migration `20260628120000` · حفظ rates من الواجهة · `npm run local:backfill-boq-rates` · `boqPricing.ts` للتقارير
- [x] **React list keys** — `listKey` / `compositeListKey` في `utils.ts` (BOQ · COA · Inventory · Reports)
- [x] **صلاحيات محدودة:** `momamo242@gmail.com` — يعمل ضمن نطاق `project_accountant`

### بيانات Postgres بعد الترحيل (مرجع)

| الجدول | الاستيراد | Postgres | السبب |
|--------|-----------|----------|--------|
| `transactions` | 10 | **31** | +21 `backfill-gl` |
| `journal_entries` | 21 | **73** | بنود إضافية |
| `chart_of_accounts` | 153 | **161** | +8 seed / 127… |
| `project_inventory_transfers` | 3 | 3–4 | +1 استخدام التطبيق |

**تسلسل Railway:** `local:migrate` → `local:backfill-gl` → `local:verify-postgres` → `local:promote-google-admin` · (بعد migration rates) **`npm run local:backfill-boq-rates -- --live`** على Postgres الهدف

**تطوير محلي:** إذا `npm run dev:local` يفشل بـ **`EADDRINUSE :3000` أو `:3001`** — أوقف العمليات القديمة على **كلا المنفذين** قبل إعادة التشغيل؛ وإلا المتصفح يعرض bundle قديم (تحذيرات React متكررة).

| المرحلة | الحالة | ملاحظات |
|---------|--------|---------|
| نسخ احتياطي SQLite | ✅ تم | `D:\cost web app\backups\20260614-055130\` |
| نسخ احتياطي Firestore | ✅ تم | `backup_2026-06-14.json` |
| 0 — تجهيز البيئة | ✅ تم | PostgreSQL 16.14 native؛ `web_cost_app` |
| 1 — مخطط Prisma | ✅ تم | **43 جدولاً** |
| 2 — تحويل الموديولات | ✅ تم | كل مسارات API على Postgres |
| 3 — توحيد الصلاحيات | ✅ تم (خادم) | CRUD JSON · Bearer+session |
| 4 — ترحيل البيانات | 🟡 | **Railway ✅** migrate+backfill · GL 31 · Firestore users ⬜ |
| 5 — تحويل الواجهة للـ API | ✅ **~95%** | |
| 6 — نشر Railway | ✅ | `web-cost-app-production.up.railway.app` |
| 7 — نشر الواجهة | ✅ | SPA + golden paths UI |
| 8 — Electron | ✅ | popup OAuth · `electronShell.ts` · login يعمل |
| 9 — حماية الكود | 🟡 | أسرار غير مضمّنة ✅ · Offline sync ✅ · obfuscator ⬜ · توقيع Setup.exe ⬜ |
| 10 — Setup.exe | ✅ | **1.0.3** · GitHub Release **v1.0.3** ✅ |
| 11 — التحديث | ✅ | المحتوى Railway · **electron-updater** GitHub Releases |
| 12 — اختبار وإطلاق | ✅ | golden paths ✅ · Electron login ✅ · PTRF ✅ · ERP mode ✅ |

**آخر تحديث:** 2026-08-13 — **الوضع الافتراضي** (شركة فارغة + COA، إبقاء `myline78@gmail.com`) · نسخة Postgres كاملة (`prod:export-backup` / `local:export-backup`) قبل رفع بيانات الشركة · إصلاح تصدير `warehouse_receipts`. 2026-08-08 — تفكيك ActualCosts/Inventory · تخفيف lag Electron.

**أوامر سريعة:**
```powershell
npm run electron:pack
$env:WEB_COST_APP_URL="https://web-cost-app-production.up.railway.app"
$env:GH_TOKEN="ghp_..."; npm run electron:publish   # Release v1.0.3
npm run local:set-user-role -- <email> project_accountant [--contracts id1,id2]
```

**ملاحظة تحويل Prisma (نمط متبع):** كل handler يصبح `asyncHandler(async …)`؛ استبدل `getDb().prepare(...).all/get/run` بـ `await prisma.<model>.findMany/findUnique/create/update/deleteMany`؛ غلّف العمليات متعددة الجداول بـ `prisma.$transaction(async (tx) => …)`؛ مرّر كل استجابة عبر `serialize(...)` (تحويل Decimal→number ضروري). لا تعتمد على try/catch داخل `$transaction` للاستمرار بعد خطأ (Postgres يُجهض المعاملة) — استخدم تحقّقاً مسبقاً أو مجموعات في الذاكرة.

### Railway (مرجع سريع)
- **URL:** `https://web-cost-app-production.up.railway.app`
- سكربتات محلية: **`DATABASE_PUBLIC_URL`** (`*.proxy.rlwy.net`) — **لا** `postgres.railway.internal`
- admin: `myline78@gmail.com` (`npm run local:promote-google-admin -- myline78@gmail.com`)
- ترحيل: `migrate` → **`backfill-gl`** (إلزامي للوصول إلى GL 31) → `verify-postgres`
- 403 login: صلاحيات Postgres فارغة — promote-google-admin (أو `BOOTSTRAP_ADMIN_EMAIL` بعد push)

### بيئة التطوير المحلية (مرجع سريع)
- Postgres: خدمة `postgresql-x64-16`، أدوات في `C:\Program Files\PostgreSQL\16\bin`، مستخدم `postgres` / كلمة `postgres` / منفذ `5432`.
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/web_cost_app` (في `.env`).
- لا Docker على هذا الجهاز — استُخدم تثبيت native عبر winget.
