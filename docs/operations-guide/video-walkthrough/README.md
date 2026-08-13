# فيديو توضيحي مع خطوات وأسهم + تعليق بصوتك (خيار ب)

## معاينة تفاعلية (نص + أسهم ± صوت)

```powershell
npm run docs:video -- --headed
```

أو افتح عبر أي سيرفر محلي لمجلد `docs/operations-guide` (لا تفتح `index.html` كملف خام إن أردت `steps.json`/الصوت).

- أسهم برتقالية + إطار مضيء
- شريط سفلي برقم الخطوة وشرحها
- إن وُجدت ملفات `audio/01.mp3`… يعمل **التعليق الصوتي** ويتزامن زمن كل خطوة مع طول المقطع (`M` لكتم الصوت)

## استنساخ صوتك (ElevenLabs)

1. سجّل/اجمع **1–2 دقيقة** بصوتك (عربي واضح، بدون موسيقى) وضع الملفات في:

   `docs/operations-guide/video-walkthrough/voice-samples/`

   (التفاصيل في `voice-samples/README.md`)

2. في `.env` (محلي فقط):

```env
ELEVENLABS_API_KEY=sk_...
```

3. استنساخ الصوت:

```powershell
npm run docs:voice:clone
```

انسخ `voice_id` المطبوعة إلى `.env`:

```env
ELEVENLABS_VOICE_ID=xxxxxxxx
```

4. توليد مقاطع التعليق من `steps.json`:

```powershell
npm run docs:voice:narrate
```

5. تسجيل الفيديو المرئي:

```powershell
npm run docs:video
```

المخرجات:

- `output/ops-walkthrough.webm` — صورة فقط (Playwright لا يلتقط صوت التبويب)
- `output/ops-walkthrough-with-voice.mp4` — **الفيديو بعد دمج الصوت**
- `audio/*.mp3` — تعليقك المستنسخ
- للمعاينة الحية بالصوت: `npm run docs:video -- --headed`

### دمج صوت في ملف فيديو واحد

```powershell
npm run docs:video
npm run docs:video:mux
```

الملف النهائي:

`docs/operations-guide/video-walkthrough/output/ops-walkthrough-with-voice.mp4`

## تعديل نص التعليق

عدّل حقل `narration` في `steps.json` ثم أعد:

```powershell
npm run docs:voice:narrate
```
