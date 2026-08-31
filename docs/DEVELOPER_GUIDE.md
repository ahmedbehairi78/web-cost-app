# دليل المطوّر — التعديل على التصميم والكود

> دليل عملي لأي مطوّر يعدّل على **Web Cost App**. الهدف: تعرف **من أين تبدأ**، و**ما القواعد التي لا يجوز كسرها**، و**كيف تضيف/تعدّل** بأمان دون كسر المحاسبة أو الصلاحيات أو الثيمات.
>
> هذا الدليل مكمّل لـ **`CLAUDE.md`** في جذر المشروع (المرجع المعماري الكامل). إذا تعارض شيء، فـ `CLAUDE.md` هو المصدر الأحدث للسلوك المحاسبي.
>
> **سير العمل الإلزامي:** قبل أي إصلاح أو تحسين، راجع **`CLAUDE.md`** · **`CONTEXT.md`** · **`DEPLOYMENT_PLAN.md`** · **هذا الملف** — ثم **حدّثها** بعد نجاح التنفيذ والاختبار.

---

## 0. خريطة سريعة

| تريد أن… | اذهب إلى القسم |
|----------|----------------|
| تعرف سير مراجعة/تحديث التوثيق | [0.1 سير العمل](#01-سير-العمل-قبل-وبعد-التعديل) |
| تشغّل المشروع محليًا | [1. البداية السريعة](#1-البداية-السريعة) |
| تفهم البيئات الثلاث (محلي / Railway / Electron) | [2. البيئات](#2-البيئات-data-backends) |
| تعدّل ألوان / ثيم / واجهة | [3. التصميم والـ UI](#3-التصميم-والـ-ui) |
| تفهم سلوك الإدخال الشبيه بإكسل | [3.10 إدخال إكسل](#310-سلوك-الإدخال-الشبيه-بإكسل) |
| تعدّل shell / نوافذ / ERP | [3.7 سياسة موديول واحد](#37-سياسة-موديول-واحد-shell) |
| تعدّل أقسام الإعدادات (admin) | [3.8 الإعدادات — أقسام admin](#38-الإعدادات--أقسام-admin) |
| تعدّل حفظ إعدادات العرض (ثيم · لغة · شاشة البداية) | [3.9 تفضيلات المستخدم](#39-تفضيلات-المستخدم--إعدادات-العرض) |
| تضيف موديول / نافذة جديدة | [4. إضافة موديول جديد](#4-إضافة-موديول-جديد) |
| تضيف API endpoint أو migration | [5. الخادم وقاعدة البيانات](#5-الخادم-وقاعدة-البيانات-postgresprisma) |
| تعرف القواعد الحساسة الممنوع كسرها | [6. القواعد الذهبية](#6-القواعد-الذهبية--لا-تكسرها) |
| تعدّل فاتورة مشتريات / ربط BOQ↔أصناف / صرف فوري | [6.5 التكاليف](#65-التكاليف-الفعلية--سير-العمل-2026-06-27--محدّث-2026-07-24) · [6.5.0 ربط](#6500-ربط-boq--أصناف-المخزون-2026-07-24) |
| تختبر قبل أي PR | [7. الاختبار وسير العمل](#7-الاختبار-وسير-العمل) |

### 0.1 سير العمل (قبل وبعد التعديل)

1. **اقرأ** `CLAUDE.md` + `CONTEXT.md` + `DEPLOYMENT_PLAN.md` + هذا الدليل — افهم القواعد المعمارية والمحاسبية قبل الكود.
2. **نفّذ** التغيير بأقل diff ممكن؛ اتبع conventions الموجودة.
3. **اختبر** (`npm run test` للملفات المتأثرة، golden path يدوي عند الحاجة).
4. **حدّث التوثيق** في نفس الجلسة: `CLAUDE.md` (handoff + key files) · `CONTEXT.md` (نظرة عامة ar) · `DEPLOYMENT_PLAN.md` (حالة التقدّم) · `docs/DEVELOPER_GUIDE.md` (إرشادات المطوّر).

---

## 1. البداية السريعة

كل الأوامر من مجلد **`web-cost-app/`** (أو من جذر `cost web app/` الذي يمرّرها بـ `--prefix`).

```bash
npm install               # أول مرة فقط
npm run dev:local         # Vite :3000 + Express API :3001 معًا (الوضع المفضّل)
```

- افتح **`http://localhost:3000`** فقط — **ليس** `127.0.0.1` (يعيد التوجيه عبر `devOriginGuard.ts`، وVite بـ `strictPort`).
- المخازن / المواد / الفواتير الموزّعة **تتطلب** تشغيل الـ API على `:3001`. لو ظهر `ECONNREFUSED 127.0.0.1:3001` فالـ API غير شغّال.
- لو ظهر **`EADDRINUSE :3000` أو `:3001`** فهناك عملية قديمة تخدم bundle/API قديم: أوقفها على **المنفذين** (`netstat -ano | findstr :3000` و `:3001` ثم `taskkill /PID … /F`) ثم أعد `npm run dev:local` و **`Ctrl+Shift+R`** في المتصفح.

أوامر تطوير شائعة:

```bash
npm run lint        # فحص الأنواع فقط (tsc --noEmit)
npm run test        # Vitest — يشمل happy-dom لملفات DOM (تنسيق طباعة · جسر خمول)
npm run build        # بناء إنتاج
```

---

## 2. البيئات (Data Backends)

في وضع التطوير النموذجي توجد **ثلاث قواعد بيانات منفصلة** — الأعداد (مثل عدد قيود GL) **ستختلف** حتى المزامنة.

| العميل | مصدر البيانات | ملاحظات |
|--------|---------------|---------|
| **`localhost:3000`** + `VITE_DATA_BACKEND=local` | Postgres المحلي (`DATABASE_URL`) | الكتابات أثناء التطوير تنزل هنا أولًا |
| **Electron** (Setup) | Railway (مضمّن في `electron/dist/production-url.json`) | لا قاعدة محلية — يقرأ الموقع المستضاف |
| **المتصفح → Railway URL** | Postgres على Railway | نفس بيانات Electron |

**المتغيّر الحاسم** `VITE_DATA_BACKEND`:
- `local` → يفعّل APIs المحلية (`isLocalBackend = true` في `src/lib/dataBackend.ts`). الكتابات التشغيلية تمرّ عبر **Express API + Postgres**، لا Firestore مباشرة.
- غير مضبوط في build **لكن** `VITE_API_BASE_URL=/api` على Railway → `resolveDataBackend()` يختار **local** تلقائيًا (full-stack).
- `firebase` صريح → الوضع السحابي القديم (Firestore).

**Firebase = للمصادقة فقط** (Google sign-in) في النظام الكامل الجديد.

### 2.1 تسجيل الدخول بكلمة المرور (Electron / Railway)

- **Electron** يستخدم **password login** دائمًا (`mustPasswordLogin()` في `sessionLogout.ts`) — **لا يوجد Firebase user** بعد الدخول.
- الجلسة = cookie Express (`web_cost_sid`) + دور/صلاحيات من **Postgres** عبر `authApi.login` / `authApi.me`.
- **`useUserAccessScope`** (local): **`role` من `PermissionsContext`** (يُزامَن من `App.tsx`)؛ **`assignedContractIds` من `/auth/me` فقط** — لا تربط الدور بـ `onAuthStateChanged` وحده (كان يعيد admin → user ويُفرغ Inventory).
- **`POST /auth/login`**: يستدعي `req.session.save()` قبل الرد.
- **ترحيل القيود:** `accountingService.createTransaction` يستخدم **`assertJournalWriteAuth()`** — في local/Railway **لا** يشترط `auth.currentUser` (كان يظهر «User not authenticated» / Firestore Error عند حفظ فاتورة أصل ثابت).
- **سجل الأصول vs الميزانية:** BS من أرصدة GL على `11…`؛ السجل من `fixed_assets`. إن وُجد قيد بدون صف سجل → **مزامنة من الدفتر** (`POST /api/fixed-assets/sync-from-gl`) أو `npx tsx server/src/scripts/syncFixedAssetsFromGl.ts`.
- رفع admin على Railway: `npx tsx server/src/scripts/promoteGoogleAdminPg.ts <email>` مع `DATABASE_URL` = Railway public URL.

> قاعدة ذهبية: عند الكتابة لأي feature جديدة، اسأل دائمًا «هل هذا يعمل في `isLocalBackend`؟». معظم الـ bugs تأتي من افتراض Firestore بينما المستخدم في الوضع المحلي.

---

## 3. التصميم والـ UI

### 3.1 الثيمات — أربعة أوضاع

التطبيق يدعم **`dark` / `light` / `soft` / `erp`** (المصدر: `src/lib/shellTheme.ts`).

- **الثيم الافتراضي** للجلسات الجديدة هو **`erp`** (`coerceAppTheme` fallback) — وللجلسات غير المصادَقة `soft` في بعض المسارات (راجع `readSaved()` في `LanguageContext`).
- ثيم `erp` يستخدم **شريط علوي أفقي** بدل الـ sidebar — تحقق عبر `usesTopNav(mode)`.
- الثيم القديم `odoo` يُطبَّع تلقائيًا إلى `erp` عبر `normalizeStoredTheme`.

**القاعدة #1 في التصميم: لا تكتب ألوان hex مباشرة في مكوّنات الـ shell.** استخدم خرائط Tailwind المركزية:

```ts
import { shellTheme, shellNavActive, shellAppBackground, isSoftLikeTheme } from '../lib/shellTheme';

const shell = shellTheme(theme);          // ShellThemePalette
<aside className={shell.sidebarSurface}>   // بدل bg-white text-... المكتوبة يدويًا
```

`ShellThemePalette` يغطّي: `sidebarSurface`, `navMuted`, `navOpen`, `wmTitleBar`, `wmWindow`, `taskbar`, `topNavBar`, … إلخ. **وسّع `shellTheme.ts` أولًا** قبل نسخ أي hex في UI جديد.

حالات عنصر التنقّل الثلاث (في الـ Sidebar):
1. **Active** — `shellNavActive(theme)` (أزرق / موف في erp).
2. **Open but not active** — `shell.navOpen` + نقطة عبر `shellNavOpenDot`.
3. **Closed** — `shell.navMuted`.

متغيّرات erp اللونية (`--erp-primary`, `--erp-border`, …) معرّفة في **`src/index.css`** — عدّلها هناك لا في المكوّنات.

### 3.2 حفظ تفضيلات المستخدم (ثيم / لغة)

- **لا تستدعِ `setTheme('dark')` ثابتًا أبدًا** — استخدم القيمة المحفوظة دائمًا.
- `setTheme()` / `setLanguage()` في `LanguageContext` يكتبان إلى `localStorage` فورًا.
- التغيير من واجهة المستخدم يمرّ عبر **`GeneralSettings.tsx`** الذي يكتب أيضًا `defaultTheme` إلى Firestore `users/{uid}` (سحابي) أو `settingsApi.patchUserPreferences` (محلي).
- عند تسجيل الدخول، `App.tsx` يقرأ الثيم المحفوظ.

### 3.3 الترجمة و RTL (إلزامي)

العربية هي اللغة الأساسية. **ممنوع** أي نص عربي/إنجليزي ثابت في الـ JSX.

```tsx
// ❌ خطأ
<button>حفظ</button>
<span>{language === 'ar' ? 'حفظ' : 'Save'}</span>

// ✅ صحيح
const { t } = useLanguage();
<button>{t('save')}</button>
```

- كل المفاتيح في **`src/context/LanguageContext.tsx`** (خريطتا ar/en).
- `LanguageContext` يسجّل `console.warn` لأي مفتاح ترجمة ناقص في التطوير.
- اللغة المحلية (`'ar-EG'`) تأتي من `locale` في الـ context — **لا تكتبها يدويًا**.
- مفاتيح دليل الاستخدام تبدأ بـ `manual_*`.

### 3.4 عرض الأرقام والأموال

- **المال (EGP) — منزلتان عشريتان** — اعرض عبر `formatMoney()` من `useLanguage()` (صيغة `0.00`). `roundMoney()` عند الحفظ/الترحيل. لا تستخدم `formatMoney(0)` كقيمة ابتدائية في `Array.reduce` — اجمع الأرقام أولًا ثم `formatMoney(total)`.
- **الكميات** تُعرض عبر `formatQuantity(n, language)` (**منزلتان** بلا أصفار إجبارية) — نفس تقريب المال (`roundQty` / `roundMoney`).
- مدخلات المال: **`step="0.01"`** على فواتير المشتريات/الأصل الثابت؛ حقول أخرى قد تبقى `step="1"` حسب الشاشة.

### 3.5 العلامة التجارية (Concord Plus)

- الألوان: Navy `#003B71` · Orange `#F58220` — في `src/lib/concordPlusBrand.ts`.
- أصول SVG في `public/branding/` تُولَّد من سكربت: بعد أي تغيير في الـ tokens شغّل **`npm run branding:sync`** (وللأيقونات `npm run branding:icons`).
- شعار الترويسة عبر `resolveHeaderLogo()`.

### 3.6 الطباعة

- **كل الطباعة موحّدة عبر منصة `reportDocument`** (`src/lib/reportDocument/`): يُبنى **`ReportDocument`** (جداول أو أقسام شهادات `keyValue`/`table`/`summary`/`signatures`/`note`) ثم يُعرض في **`ReportPreviewDialog`** (معاينة iframe عبر **Blob URL** + `sandbox="allow-same-origin allow-modals"` + طباعة + PDF + حفظ التصميم) عبر hook **`useReportDocumentPreview`**. `allow-modals` مطلوب لحوار الطباعة؛ لا `allow-top-navigation`. لا تستخدم `srcDoc` غير مُقيَّد لمستند HTML كامل — في Electron يُفرّغ الإطار الرئيسي إلى `about:blank` ويظهر تسجيل الدخول.
- بناة المستندات: **`buildTableReportDocument`** للكشوف الجدولية · **`buildCertificateDocs.ts`** لشهادات IPC / MOS / أوامر التغيير / تسوية العهدة. طباعة مستخلص العميل: **صفحة كفر** (`coverPage.isolate`) بثلاثة شعارات + عنوان تحت الأوسط + الأقسام الثلاثة بدون فوتر؛ ثم قائمة الكميات في الصفحات التالية. شعارات الترويسة: افتراضي من `company_info`؛ تجاوز لكل مشروع عبر `projects.coverLogoLeft|Center|Right` (`mergeCompanyPrintInfoWithProject`).
- تصاميم الطباعة لكل تقرير في **`src/lib/reportPrintProfiles.ts`** وتُحفَظ عبر **`reportPrintProfilesPersistence.ts`** (local backend أو Firestore) — التحرير من شريط التنسيق داخل حوار المعاينة (يشمل **محاذاة خلايا الجدول** `tableCellAlign`) ومن **شريط عائم عند تحديد النص** (`ReportSelectionMiniToolbar`). **حفظ التصميم** يخزّن الاثنين (`selectionPatches` حسب فهرس الجدول/الورقة **وحقول `.kv-item` في الشهادات**). الطباعة/PDF تأخذ HTML المعاينة بعد التعديل. `PrintSettingsPanel` في إعدادات العرض = بيانات الشركة فقط.
- **المسار القديم أُزيل** (2026-07-31): لا `printReport.ts` / `triggerReportPrint` / استنساخ DOM، ولا `html2pdf.js` / `jspdf`. لا تستدعِ `window.print()` مباشرة على DOM النافذة — ابنِ `ReportDocument` وافتح المعاينة.

### 3.7 سياسة موديول واحد (shell)

**الملف المركزي:** `src/lib/shellWindowPolicy.ts`

| الثيم | آلية الفتح | السلوك |
|-------|------------|--------|
| dark / soft / light | `App.tsx` → `openWindow` | يُغلق الموديول السابق (لا minimize stack) |
| erp | `TopNavBar` → `navigateToModule` | workspace slot واحد + إغلاق overlays |

- **`SHELL_COEXIST_MODULE_IDS`**: `['calculator']` فقط — الآلة الحاسبة تبقى مع أي موديول.
- **`display` / `general`**: إعدادات العرض — تُغلق عند فتح أي موديول رئيسي؛ وفتحها يغلق workspace ERP.
- **`manual`**: sidebar = نافذة exclusive؛ ERP = slot في `ErpWorkspace`.

**عند إضافة موديول جديد:** لا تتجاوز `openWindow` / `navigateToModule`.

```powershell
npm run test -- src/lib/shellWindowPolicy.test.ts
```

### 3.8 الإعدادات — أقسام admin

**`Settings.tsx`** — أقسام admin من **`usePermissions().isAdmin`**، **لا** `authApi.me()` منفصل.

| viewId | شرط |
|--------|-----|
| `cost_centers` | admin + `isLocalBackend` |
| `activity`, `sample_data` | admin |
| `coa` | `settings` + `ledger.view` |

- **صيانة البيانات:** المسح بالمجموعات **لا** يفرّغ المشاريع/العقود/BOQ/الأصناف/حسابات البنوك/طلبات الشراء/التنبيهات. للشركة الفارغة استخدم **«الوضع الافتراضي»** → `POST /api/financial-maintenance/factory-reset` (يُبقى `myline78@gmail.com` + شجرة الحسابات القياسية). بعد النجاح: رسالة «تم العودة إلى الوضع الافتراضي» وزر «إعادة الدخول» — لا `quit` فوري. Electron = Railway Postgres؛ `dev:local` = Postgres المحلي.
- **`SETTINGS_ADMIN_VIEW_IDS`** في `canOpenModuleView(..., { isAdmin })`.
- **`TopNavBar`**: كل sub-view يمرّ عبر `canOpenModuleView`.
- **نوافذ عائمة متسلسلة:** `SettingsFloatingDialog` (portal + `SHELL_MODAL_Z` / `SHELL_MODAL_STACK_Z`) لـ Backup · Clear · User · `AdminSensitiveVerifyModal`. الأب يُخفى أثناء التحقق ثم يعود. تأكيد تعطيل مركز تكلفة عبر `useConfirm()` (لا `window.confirm`).

```powershell
npm run test -- src/lib/moduleViewPermissions.test.ts
```

### 3.9 تفضيلات المستخدم — إعدادات العرض

**الموقع:** **`GeneralSettings.tsx`** (module id `display` / `general`) — زر **Palette** في الشريط السفلي أو ERP footer.

| الحقل | API / تخزين |
|-------|-------------|
| `defaultTheme` | `saveUserPreferences({ defaultTheme })` |
| `defaultLanguage` | `persistLanguagePreference()` من Sidebar/TopNav |
| `defaultModule` | `saveUserPreferences({ defaultModule })` — **`none`** = سطح مكتب فارغ |

**نوافذ سطح المكتب (Electron فقط):**

| الإجراء | المسار |
|---------|--------|
| زر الشريط بجانب الإعدادات العامة / **Ctrl+N** | `createAppWindow({ reuseSession: true })` → preload `reuseSession` → SPA يتخطى cold-start ويستعيد الجلسة عبر `sessionProbe` |
| كشف New GUI | sync IPC `query-reuse-session` · `?webCostReuseSession=1` · argv — لا تعتمد على argv وحدها في المثبّت |
| اختصار لوحة المفاتيح | في `before-input-event`: **`input.code === 'KeyN'`** (+ `preventDefault`) — ثابت بغض النظر عن تخطيط اللوحة |
| الجلسة | نفس `partition: persist:webcost` — كوكيز `web_cost_sid` مشتركة؛ النافذة **مخفية** حتى الجاهزية ثم `window-reveal` — **بدون** شاشة login |
| سياسة الموديول | single-module **لكل** نافذة OS؛ نافذتان = موديولان معاً |
| مثبّت سطح المكتب | الواجهة من Railway؛ **فتح النافذة من القشرة** — بعد تغيير `electron/main.ts` لازم `electron:publish` (أو Setup محلي ≥ 1.0.7) |

**الملفات:**

| الملف | الدور |
|-------|-------|
| `src/lib/userPreferences.ts` | `saveUserPreferences` · `canPersistUserPreferences` · `USER_PREFS_UPDATED_EVENT` |
| `src/lib/shellNavigation.ts` | `resolveSavedDefaultModulePreference` — لا يحوّل `none` → `ledger` |
| `src/lib/electronShell.ts` | `requestOpenNewWindow` · `isDesktopSessionReuseWindow` · `requestRevealDesktopWindow` |
| `src/components/Sidebar.tsx` · `TopNavBar.tsx` | زر Electron-only بجانب Palette |
| `electron/main.ts` | `createAppWindow` · `appWindows` · `input.code` للاختصارات · لا OAuth lifecycle على نوافذ التطبيق |
| `server/src/modules/settings.ts` | `GET/PATCH /api/settings/user-preferences` (+ `defaultLanguage` · `visibleShellModules` on GET) · admin `GET/PATCH …/user-preferences/:userId` |
| `src/lib/shellModuleVisibility.ts` | UI-only nav whitelist — admin per user; never gates API/`openWindow` |

**قواعد:**

- **Local mode:** الحفظ يعتمد على **جلسة Express** — لا تتحقق من `auth.currentUser` فقط (`canPersistUserPreferences()`).
- **Cloud:** Firestore `users/{uid}` عبر `saveUserPreferences`.
- **`App.tsx`:** مستمع `USER_PREFS_UPDATED_EVENT` **بعد** تعريف `userPermissions` / `userRole` / `defaultModuleRef` — تجنّب **TDZ** (`Cannot access '…' before initialization`).
- **Ctrl+N:** قارن **`input.code`** وليس `input.key` وحده — وإلا يفشل الاختصار مع لوحة عربية.
- **كشف New GUI في المثبّت:** preload يستخدم sync IPC `query-reuse-session`؛ SPA تقبل أيضاً `?webCostReuseSession=1`.
- **نشر القشرة:** بعد تعديل `electron/main.ts` / `preload.ts` شغّل `npm run electron:build:shell` ثم **`electron:publish`** للأجهزة المثبّتة (تحديث SPA عبر Railway لا يحدّث القشرة).
- **تحديث محتوى Railway:** حوار أصلي في قشرة Electron (`hostedSpaUpdate.ts`) — **لاحقاً** افتراضي. الآن = مسح كاش + إعادة تحميل مع بقاء الجلسة. **مهم:** reload داخل نفس النافذة **ليس** cold start — `keepSessionOnLoad` (preload) + `DESKTOP_WINDOW_SESSION_KEY`؛ 401 أثناء النشر يُؤكد عبر `session-probe` ثم قفل كلمة مرور في Electron. إغلاق معاينة الطباعة لا يُعيد `loadURL` كبداية باردة. جرس الواجهة تأكيد إضافي (`spaBuild.ts`). قشرة **≥ 1.0.9**.

```powershell
npm run test -- src/lib/sessionLogout.test.ts src/lib/apiSession.test.ts src/lib/spaBuild.test.ts
npm run electron:build:shell
# بعد التحقق: git push (SPA) ثم electron:publish (Setup 1.0.9)
```

### 3.10 سلوك الإدخال الشبيه بإكسل

مثبّت مرة واحدة من **`src/main.tsx`** عبر `installExcelLikeInputBehavior()` (`src/lib/excelLikeInputs.ts`).

| السلوك | أين |
|--------|-----|
| التركيز → تحديد كامل للقيمة (الكتابة تستبدل المحتوى) | حقول `text` / `number` / `search` / … و `textarea` في التطبيق كله |
| أسهم ←→↑↓ · Enter · Tab | بين الخلايا داخل أي `<table>` فيه حقول قابلة للتحرير |
| أسهم ←→↑↓ خارج الجداول | أقرب حقل داخل نطاق ضيق (dialog / `fixed inset-0` / form / table) — **لا** مسح `#root` (كان يسبب تأخراً) |
| `input type="number"` + ↑/↓ | **لا** يزيد/ينقص القيمة — يتنقل للحقل فقط (حتى بلا جار) |
| أسهم أفقية أثناء التحرير | إن لم يكن النص محدداً بالكامل تبقى لتحريك المؤشر داخل الحقل (النص فقط) |

**استثناءات:**

| السمة | المعنى |
|-------|--------|
| `data-excel-nav="off"` | لا تنقل ولا تُدرَج في شبكة الجدول |
| `data-excel-select="off"` | لا تحديد تلقائي عند التركيز |
| `data-excel-nav="managed"` | شبكة تديرها `SpreadsheetCellInput` (مثل IPC في التكاليف الفعلية) |

```powershell
npm run test -- src/lib/excelLikeInputs.test.ts src/lib/spreadsheetGridNav.test.ts
```

---

## 4. إضافة موديول جديد

النوافذ تُحمَّل **بالكسل (lazy)** عبر `React.lazy` في **`src/components/WindowManager.tsx`**. الخطوات الكاملة لإضافة موديول `myfeature`:

1. **أنشئ المكوّن** `src/components/MyFeature.tsx` (export named أو default).
2. **سجّله lazy** في أعلى `WindowManager.tsx`:
   ```ts
   const MyFeatureLazy = lazyWithRetry(() => import('./MyFeature').then(m => ({ default: m.MyFeature })));
   ```
3. **أضِفه لخريطة المكوّنات** `MODULE_COMPONENTS`:
   ```ts
   myfeature: MyFeatureLazy,
   ```
4. **أضِف التسمية والترتيب** في `src/constants/modules.ts`:
   - في `STARTUP_MODULES` (يظهر في الـ Sidebar وقائمة موديول البدء) — أو فقط في `MODULE_LABELS` لو أداة مساعدة لا تظهر في البدء.
5. **الصلاحيات**: أضِف مفتاح الموديول إلى `UserPermissions` في `src/types.ts` و`DEFAULT_PERMISSIONS`/`ALL_PERMISSIONS`، وعالِجه في `src/lib/permissions.ts` (`moduleAccess`). لا تضف حزم أدوار. الـ Sidebar يفلتر عبر `moduleAccess(permissions, id).view`.
6. **(اختياري) موضوع دليل الاستخدام**: أضِف `ManualTopicId` + مدخلًا في `MANUAL_TOPICS` (`src/lib/operationsManual.ts`)، ومفاتيح `manual_*` في `LanguageContext`، وزر `<ManualHelpButton topicId="…" />` على الشاشة. ثم `npm run test -- src/lib/operationsManual.test.ts`.
7. **عزل الأعطال**: كل نافذة ملفوفة تلقائيًا بـ `WindowErrorBoundary` — لا حاجة لإجراء إضافي، لكن لا تترك أخطاء غير معالَجة تتسرّب.

> أدوات الـ shell (`display` / `calculator` / `manual`) مرئية لكل المستخدمين المسجّلين بلا فحص صلاحيات — راجع `SHELL_UTILITY_MODULE_IDS`.
>
> **أوامر الشراء (`purchase_requests`, 2026-08-02):** نافذة مستقلة في الشريط لكل المستخدمين المسجّلين (`canOpenShellModule` / `canOpenModuleView` دائماً true). التنفيذ = تغيير حالة فقط (لا فاتورة / لا GL). BOQ picker عبر `GET /api/purchase-requests/boq-picker` يعيد **كود + وصف** فقط. إشعارات `purchase_request_pending` + واتساب لمستخدمي `purchase_requests.edit`. ملفات: `PurchaseRequests.tsx` · `server/src/modules/purchaseRequests.ts` · migration `20260802120000_purchase_requests`.
>
> **موازنة نقدية (`cash_budget`, 2026-08-20):** بعد البنوك في الشريط. لقطة أرصدة حتى نهاية الفترة — الالتزامات في جدول واحد (اسم الحساب الفرعي فقط + المشروع). الإجماليات أعلى التقرير = بنوك `12101` + خزينة `12102` + مستخلصات `12201`. **نسبة سداد المديونية** على الفترة: الموزَّع = الأقل بين بنوك `12101` والالتزامات × النسبة. **كل أوراق `12102` خارج المجمع.** استعاضة إن قلّ الرصيد عن الحد. جدول إجمالي لكل مشروع. **لا قيد GL.**

---

## 5. الخادم وقاعدة البيانات (Postgres/Prisma)

الخادم في **`server/`** (Express + TypeScript)، وقاعدة البيانات الأساسية **PostgreSQL عبر Prisma** (`prisma/schema.prisma`).

### إضافة API endpoint

1. أنشئ/عدّل راوتر في `server/src/modules/<name>.ts`.
2. سجّله في `server/src/app.ts`: `app.use('/api/<prefix>', <name>Router)`.
3. ضع `requireAuth` + `requirePermission('<module_key>')` على كل مسار محمي (`server/src/middleware/auth.ts`).
4. أضِف غلاف العميل في `src/services/local/modulesApi.ts` (مثل `banksApi`, `inventoryApi`).
5. في الواجهة اقرأ عبر **`useApiQuery(factory, deps)`** (`src/hooks/useApiQuery.ts`) — النمط الأساسي لقراءة Postgres في الوضع المحلي.

### أمان API (2026-08-22)

- **CORS إنتاج:** يجب `CORS_ORIGIN` أو `RAILWAY_PUBLIC_DOMAIN`. أصل المتصفح غير المطابق يُرفض. التطوير يبقى localhost + LAN.
- **JSON:** حد **2mb** على كل المسارات؛ استيراد النسخة الاحتياطية `POST /api/settings/backup-import` يبقى **50mb**.
- **رؤوس:** `X-Content-Type-Options` · `Referrer-Policy` · `X-Frame-Options: SAMEORIGIN` (بدون CSP صارم حتى لا يُكسر Google popup).
- **فحص البريد قبل Google:** `preLoginRateLimit` — 20 طلباً / 15 دقيقة لكل IP.
- **إنشاء مستخدم:** كلمة المرور **8 أحرف على الأقل** (`POST /api/auth/users` مثل PATCH).
- **`npm run local:bootstrap-admin`:** يتطلب `ADMIN_PASSWORD` في البيئة — لا كلمة افتراضية.

### Migration جديدة

- **لا تعدّل migration قديمة أبدًا** — أنشئ واحدة جديدة: `npx prisma migrate dev --name <desc>`.
- محلياً: **`npm run local:api`** / **`dev:local`** يشغّلان `prisma migrate deploy` قبل Express. على Railway تُطبَّق تلقائيًا عند الإقلاع (`start:api:prod`).
- بعد migrate على قاعدة يستخدمها API قيد التشغيل: **أعد تشغيل** عملية `:3001` — وإلا Prisma 7 قد يُبلغ أن الجدول/العمود غير موجود.
- **BOQ rates (2026-06-29):** migration `20260628120000_boq_item_rate_breakdown` — بعد `migrate deploy` على بيئة فيها بنود بدون تفاصيل rates: `npm run local:backfill-boq-rates -- path/to/backup.json` أو `npm run local:backfill-boq-rates -- --live` (يتطلب `FIREBASE_SERVICE_ACCOUNT_*` للوضع المباشر).

### مزامنة Firestore ↔ SQLite/Postgres (الوضع المحلي)

بيانات رئيسية (مشاريع، عقود، بنود BOQ) قد توجد في Firestore قبل قاعدة البيانات المحلية. قبل أي كتابة تعتمد على FK:

- استخدم **`ensureLocalProjectExists`** / **`ensureLocalContractExists`** **قبل** `purchaseTransactionsApi.create` (لا فقط قبل الفاتورة الموزّعة).
- مرّر `contractId: null` (وليس `''`) عند عدم وجود عقد — السلسلة الفارغة تكسر الـ FK.
- عامِل `UNIQUE constraint failed` على الإنشاء كأنه «موجود بالفعل» (سباق React Strict Mode).

> رسالة الخطأ «المشروع أو الصنف غير مسجّل في قاعدة البيانات المحلية» = FK محلي، **ليست** قاعدة Firestore. الحل: شغّل الـ API، وزامِن المشروع/العقد قبل الكتابة.

---

## 6. القواعد الذهبية — لا تكسرها

هذه قواعد مستخلصة من مراجعات سابقة وأعطال إنتاج. كسرها = bug صامت في المحاسبة أو الصلاحيات.

### 6.1 المحاسبة والمال

- **قائمة الدخل (تقارير):** هيكل يعكس قيد الإقفال — إيرادات `4` − تكاليف عقود `51` = مجمل ربح − عمومية/إدارية `52` (− تمويلية `53`) = ربح قبل الضريبة. استبعاد `fiscal_pl_close` / `YE-PL-*` من التجميع فقط (تبقى في الميزانية/ميزان المراجعة). وضع تحليلي عبر `showAnalytical`. أرصدة الأوراق عبر **`buildIncomeStatementTotals`** / **`buildIncomeStatementLeafBalances`** — كل أسطر القيد لنفس الكود. لا تستخدم `.find()` على `entries`.
- **ميزانية مقابل فعلي (local):** الفعلي (مشروع/عقد/بند) من **`GET /api/reports/boq-cost-breakdown`** فقط — لا تخلط مع `projectStats.costs` (GL) لأن إقفال الدخل وOHA يفسدان المقارنة.
- **لوحة التحكم «غير موزّع»:** مصروف بلا مركز عقد − ائتمان OHA داخل فلتر التاريخ. إقفال الدخل/قفل الفترة لا يصفّر الصف. تاريخ قيد OHA = يوم الإغلاق داخل الربع (`resolveOverheadCloseJournalDate`) — إن أُغلق ربع مبكراً سابقاً بتاريخ `periodEnd` المستقبلي: `npm run local:fix-oha-dates`.
- **تاريخ إثبات القيد اليدوي:** `stampBusinessToday` → تقويم الأعمال `Africa/Cairo` من الخادم (`GET /api/gl/business-today` / `BUSINESS_TIMEZONE`) — لا تاريخ الجهاز. ترتيب دفتر اليومية حسب **`createdAt`**.
- **تحليل التدفق النقدي (لوحة التحكم):** `buildCashFlowSeries` بتحبيب **شهري** — نقطة **`__start__`** عند الصفر ثم **إجمالي كل شهر** (ليس مجموعاً جارياً يزداد دائماً؛ شهر 150k ثم 100k ⇒ المنحنى يهبط). الأشهر بلا حركة = **`null`** + **`connectNulls`**. الرسم: **AreaChart** خطي (`includeOrigin: true`). لا تستخدم `cumulative*` في هذا الرسم.
- **OHA إعادة فتح:** `reopenOverheadPeriod` يعمل soft-delete لقيود `OHA-*` ويحوّل سطور التوزيع المرحّلة إلى **proposed drafts** (`snapshotClosedLinesAsProposed`) — لا يحذف التوزيع. الاعتماد التالي بدون تعديل يعيد نفس المبالغ إن بقيت البركة متطابقة؛ لمسح التوزيع وإعادة الحساب استخدم «إعادة للافتراضي» / clear proposed.
- **قفل الفترة المحاسبية (2026-07-26):** جدول `accounting_period_locks` · فرض في `journal.ts` (`assertPeriodUnlocked`) على إنشاء/تعديل/حذف ناعم للقيود · مستثنون عبر `allowedUserIds` · إدارة من موديول الفترات → تبويب قفل · API `/api/accounting-periods` (admin للقفل/الفتح/المستثنين) · خطأ **423**. لا تخلط مع حالة OHA `closed`. اختبار: `npm run test -- server/src/accounting/periodLock.test.ts`.
- **إقفال قائمة الدخل + افتتاحي (2026-07-27):** `fiscal_period_closings` · إقفال `4/5 → 31301001` · اعتماد ميزانية إن `|gap| ≤ 1` جنيه (`BS_BALANCE_TOLERANCE`؛ فارق التقريب يُمتص في `313…` عند الافتتاحي) · قيد `OPEN-…` (`journal_kind=fiscal_opening` مستبعد من تقارير الرصيد المستمر) · **بدون WIP**. واجهة: إعداد قائمة الدخل. API `/api/fiscal-closings`. اختبار: `npm run test -- server/src/accounting/fiscalPeriodClosing.test.ts`. لا تُعد معالجة أعمال تحت التنفيذ على `126…`.
- **كشف الحساب (GL + بنكي):** صفوف الكشف = **حركة الحساب المختار فقط** (سطر لكل سطر قيد مطابق) وليس القيد كاملاً. عمود **الحساب المقابل** يعرض **الطرف المعاكس فقط** — مرّر `resolveEntrySide(entry)` إلى `resolveCounterpartEntries` في `src/lib/glBilingual.ts`. بدون هذا الوسيط تظهر حسابات نفس الطرف (مصروفات أخرى في قيد الرواتب أو `YE-PL-*`) كأنها حسابات مقابلة. الأعمدة: التاريخ · رقم القيد · البيان · الحساب المقابل · مركز التكلفة · مدين/دائن · الرصيد الجاري. اختبار: `npm run test -- src/lib/glBilingual.test.ts`.
- **استخدم ثوابت `AccountCodes`** من `src/services/accountingService.ts` — لا تكتب أكواد حسابات نصية يدويًا.
- **التقريب:** `roundMoney()` → **منزلتان عشريتان** (`Math.round(n×100)/100`) عند الحفظ/الترحيل؛ **`formatMoney`** للعرض بصيغة `0.00`. تحمّل التوازن **`MONEY_TOLERANCE = 0.005`**.
- **فواتير مشتريات / أصل ثابت / مخزون:** `buildPurchaseWithholdingJournalLines()` — Dr (base+VAT) · Cr WHT · Cr supplier حيث **supplier = round(base+VAT) − round(WHT)**.
- **Password / Railway:** `assertJournalWriteAuth()` — في `isLocalBackend` لا تتطلب Firebase `auth.currentUser` لـ `createTransaction` (جلسة Express كافية).
- **`createTransaction`** يسقط أسطر القيد ذات المدين والدائن ≤ 0 — لا ترحّل أسطرًا صفرية.
- **`projectId` مقابل `costCenterId`**: على `transactions`، `costCenterId` = معرّف العقد، و`projectId` = المشروع الفعلي. لا تضع معرّف عقد في `projectId` أبدًا.
- **توليد أكواد الموردين**: 8 أرقام تسلسلية تحت `21101` (موردون) أو `21102` (باطن) — **ممنوع `Math.random()`**. كل حساب مورّد يحمل `supplierId`.
- شغّل اختبارات المال/السيولة عند المساس بها (انظر القسم 7).

### 6.2 الحذف والكتابة الذرّية

- **الحذف دائمًا soft delete** (`isDeleted: true`) — لا `deleteDoc` مباشر على بيانات المستخدم.
- أي عملية تكتب لأكثر من collection يجب أن تستخدم **`writeBatch`** (ذرية)، مقسّمة 500 عملية كحد.

### 6.3 Firestore Listeners (أمان الوضع المحلي)

- **ممنوع استيراد `onSnapshot` مباشرة في المكوّنات** — استخدم `listenQuery` / `listenDoc` من `src/lib/firestoreListen.ts` (تتحوّل لـ `getDocs` لمرة واحدة في الوضع المحلي وتمنع أعطال WebSocket).
- فضّل `useFirestoreQuery` (`mode: 'snapshot'` أو `'once'`) على `useEffect + getDocs` اليدوي.
- كل `onSnapshot` خام يجب أن يحمل **error callback** ثالثًا.
- عند تعيين معرّف المستند استخدم **`{ ...d.data(), id: d.id }`** (المعرّف أخيرًا) لتجنّب الكتابة فوقه بـ `id: ''`.

### 6.3.1 مفاتيح React في القوائم (`.map`)

- **ممنوع** `key={row.id}` أو `key={a.id || a.accountCode}` عندما قد تكون القيمة **`""`** — ينتج `Encountered two children with the same key, ''`.
- استخدم **`listKey(id, index, prefix)`** أو **`compositeListKey(primary, secondary, index, prefix)`** من `src/lib/utils.ts`.
- **`useFirestoreQuery`** يطبّق `{ ...d.data(), id: d.id }` تلقائيًا. **`BOQ.tsx`**: `normalizeBoqItem()` + `listKey` على صفوف الجدول · العرض عبر **`BoqItemRow`** + **`buildBoqRowViewModel`** (state الكتابة في `BOQItemFormModal`/`ContractFormModal` فقط).
- **`Projects.tsx` (2026-08-09):** بطاقات القائمة لا تحمّل كل `boq_items`؛ ميزانية من حقول المشروع؛ `PROJECT_CARDS_GL_TX_CAP=2000`؛ `ProjectCard`/`ProjectFormModal`.
- بعد تغييرات على مفاتيح القوائم: تأكد أن **`npm run dev:local`** يستمع على **:3000 و :3001** (لا `EADDRINUSE`) ثم **hard refresh**.

### 6.4 الصلاحيات (ثلاثة مفاهيم منفصلة)

| المفهوم | المعنى |
|---------|--------|
| **Module access** | يفتح الموديول (`canOpenShellModule` / `openWindow` / API) |
| **UI visibility** | قائمة `visibleShellModules` (مدير فقط) — إخفاء من الشريط دون إلغاء الصلاحية |
| **Reference read** | يقرأ collection موديول آخر كـ lookup (مثل `costs.create` يسمح بقراءة `chart_of_accounts` للفواتير دون `ledger.view`) |

- **لا تخلط** `visibleShellModules` مع `User.permissions` — الفلتر في Sidebar/TopNav فقط عبر `isShellModuleNavVisible`.

- قواعد Firestore **لا تستطيع** تقييم `permissions[variableKey]` — استخدم مسارات **حرفية** (`crudPermView('costs')`). لا ترجع لفهرسة المفاتيح الديناميكية.
- **مزامنة الأدوار المزدوجة**: دور Postgres مستقل عن Firestore — تعيين admin في Firestore لا يحدّث Railway تلقائيًا. الأعراض: 403 على APIs + توست «فشل تحميل…». الحل: `promoteGoogleAdminPg.ts` أو Settings re-save + logout/login. **UI role** في password mode يأتي من Postgres session (`PermissionsContext`) — لا من Firestore listener.

### 6.5 التكاليف الفعلية — سير العمل (2026-06-27 · محدّث 2026-07-27)

| التبويب | الحالة | GL |
|---------|--------|-----|
| **فاتورة مشتريات** | حفظ → ترحيل فوري (أو read-only إن `transactionId`) · **آجلة/نقدية** (`paymentType`) | `recordPurchaseToProjectInventory` / `recordFixedAssetPurchase` — Cr مورد **21101…** أو عهدة **12102…** |
| **مستخلص مقاول** | `draft` → `submitted` → `approved` | **`POST /api/purchase-transactions/:id/approve`** فقط (`costs_ipc.edit`) · رقم لكل مقاول/سنة · طباعة: رقم+حالة + شعار الشركة + ملخص أسفل البنود (محتجزات على الإجمالي؛ القيد = زيادة الفترة) |
| **مستخلص خدمة** | نفس الدورة · `type=service_ipc` | رقم لكل مورد/سنة `مستخلص الاسم-001-2026`؛ عنوان الطباعة = الرقم + الحالة؛ شعار + اسم الشركة معاً؛ ملخص أسفل البنود (سابق/حالي/إجمالي + محتجزات على الإجمالي − مقدمة − مسدد من GL نقدي/شيك)؛ اعتماد يرحّل مدين حسب `serviceKind` مع `costCenterId` لكل عقد؛ **لا** توزيع على بنود BOQ. **لا** تستورد `costCenterAttribution` من `serviceContractor.ts` (دورة أجزاء Vite تُسقط الإقلاع) |
| **تسوية عهدة** | `draft` → `submitted` → `approved` | **`POST /api/custody-settlements/:id/approve`** فقط (`ledger.create` أو `ledger.edit`) — زر الاعتماد في **تفاصيل** التسوية وليس النموذج فقط |

- **معاينة:** النقر على صف فاتورة/IPC في الجدول يفتح النافذة — المرحّلة = للقراءة فقط.
- **فاتورة local:** احفظ **`invoiceLines`** مع الـ header في `purchaseTransactionsApi` — البنود في `purchase_transaction_items`. حقل **`paymentType`**: `credit` | `cash` (null = آجلة للتوافق).
- **فاتورة — بنود BOQ (2026-07-24):** كل سطر صنف يمكن ربطه بعدة بنود (`boqItemIds[]` + `boqItemId` للتوافق). فلتر القائمة: مركز تكلفة محدد → بنود ذلك العقد؛ وإلا مشروع المخزن المختار. **لا** تنسخ وصف/وحدة/سعر BOQ إلى حقول الصنف.
- **فاتورة — آجلة/نقدية (2026-07-27):** مبدّل في النموذج؛ زر «فاتورة جديدة» أعلى الشريط الجانبي؛ نقدية → `supplierId: null` + دائن COA `12102…`.
- **تسوية عهدة:** ترقيم `SET-{كود-المشروع}-0001`؛ لا `createTransaction` مباشرة عند الحفظ.

**الملفات:** `ActualCosts.tsx` (parent — حفظ/اعتماد/GL) · `actualCosts/*` (قائمة · بنود فاتورة · شبكة IPC · مودالات) · `GLCustodySettlement.tsx` · `server/src/modules/purchaseTransactions.ts` · `server/src/modules/custodySettlements.ts`.

### 6.5.0 ربط BOQ ↔ أصناف المخزون (2026-07-24)

| ميزة | أين | API / ملاحظة |
|------|-----|--------------|
| شارات عدد الروابط | `BOQ.tsx` (أيقونة Package، `bg-blue-600`) | `GET /boq-materials/contract/:id/link-counts` |
| منع حذف بند | `DeleteBlockedModal` | `GET /boq-materials/:id/can-delete` |
| ربط فوري من الصرف | `QuickLinkMaterialModal` | `boqApi.list(?projectId=)` ثم `setMaterials` — **لا** `list(contractId)` بلا `?` |
| تحذير كمية منصرفة | `BoqMaterialsModal` | `GET …/consumed-quantity` |
| تقرير غير المربوط | `UnlinkedMaterialsReport` من رصيد المخزون | `GET …/unlinked-report` |
| وراثة روابط | بند جديد / VO جديد | `POST …/inherit` · VO يرجع `newBoqItemIds` |

**صلاحية الربط الفوري:** `admin` | `projects_manager` | `project_accountant`. لا تعرض تكاليف أو أسعار بيع في نافذة الربط الفوري.

### 6.4.1 نسخة احتياطية Postgres كاملة (2026-08-13)

قبل رفع بيانات شركة فعلية: صدّر لقطة كاملة (كل الموديولات + المستخدمون + الصلاحيات + **`passwordHash` bcrypt** — ليست كلمة السر نصاً). تفضيلات العرض في `settings` كمفاتيح `user_prefs:*`.

```powershell
npm run prod:export-backup   # Railway
npm run local:export-backup  # Postgres المحلي
```

الملفات تحت `D:\cost web app\backups\<stamp>-production\` (أو `-local`). الاسترجاع من **الإعدادات → قاعدة البيانات → استيراد** — وضع **استبدال** يعيد كلمات الدخول؛ **دمج** يُبقي الهاش الحالي للمستخدم الموجود. لا تُصدَّر `sessions` ولا `idempotency_keys` (جلسات/إعادة محاولة فقط).

### 6.5.0a شجرة الأصناف — Excel مطابق ملف المخزن v2 (2026-08-13)

القالب والتصدير/الاستيراد يطابقان «شجرة أصناف مخزن مقاولات v2»:

| عمود | قاعدة البيانات |
|------|----------------|
| كود المجموعة | `material_groups.code` |
| **Code** | `material_groups.name_en` — اسم إنجليزي؛ **لا** تقرأه ككود |
| اسم المجموعة | `material_groups.name` |
| كود الصنف / اسم الصنف / الوحدة | `material_categories` |
| الرصيد | يُتجاهل هنا — استخدم استيراد الأرصدة الافتتاحية |

`POST /api/materials/import` يحدّث الصف الموجود حسب الكود (لا يتخطّاه). القالب ذو 5 أعمدة ما زال يُقرأ. بعد السحب: `npx prisma migrate deploy` (`name_en`).

### 6.5.0b أرصدة مخزون افتتاحية (2026-08-05)

| بند | تفصيل |
|-----|--------|
| UI | مخزون → رصيد → **`OpeningInventoryImportPanel`** (يعزل تاريخ الاستيراد عن جدول الرصيد) · قالب / استيراد (يتطلب مخزن 127 مربوط) |
| Excel | كود الصنف · الكمية · متوسط التكلفة — `inventoryOpeningExcel.ts` (**ليس** عمود `الرصيد` في شجرة الأصناف) |
| UI فارغ | `ProjectWarehouseLinkCard` يظهر لربط 127… قبل الاستيراد |
| ملف خاطئ | ملف شجرة الأصناف يُرفض برسالة واضحة |
| API | `POST /api/inventory/project/:projectId/opening-import` |
| GL | قيد واحد `INV-OPEN-…` — Dr 127… / Cr جاري الشركاء `31401001` |
| تكرار | يتخطّى الأصناف التي لها صف `project_inventory` مسبقاً |

### 6.5.0c أوامر متعددة الأصناف — صرف / مرتجع / تحويل (2026-08-05)

| مستند | حالة |
|-------|------|
| **صرف** | سلة أصناف في `ConsumptionOrderModal` + توزيع BOQ لكل صنف؛ مصروف رأس واحد؛ API `lines[]` كما هو |
| **مرتجع** | اختيار عدة بنود صرف قابلة للإرجاع؛ قيد GL على الخادم `returnInventoryJournal` (مجموعات مصروف) |
| **تحويل** | متعدد الأصناف مسبقاً — تلميح UI فقط |

### 6.5.0e استلام معلّق + صرف معلّق السعر (2026-08-05)

| بند | تفصيل |
|-----|--------|
| DB | `quantity_unpriced` · `warehouse_receipts` / lines · `consumption_orders.requires_cost_approval` + status `pending_cost` |
| استلام | أمين المخزن يرسل → كمية فورية بلا GL؛ الاعتماد عبر **فاتورة مشتريات** (VAT/WHT) → `priceUnpriced` (لا قيد `WR-…` جديد؛ `/approve` = 410) |
| UI | مخزون → تبويب **استلام مخزني** (إنشاء/رفض) · تكاليف فعلية → فاتورة ← اختيار استلام معلّق · سجل الحركات شارة/زر اعتماد تكلفة للصرف |
| صرف | يمس كمية غير مسعّرة → حجز `pending_cost`؛ بعد التسعير `POST …/approve-cost` |
| إشعارات | `warehouse_receipt_pending` → تكاليف/فاتورة · `consumption_pending_cost` |

### 6.5.0d صورة Railway أخف (2026-08-05)

| بند | تفصيل |
|-----|--------|
| deps | حزم الواجهة/البناء (`react` · `vite` · `xlsx` · …) في `devDependencies` — تُبنى في المرحلة الأولى ثم `npm prune` |
| Docker | `deploy/railway-api.Dockerfile` يحتفظ بـ Prisma CLI للـ migrate؛ يحذف Electron/UI من الصورة النهائية |
| .dockerignore | يستبعد `release` · `release-build` · `electron` · `public/imports` من سياق البناء |
| أداء | لا تغيير على runtime — الـ SPA من `dist/` والـ API كما هو |

### 6.5.1 البنوك — رصيد GL في النماذج (2026-06-28)

عند إنشاء **شيك** أو **حركة بنكية** (تحويل / إيداع / سحب)، يظهر تحت اختيار الحساب تلميح **read-only** للرصيد من الأستاذ:

| الاختيار | ما يُعرض |
|----------|----------|
| حساب بنكي (`bankAccountId` أو `toBankAccountId` في التحويل الداخلي) | **الرصيد المتاح** — صافي GL على كود الحساب المرتبط (`coaAccountId` أو `bank.code`) |
| طرف مقابل من الدليل (مورد `211…`، عهدة `12102…`، جاري شريك `314…`، بنك آخر `121…`، …) | **رصيد الحساب** + (مدين/دائن) |

**البنية:**

- `src/lib/glAccountBalance.ts` — `buildGlAccountBalanceMap()` (Σ debit−credit)
- `src/hooks/useGlAccountBalances.ts` — تحميل GL مرة في `Banks.tsx` (حد **`LISTENER_GL_TX_SCREEN_CAP`** = 4500 قيد)
- `GlAccountBalanceHint.tsx` — العرض في `BankChequesTab` / `BankMovementsTab`

**لا تراجع:** التلميح لا يستبدل كشف الحساب الكامل ولا يتحقق من كفاية الرصيد قبل الحفظ — للمساعدة فقط. بعد ترحيل حركة/شيك، `onBankDataMutated` يحدّث الخريطة.

---

### 6.6 React Hooks

- كل `useState/useRef/useMemo/useCallback` في **أعلى** المكوّن، قبل أي تعريف دالة.
- القيم المشتقّة الثقيلة (charts, maps, totals) في `useMemo`. callbacks الـ snapshot تستدعي `setState` فقط — لا حسابات بداخلها.
- **لا تستدعِ `handleEntryChange` مرتين** من نفس `onChange` — React يدمج التحديثين من نفس الإغلاق القديم ويفوز الثاني. عالِج التأثيرات الجانبية داخل `handleEntryChange` نفسها.
- في `onAuthStateChanged` بـ `App.tsx` **لا تضع `language` في مصفوفة الاعتماديات** — استخدم `languageRef`.

### 6.7 حمولات Firestore — بلا `undefined`

Firestore يرفض `undefined` على أي حقل. استخدم `sanitizeTransactionFirestoreData()` للمعاملات و`mapInvoiceLineForPersistence()` لأسطر الفواتير — احذف المفتاح أو استخدم spread شرطيًا بدل `field: x || undefined`.

---

## 7. الاختبار وسير العمل

سير العمل: **`feature branch → PR → /review → merge to main`**.

قبل أي PR:

```bash
npm run lint                 # فحص أنواع الواجهة
npx tsc -p server/tsconfig.build.json --noEmit   # فحص أنواع الخادم
npm run test                 # كل الاختبارات
```

اختبارات موجّهة حسب ما لمسته:

| لمست… | شغّل |
|-------|------|
| السيولة / KPIs / Dashboard | `npm run test -- src/lib/liquidityMetrics.test.ts src/lib/dashboardMetrics.test.ts` |
| تقريب المال / OHA | `npm run test -- server/src/lib/money.test.ts server/src/accounting/overheadAllocation.test.ts` |
| قفل الفترة المحاسبية | `npm run test -- server/src/accounting/periodLock.test.ts` |
| إقفال قائمة الدخل / افتتاحي | `npm run test -- server/src/accounting/fiscalPeriodClosing.test.ts` |
| الصرف متعدد BOQ | `npm run test:consumption` ثم `npm run local:verify-postgres` |
| دليل الاستخدام / مفاتيح `manual_*` | `npm run test -- src/lib/operationsManual.test.ts` |
| فلاتر GL | `npm run test -- src/lib/journalFilters.test.ts src/lib/chartOfAccountsPicker.test.ts` |
| أرصدة GL في البنوك | `npm run test -- src/lib/glAccountBalance.test.ts` |
| تكلفة BOQ تقديرية / rates | `npm run test -- src/lib/boqPricing.test.ts` |

**المسارات الذهبية (golden paths)** بعد أي تغيير واسع: إنشاء مستخلص (IPC)، **فاتورة مشتريات + معاينة من الجدول + ربط صنف بعدة بنود BOQ**، **مستخلص مقاول (تقديم → اعتماد PM)**، **تسوية عهدة (تقديم → اعتماد مدير حسابات)**، أمر صرف (**ربط فوري** إن لزم)، إرجاع، قيد GL، شيك وارد (ISS+CLR)، إجماليات Dashboard + السيولة، إغلاق OHA.

تغييرات فهارس Firestore تتطلب: `npx firebase-tools deploy --only firestore:indexes --project gen-lang-client-0599011721`.

---

## 8. النشر (مرجع سريع)

| الاتجاه | الطريقة |
|---------|---------|
| محلي → Railway (بيانات) | الإعدادات → **Push to production** (admin، API محلي) |
| كود/UI → كل العملاء | `git push` → إعادة نشر Railway تلقائية — Electron يعيد تحميل الـ SPA المستضاف (بلا Setup جديد) |
| Railway → محلي | استيراد JSON يدوي (لا سحب تلقائي بعد) |
| تحديث قشرة Electron (OAuth / نوافذ متعددة / cache) | `npm run electron:publish` (منفصل عن المحتوى) |

تفاصيل كاملة في **`docs/RAILWAY_DEPLOY.md`** و**`DEPLOYMENT_PLAN.md`**.

---

## 9. قوالب كود جاهزة للنسخ

قوالب متوافقة مع أنماط المشروع الفعلية — انسخها كنقطة بداية. **استبدل مفاتيح `t('…')` بمفاتيح حقيقية مضافة في `LanguageContext.tsx`.**

### 9.1 مكوّن نموذجي — theme-aware + i18n + قراءة API

مكوّن نافذة كامل: يستخدم الثيم من `shellTheme`, الترجمة من `useLanguage`, ويقرأ بيانات Postgres عبر `useApiQuery` في الوضع المحلي.

```tsx
import { useMemo } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useApiQuery } from '../hooks/useApiQuery';
import { isSoftLikeTheme } from '../lib/shellTheme';
import { isLocalBackend } from '../lib/dataBackend';
import { someApi } from '../services/local/modulesApi';

interface MyRow {
  id: string;
  name: string;
  amount: number;
}

export function MyFeature() {
  const { t, theme, formatMoney, dir } = useLanguage();
  const softLike = isSoftLikeTheme(theme); // erp + soft يتصرفان مثل light

  // قراءة من Postgres عبر API (الوضع المحلي فقط)
  const { data: rows, loading, error, refresh } = useApiQuery<MyRow>(
    () => someApi.list(),
    [],
    { enabled: isLocalBackend },
  );

  // القيم المشتقّة الثقيلة دائمًا في useMemo
  const total = useMemo(
    () => rows.reduce((sum, r) => sum + r.amount, 0),
    [rows],
  );

  const surface = softLike
    ? 'bg-white text-gray-800'
    : 'bg-[#0d0e11] text-gray-200';

  if (loading) return <div className="p-4">{t('loading')}</div>;
  if (error) return <div className="p-4 text-red-500">{t('load_failed')}</div>;

  return (
    <div className={`p-4 ${surface}`} dir={dir}>
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{t('myfeature_title')}</h2>
        <button
          onClick={refresh}
          className="text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white"
        >
          {t('refresh')}
        </button>
      </header>

      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-start">{t('name')}</th>
            <th className="text-end">{t('amount')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              {/* المال دائمًا عبر formatMoney */}
              <td className="text-end">{formatMoney(row.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold border-t">
            <td>{t('total')}</td>
            {/* اجمع الأرقام أولًا ثم نسّق — لا formatMoney(0) كقيمة ابتدائية */}
            <td className="text-end">{formatMoney(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
```

نقاط أساسية في القالب:
- `text-start` / `text-end` (وليس `text-left`/`text-right`) لاحترام RTL تلقائيًا.
- `dir={dir}` من الـ context — لا تكتب `dir="rtl"` يدويًا.
- `{ enabled: isLocalBackend }` يمنع نداء الـ API في الوضع السحابي.
- المال عبر `formatMoney`، والمجموع مُجمَّع أولًا في `useMemo`.

### 9.2 قالب shell-aware (يستخدم خرائط الثيم المركزية)

عندما يكون المكوّن جزءًا من قشرة التطبيق (sidebar/window chrome)، استخدم `ShellThemePalette` بدل ألوان يدوية:

```tsx
import { useLanguage } from '../context/LanguageContext';
import { shellTheme, shellNavActive } from '../lib/shellTheme';
import type { AppTheme } from '../lib/shellTheme';

export function MyNavItem({ active }: { active: boolean }) {
  const { theme, t } = useLanguage();
  const shell = shellTheme(theme as AppTheme);

  return (
    <button
      className={`w-full text-start px-3 py-1.5 rounded-md text-sm transition-colors ${
        active ? shellNavActive(theme as AppTheme) : shell.navMuted
      }`}
    >
      {t('myfeature_title')}
    </button>
  );
}
```

### 9.3 قالب راوتر خادم + غلاف عميل

**الخادم** — `server/src/modules/myfeature.ts`:

```ts
import { Router } from 'express';
import { getDb } from '../sqlite/appDb.js'; // أو Prisma client حسب الموديول
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { rowToObj } from '../lib/rowToObj.js';

const router = Router();

router.get('/', requireAuth, requirePermission('myfeature'), (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM my_table WHERE is_deleted = 0').all();
  res.json(rows.map(rowToObj)); // snake_case → camelCase دائمًا
});

export default router;
```

ثم سجّله في `server/src/app.ts`:

```ts
import myFeatureRouter from './modules/myfeature.js';
app.use('/api/myfeature', myFeatureRouter);
```

**العميل** — أضِف الغلاف في `src/services/local/modulesApi.ts`:

```ts
export const someApi = {
  list: () => apiGet<MyRow[]>('/myfeature'),
  create: (body: Partial<MyRow>) => apiPost<MyRow>('/myfeature', body),
};
```

### 9.4 قالب قيد محاسبي (GL) — آمن

عند ترحيل أي قيد، استخدم ثوابت `AccountCodes` ولا ترحّل أسطرًا صفرية:

```ts
import { AccountCodes, createTransaction } from '../services/accountingService';
import { roundMoney } from '../lib/money';

async function postMyJournal(amount: number, contractId: string, projectId: string) {
  // Cloud legacy فقط: Firebase user. Local/Railway: assertJournalWriteAuth داخل createTransaction.
  const value = roundMoney(amount); // EGP — 2 decimal places

  await createTransaction({
    date: new Date().toISOString().split('T')[0],
    description: 'وصف القيد',
    costCenterId: contractId, // معرّف العقد — ليس المشروع
    projectId,                // المشروع الفعلي
    entries: [
      { accountCode: AccountCodes.EXPENSE_MATERIALS, debit: value, credit: 0 },
      { accountCode: AccountCodes.SUPPLIERS,         debit: 0,     credit: value },
      // الأسطر ذات debit و credit ≤ 0 تُسقط تلقائيًا
    ],
  });
}
```

### 9.5 جلسة النشاط + الخمول (بدون إشعار موقع)

`useActivitySession` يسجّل بداية الجلسة وheartbeat والأخطاء العامة فقط — **لا** يعرض toast للموقع الجغرافي و**لا** يستدعي `requestApproxGeolocation` عند الدخول (2026-08-07).

| السلوك | الملف | القيمة |
|--------|-------|--------|
| **قفل الخمول (خصوصية)** | `IDLE_LOGOUT_MS` + `powerMonitor` | **3 دقائق** بدون نشاط على **الجهاز** (Electron) → شاشة دخول + اسم المستخدم + **كلمة المرور**؛ لا `quit` |
| **رسالة الخمول** | `session_idle_lock_subtitle` | Overlay على الجلسة الحية؛ الفتح عبر `POST /auth/login` |
| **مفاتيح i18n قديمة** | `activity_geo_notice` · `session_idle_logout` | `session_idle_logout` لم يعد يُعرض عند القفل |

```bash
npm run electron:dev   # بعد electron:build:shell
# سجّل الدخول → اعمل في إكسل/متصفح 3 دقائق → التطبيق يبقى → اترك الجهاز 3 دقائق → شاشة دخول + كلمة المرور
```

---

## مراجع أساسية

| الملف | الغرض |
|-------|-------|
| `CLAUDE.md` (الجذر) | المرجع المعماري الكامل + سجلّ القرارات (handoffs) |
| `CONTEXT.md` (الجذر) | نظرة عامة عربية + shell + إعدادات admin + تفضيلات المستخدم |
| `DEPLOYMENT_PLAN.md` (الجذر) | نشر Railway · حالة التقدّم |
| `src/lib/shellWindowPolicy.ts` | **Shell single-module policy** (all themes) |
| `src/lib/shellNavigation.ts` | **Startup module** + **`none`** (empty desktop) |
| `src/lib/userPreferences.ts` | **Persist theme/language/defaultModule** (local session + cloud) |
| `src/lib/moduleViewPermissions.ts` | **Settings ERP sub-views** + `SETTINGS_ADMIN_VIEW_IDS` |
| `src/components/WindowManager.tsx` | تحميل النوافذ بالكسل + الربط |
| `src/constants/modules.ts` | تعريف الموديولات وترتيبها |
| `src/lib/permissions.ts` · `src/types.ts` | الصلاحيات والأدوار |
| `src/lib/money.ts` · `src/lib/formatQuantity.ts` | عرض المال والكميات |
| `src/services/accountingService.ts` | قيود GL + `AccountCodes` |
| `src/lib/offline/` | مسودات محلية + طابور مزامنة (انظر §6.6) |
| `server/src/app.ts` | تسجيل كل الراوترات + CORS |
| `prisma/schema.prisma` | مخطط قاعدة البيانات |

---

## 6.6 Offline Sync (مسودات + طابور مزامنة) — 2026-08-08

**النطاق:** `isLocalBackend` فقط (محلي / Railway / Electron).

| طبقة | مسار |
|------|------|
| مسودات النماذج | `src/lib/offline/formDraftStore.ts` + `useFormDraftAutosave` |
| طابور | `syncOutbox.ts` · `enqueueOrExecute` · `offlineWrite.ts` |
| واجهة | `OfflineStatusBar` · `PendingSyncPanel` · `FormDraftRestoreBanner` |
| منع التكرار | ترويسة `Idempotency-Key` + جدول `idempotency_keys` + `withIdempotency()` |
| مفاتيح المسودات | `FORM_DRAFT_KEYS` في `formDraftKeys.ts` |

**تصنيف العمليات:**
- `safe_save` — مسودات (أوامر شراء، مستخلصات، بنوك…) تُفرَّغ تلقائياً عند `online`
- `confirm_required` — ترحيل/اعتماد/صرف/إرجاع — تظهر في لوحة التأكيد فقط

**قاعدة الذرّية (لا تراجع):** أي عملية تغيّر GL + سجلاً تشغيلياً يجب أن تكون **طلب HTTP واحد** (`confirm_required`)، وليس `glApi.createTransaction` ثم `update`/`create` منفصلين.

| العملية | المسار الصحيح |
|---------|----------------|
| فاتورة مشتريات | `POST /purchase-transactions/post-invoice` |
| حركة بنكية / شيك ISS·CLR | `POST /bank-movements/:id/post` · `/bank-cheques/:id/issue|clear|…` |
| صرف / إرجاع | `createAndConfirm` (`autoConfirm: true` على create) |
| اعتماد IPC / عهدة / تحويل مخزن | مسار اعتماد الخادم (قيد + حالة داخل `$transaction`) |
| اعتماد استلام مخزني | عبر `post-invoice` + `warehouseReceiptId` (ليس `/warehouse-receipts/:id/approve`) |
| تحويل بين مشاريع | `approve-projects` فقط — **لا** `recordProjectWarehouseTransfer` من الواجهة |

**رواتب + أصول ثابتة:** `safe_save` للموظف/كشف المسودة/الأصل؛ `confirm_required` لاستحقاق الراتب والسداد وإعادة الفتح وترحيل الإهلاك. مسودات: `payroll_employee:new` · `fixed_asset:new`.

**BOQ + أوامر التغيير:** `safe_save` لإنشاء/تعديل/حذف بند BOQ وإنشاء VO وتقديمه ورفضه وحذفه؛ `confirm_required` لاعتماد VO (يطبّق بنود الكميات). مسودات: `boq_item:{contractId}:new` · `vo:{contractId}:new`. استيراد Excel لـ BOQ يتطلب اتصالاً (لا يُقسَّم إلى طابور صف-بصف).

إصلاح صفوف يتيمة (فاتورة): `npx tsx server/src/scripts/linkOrphanPurchaseInvoiceJournals.ts` ثم `--live`.

**خمول الجلسة:** Electron يستخدم خمول **نظام التشغيل** (`powerMonitor`) حتى يبقى التطبيق مفتوحاً أثناء العمل في برامج أخرى. بعد 3 دقائق بلا نشاط على الجهاز: شاشة دخول + البريد + **كلمة المرور** (لا `quit`). المتصفح/قشرة قديمة: نشاط النافذة + throttle ثانية لـ `mousemove`/`scroll`/`wheel`. يُوقف القفل أثناء الانقطاع أو مسودة/طابور (`idleGate.ts`).

**اختبارات:** `npm run test -- src/lib/offline/offline.test.ts`

**لا تراجع:** لا ترحيل GL صامت من الطابور؛ لا تفصل قيد فاتورة/بنك عن صفها التشغيلي؛ اربط النماذج الجديدة عبر `useFormDraftAutosave` + `offlinePost`/`offlineWrite` حسب التصنيف.
