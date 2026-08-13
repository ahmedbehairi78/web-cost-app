# دليل العمليات الخارجي

| ملف | الغرض |
|-----|--------|
| `OPERATIONS_FLOWS.md` | شرح نصي عام + صور |
| `slides.html` | عرض تقديمي عام |
| `screenshots/*.png` | لقطات عامة من التطبيق |
| `module-screens/` | **لقطات لكل موديول/تبويب** (`catalog.json` · T1 قوائم · T2 مودالات) |
| `project-create-demo/` | **عرض إنشاء مشروع + أثر فوري** (`DEMO.md` · `slides.html`) |
| `boq-materials-demo/` | **عقد + 3 بنود BOQ + ربط أصناف** (`DEMO.md` · `slides.html`) |
| `video-walkthrough/` | **فيديو توضيحي بخطوات + أسهم** (`index.html` · `output/ops-walkthrough.webm`) |

## التقاط اللقطات العامة

```powershell
$env:SCREENSHOT_EMAIL="your@email.com"
$env:SCREENSHOT_PASSWORD="your-password"
npm run docs:screenshots
# أو: npm run docs:screenshots:manual
```

## لقطات الموديولات (كل تبويب)

```powershell
$env:SCREENSHOT_EMAIL="your@email.com"
$env:SCREENSHOT_PASSWORD="your-password"
npm run docs:screenshots:modules
# موديول واحد: npm run docs:screenshots:modules -- --module costs
# التفاصيل: module-screens/README.md
```

## عرض إنشاء مشروع (مع بيانات حقيقية)

```powershell
npm run docs:demo-project -- --headed
# إن وُجد المشروع مسبقاً وأردت لقطات الأثر فقط:
npm run docs:demo-project -- --headed --impact-only
```

ثم افتح `project-create-demo/slides.html`.

## عرض عقد + BOQ + ربط أصناف

```powershell
npm run docs:demo-boq -- --headed
```

ثم افتح `boq-materials-demo/slides.html`.

## فيديو بخطوات وأسهم (+ تعليق بصوتك)

```powershell
# 1) عيّنات صوت في video-walkthrough/voice-samples/ + ELEVENLABS_API_KEY في .env
npm run docs:voice:clone
# 2) ضع ELEVENLABS_VOICE_ID في .env ثم:
npm run docs:voice:narrate
npm run docs:video
```

- التفاصيل: `video-walkthrough/README.md`
- الملف المرئي: `video-walkthrough/output/ops-walkthrough.webm`
- الصوت: `video-walkthrough/audio/*.mp3`
