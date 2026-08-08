# نشر Web Cost App على Railway (واجهة + API + Postgres)

نشر **كامل** على خدمة Railway واحدة:
- **`/`** — واجهة React (Vite)
- **`/api/*`** — Express + PostgreSQL
- **Firebase Auth** — تسجيل الدخول فقط

---

## 1) إنشاء المشروع

1. [Railway Dashboard](https://railway.app/dashboard) → **New Project** → **Deploy from GitHub**
2. اختر مستودع `web-cost-app`
3. Railway يقرأ `railway.toml` ويبني `deploy/railway-api.Dockerfile`

## 2) PostgreSQL + ربط `DATABASE_URL` (مطلوب — بدونه يفشل النشر)

### أ) إضافة Postgres

1. في **نفس المشروع** على Railway → **+ New** → **Database** → **PostgreSQL**
2. انتظر حتى تصبح حالة Postgres **Active**

### ب) ربط `DATABASE_URL` على خدمة **web-cost-app** (ليس Postgres)

> **الخطأ `[start] FATAL: DATABASE_URL is not set` = المتغيّر غير موجود على خدمة التطبيق.**

#### الطريقة A — Reference (موصى بها)

1. افتح بطاقة **web-cost-app** في المخطط (مربع GitHub/App — **ليس** مربع Postgres)
2. **Variables** → **+ New Variable**
3. **Variable name:** `DATABASE_URL`
4. **Value:** لا تكتب يدوياً — اضغط **Reference** (أيقونة `{}` أو "Add Reference")
5. اختر خدمة Postgres (الاسم قد يكون `Postgres` أو `PostgreSQL` أو `postgres`)
6. اختر المتغيّر **`DATABASE_URL`**
7. يجب أن يظهر شيء مثل: `${{Postgres.DATABASE_URL}}` — **اسم الخدمة بين `{{` و `.` يجب أن يطابق الاسم في المخطط**
8. **Add** / **Save**
9. **Deploy** → **Redeploy** على **web-cost-app**

#### الطريقة B — لصق الرابط مباشرة (إذا Reference لا يعمل)

1. افتح خدمة **Postgres** → **Variables** (أو **Connect**)
2. انسخ قيمة **`DATABASE_URL`** كاملة (`postgresql://postgres:…@…`)
3. افتح **web-cost-app** → **Variables** → **+ New Variable**
4. Name: `DATABASE_URL` · Value: **الصق الرابط** (ليس Reference)
5. **Save** → **Redeploy** web-cost-app

#### تحقق

في **web-cost-app → Variables** يجب أن ترى سطر **`DATABASE_URL`** بقيمة (مخفية) — إن لم يظهر، لم يُحفظ.

### ج) تحقق بعد Redeploy

في **Deploy Logs** يجب أن ترى:
```text
[start] Running prisma migrate deploy…
[start] Starting API server…
API listening on http://0.0.0.0:…
```

ثم:
```powershell
curl https://YOUR-DOMAIN.up.railway.app/api/health/live
curl https://YOUR-DOMAIN.up.railway.app/api/health
```

` /api/health` يجب أن يعيد `"db": "connected"`.

### د) خطأ Prisma P1013 (رابط غير صالح)

| ❌ خطأ | ✅ صحيح |
|--------|---------|
| كتابة `${{Postgres.DATABASE_URL}}` يدوياً في الحقل | استخدم زر **Reference** في الواجهة |
| `https://…` أو `localhost` | `postgresql://postgres:…@….railway.app:5432/railway` |
| علامات اقتباس `"postgresql://…"` | الرابط فقط بدون `"` |
| JSON أو نص متعدد الأسطر | سطر واحد يبدأ بـ `postgresql://` |

**الإصلاح السريع:** احذف `DATABASE_URL` من web-cost-app → Postgres → Variables → **Copy** `DATABASE_URL` → web-cost-app → الصق **الرابط الكامل** → Redeploy.

## 3) متغيّرات البيئة (خدمة التطبيق)

### تشغيل (Runtime)

| المتغيّر | مطلوب | ملاحظة |
|----------|--------|--------|
| `NODE_ENV` | ✅ | `production` |
| `DATABASE_URL` | ✅ | **Reference** من Postgres → `DATABASE_URL` على خدمة التطبيق |
| `BOOTSTRAP_ADMIN_EMAIL` | ✅ أول نشر | بريد Google للترقية التلقائية إلى admin عند تسجيل الدخول (مثلاً `myline78@gmail.com`) |
| `SESSION_SECRET` | ✅ | سلسلة عشوائية طويلة |
| `FIREBASE_PROJECT_ID` | ⬜ | `gen-lang-client-0599011721` (أو من `config/firebase-applet.defaults.json`) |
| `CORS_ORIGIN` | ⬜ | يُشتق تلقائياً من `RAILWAY_PUBLIC_DOMAIN` إن وُجد |
| `SQLITE_CORE_ENABLED` | ⬜ | `false` (افتراضي في production) |

> Railway يضبط `PORT` و `RAILWAY_PUBLIC_DOMAIN` تلقائياً بعد **Generate Domain**.

### بناء الواجهة (Build time — مطلوبة لـ Vite)

| المتغيّر | مطلوب |
|----------|--------|
| `VITE_DATA_BACKEND` | ✅ `local` |
| `VITE_API_BASE_URL` | ✅ `/api` (نفس النطاق) |
| `VITE_FIREBASE_API_KEY` | ✅ |
| `VITE_FIREBASE_AUTH_DOMAIN` | ✅ |
| `VITE_FIREBASE_PROJECT_ID` | ✅ |
| `VITE_FIREBASE_APP_ID` | ✅ |
| `VITE_FIREBASE_STORAGE_BUCKET` | ✅ |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | ✅ |
| `VITE_FIREBASE_DATABASE_ID` | ⬜ |

انسخ القيم من Firebase Console → Project settings → Your apps → Web app، أو من `.env` المحلي.

**PowerShell — SESSION_SECRET:**

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

## 4) النشر

1. **Settings → Networking → Generate Domain** (مثلاً `web-cost-app-production.up.railway.app`)
2. انتظر اكتمال البناء (Vite + API + `prisma migrate deploy`)
3. تحقق:

```powershell
curl https://YOUR-DOMAIN.up.railway.app/api/health
```

```json
{ "ok": true, "db": "connected", "env": "production" }
```

4. افتح **`https://YOUR-DOMAIN.up.railway.app/`** في المتصفح — الواجهة كاملة.

## 5) ترحيل البيانات إلى Postgres على Railway

من جهاز التطوير (ضبط `DATABASE_URL` مؤقتاً برابط Railway Postgres):

```powershell
cd "D:\cost web app\web-cost-app"
# .env → DATABASE_URL=postgresql://...@...railway.app:5432/railway
npm run local:migrate
npm run local:backfill-gl          # قيود GL من صرف/إرجاع/مستخلصات/شيكات (Firestore فيه ~10 قيود فقط)
npm run local:verify-postgres
npm run local:promote-google-admin -- myline78@gmail.com
npm run local:set-user-role -- momamo242@gmail.com project_accountant --contracts <contractId>
```

## 6) الكوكيز والجلسات

| النشر | `SESSION_COOKIE_SAME_SITE` | `CORS_ORIGIN` |
|-------|---------------------------|---------------|
| **نفس الخدمة** (هذا الدليل) | `lax` (افتراضي) | `RAILWAY_PUBLIC_DOMAIN` تلقائياً |
| واجهة منفصلة (Vercel…) | `none` | رابط الواجهة بالضبط |

## 7) بناء محلي (تحقق قبل Push)

```powershell
npm run railway:build          # API فقط
npm run build:production       # واجهة (يقرأ .env المحلي)
npm run start:api:prod         # migrate + API (Postgres محلي)
npm run test -- src/lib/liquidityMetrics.test.ts
```

## 8) استكشاف الأخطاء

| العرض | الحل |
|-------|------|
| Build: `Missing required build variables` | أضف `VITE_FIREBASE_*` في Railway Variables |
| `SESSION_SECRET must be set` | أضف `SESSION_SECRET` |
| health `503` | تحقق من `DATABASE_URL` Reference على **web-cost-app** + Redeploy |
| `DATABASE_URL is not set` في Logs | أضف Reference `${{Postgres.DATABASE_URL}}` على خدمة التطبيق |
| صفحة بيضاء | راجع Build logs — فشل `vite build`؟ |
| 403 بعد تسجيل الدخول | انسخ `DATABASE_PUBLIC_URL` من Postgres → Connect، ثم: `npm run local:promote-google-admin -- your@gmail.com` — ثم سجّل خروجاً وادخل |

## 9) نشر منفصل للواجهة (اختياري)

إذا استضفت الواجهة على Vercel/Netlify:

1. `VITE_API_BASE_URL=https://<api-domain>/api`
2. `VITE_DATA_BACKEND=local`
3. على API: `CORS_ORIGIN=https://<frontend-domain>`
4. `SESSION_COOKIE_SAME_SITE=none`

---

## 10) Electron (المرحلة 8)

قشرة سطح مكتب رقيقة — تحمّل نفس رابط Railway:

```powershell
npm install   # مرة واحدة (electron + electron-builder)
$env:WEB_COST_APP_URL="https://YOUR-DOMAIN.up.railway.app"
npm run electron:dev
```

لإنشاء `Setup.exe` (المرحلة 10): `npm run electron:pack` → مجلد `release/`

### electron-updater (تحديث القشرة تلقائياً)

**المحتوى (React/API)** يتحدّث عبر Railway بدون إعادة تثبيت. **`electron-updater`** يحدّث **Setup.exe / القشرة** فقط عند رفع إصدار جديد.

> **مهم:** `git push` → Railway redeploy يحدّث **الواجهة والـ API** فوراً. **لا حاجة** لـ `electron:publish` لإصلاحات BOQ / تقارير / React — إلا إذا غيّرت `electron/main.ts` (مثل مسح الكاش أو OAuth).

#### الإصلاحات لا تظهر على Electron بعد النشر؟

| السبب | الحل |
|--------|------|
| **لم يكتمل نشر Railway** | Railway → Deployments → آخر build **Success** · افتح نفس الرابط في **Chrome** (نافذة خاصة) وقارن |
| **كاش Chromium في Electron** | أغلق التطبيق **بالكامل** (من Task Manager) ثم افتحه · أو **F12** → Reload · القشرة **1.0.8+** تمسح HTTP cache عند كل تشغيل + **Ctrl+Shift+R** = reload بدون كاش |
| **تغييرات بيانات فقط** (backfill BOQ · migrate) | الكود وحده لا يكفي — على Railway: `prisma migrate deploy` (تلقائي عند الإقلاع) + **الإعدادات → قاعدة البيانات → استيراد أسعار BOQ من Firestore** (admin + `FIREBASE_SERVICE_ACCOUNT_JSON` على خدمة API) · أو **`npm run local:backfill-boq-rates -- --live`** ضد **`DATABASE_PUBLIC_URL`** · أو **Push to production** من محلي |
| **التطوير محلي ≠ Electron** | Electron يقرأ **Postgres على Railway** · `localhost:3000` يقرأ **Postgres محلي** — أعداد GL/BOQ تختلف حتى Push |

**تحقق سريع:** Electron و Chrome يفتحان **`https://web-cost-app-production.up.railway.app`** (من `electron/dist/production-url.json`). إن Chrome يظهر الإصلاح وElectron لا — المشكلة كاش؛ إن الاثنان قديمان — انتظر/أعد نشر Railway.

| الأمر | الغرض |
|-------|--------|
| `npm run electron:pack` | بناء محلي → `release/` + `latest.yml` |
| `npm run electron:publish` | بناء + رفع **GitHub Release** (يتطلب `GH_TOKEN`) |

**الإصدار:** `package.json` → `"version"` (حالياً `1.0.0`) — ارفع الرقم قبل كل release (`1.0.1` …).

#### نشر release (PowerShell)

```powershell
cd "D:\cost web app\web-cost-app"
$env:WEB_COST_APP_URL="https://web-cost-app-production.up.railway.app"
$env:GH_TOKEN="ghp_..."   # GitHub PAT — scope: repo
npm run electron:publish
```

#### سلوك التطبيق المثبّت

- بعد ~8 ثوانٍ من التشغيل: فحص GitHub Releases
- إن وُجد إصدار أحدث: تحميل في الخلفية → حوار **إعادة التشغيل**
- **لا فحص** في `electron:dev` (غير packaged)

#### مستودع خاص (private)

- `GH_TOKEN` مطلوب لل**نشر** فقط
- لل**تحديث** على أجهزة المستخدمين: اجعل **Release assets عامة** أو استخدم feed بديل:

```powershell
$env:ELECTRON_UPDATE_URL="https://your-cdn.example.com/desktop-updates/"
npm run electron:pack
```

(يجب أن ي hosting يحتوي `latest.yml` + `Web Cost App Setup x.y.z.exe`)

#### خطأ Windows: `Cannot create symbolic link` (winCodeSign)

إذا فشل `electron:publish` أثناء تحميل `winCodeSign`:

1. **الافتراضي في المشروع:** `"signAndEditExecutable": false` — لا حاجة لـ winCodeSign بدون شهادة.
2. **بديل:** Windows **Settings → Developer Mode** ON (يسمح بإنشاء symlinks).
3. **بديل:** PowerShell **كمسؤول (Run as administrator)**.

---

**مهم:** التوقيع **لا يزيل** التحذير فوراً دائماً. SmartScreen يعتمد على **سمعة الناشر (reputation)**:
- **EV Code Signing** (~300–500 USD/سنة): USB token إلزامي؛ سمعة أسرع، غالباً بدون «Windows protected your PC» بعد أيام قليلة.
- **OV Code Signing** (~200–400 USD/سنة): أرخص؛ التوقيع صحيح لكن SmartScreen قد يظهر حتى يكثر توزيع الملف (أسابيع/شهور).

**موردون شائعون:** DigiCert · Sectigo · SSL.com · GlobalSign (ابحث عن **Authenticode / Microsoft Authenticode**).

#### 1) بعد شراء الشهادة

1. Firebase/Google **لا علاقة لها** — هذا توقيع Windows فقط.
2. احصل على ملف **`.pfx`** (أو `.p12`) + كلمة مرور.
3. **لا ترفع `.pfx` إلى GitHub** — احفظه محلياً أو في secrets CI.

#### 2) بناء موقّع (PowerShell)

```powershell
cd "D:\cost web app\web-cost-app"
$env:WEB_COST_APP_URL="https://web-cost-app-production.up.railway.app"
$env:WIN_CSC_LINK="D:\certs\web-cost-app.pfx"
$env:WIN_CSC_KEY_PASSWORD="your-pfx-password"
npm run electron:pack
```

في Logs يجب أن ترى `signing with signtool.exe` **بدون** `signing is skipped`.

#### 3) تحقق

```powershell
Get-AuthenticodeSignature "release\Web Cost App Setup 0.0.0.exe"
```

`Status` يجب أن يكون `Valid` (أو `UnknownError` نادراً رغم توقيع صحيح).

#### 4) EV + USB token

- ثبّت برنامج المورّد (SafeNet / eToken).
- `.pfx` على EV غالباً **على الجهاز/USB** وليس ملفاً عادياً — اتبع دليل المورّد.
- البناء يجب أن يكون على الجهاز الذي فيه التوكن.

#### 5) بدائل مؤقتة (بدون شهادة)

| الطريقة | ملاحظة |
|---------|--------|
| **«More info» → Run anyway** | طبيعي للمستخدمين الداخليين |
| **Unblock** في Properties | لا يكفي لـ SmartScreen عادة |
| **Intune / GPO** | للشركات — السماح بـ `com.webcostapp.desktop` |

**`appId` الحالي:** `com.webcostapp.desktop` (في `package.json` → `build`).

---

**الملفات:** `railway.toml` · `deploy/railway-api.Dockerfile` · `electron/main.ts`
