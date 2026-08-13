# لقطات شاشات الموديولات

كتالوج منظم لكل تبويب رئيسي (T1) ومودالات الكتابة الحرجة (T2).

| ملف | الغرض |
|-----|--------|
| `catalog.json` | فهرس الشاشات + `capturedAt` بعد كل تشغيل |
| `_shared/` | دخول · سطح المكتب · إعدادات عامة |
| `01-dashboard` … `11-settings/` | لقطات حسب الموديول |

## المتطلبات

1. تشغيل التطبيق محلياً:

```powershell
npm run dev:local
```

2. بيانات دخول للتقاط الآلي (مطلوبة — الجلسة المحفوظة قد تنتهي):

```powershell
# في .env أو في الجلسة:
$env:SCREENSHOT_EMAIL="your@email.com"
$env:SCREENSHOT_PASSWORD="your-password"
```

أو دخول يدوي مرة واحدة (يفتح Chromium):

```powershell
npm run docs:screenshots:modules:manual
```

الجلسة تُحفظ في `docs/operations-guide/.auth/user.json` (غير مُتتبَّع في git).

تحقق الفهرس بدون متصفح:

```powershell
npm run docs:screenshots:modules -- --dry-run
npm run docs:screenshots:modules -- --module costs --tier 1 --dry-run
```

## أوامر

```powershell
# كل الشاشات (T1 + T2)
npm run docs:screenshots:modules

# موديول واحد
npm run docs:screenshots:modules -- --module costs

# تبويب واحد
npm run docs:screenshots:modules -- --module inventory --view balance

# المستوى فقط
npm run docs:screenshots:modules -- --tier 1
npm run docs:screenshots:modules -- --module banks --tier 2

# واجهة ظاهرة / جلسة جديدة
npm run docs:screenshots:modules -- --headed
npm run docs:screenshots:modules -- --fresh-login

# URL مختلف
npm run docs:screenshots:modules -- --url http://localhost:3000
```

`--module _shared` يلتقط شاشات الدخول / سطح المكتب / الإعدادات العامة.

## دفعات مقترحة

```powershell
# A — تشغيلية
npm run docs:screenshots:modules -- --module technical --tier 1
npm run docs:screenshots:modules -- --module costs --tier 1
npm run docs:screenshots:modules -- --module inventory --tier 1
npm run docs:screenshots:modules -- --module purchase_requests --tier 1

# B — محاسبة وتقارير
npm run docs:screenshots:modules -- --module ledger --tier 1
npm run docs:screenshots:modules -- --module banks --tier 1
npm run docs:screenshots:modules -- --module reports --tier 1

# C — دعم + مشتركة + مودالات
npm run docs:screenshots:modules -- --module assets --tier 1
npm run docs:screenshots:modules -- --module payroll --tier 1
npm run docs:screenshots:modules -- --module settings --tier 1
npm run docs:screenshots:modules -- --module _shared
npm run docs:screenshots:modules -- --tier 2
```

## ملاحظات

- الدقة ثابتة `1440×900` · اللغة `ar-EG`.
- التنقل عبر `window.__webCostNavigate(moduleId, viewId)`.
- عند فشل عنصر يُحفظ `_debug-failure-{id}.png` في نفس المجلد.
- اللقطات العامة القديمة تبقى في `../screenshots/` — هذا المجلد منفصل.
