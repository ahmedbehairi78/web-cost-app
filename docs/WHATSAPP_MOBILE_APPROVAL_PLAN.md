# خطة تنفيذ — تنبيهات واتساب + موافقة موبايل

> **المشروع:** Web Cost App (Concord Plus)  
> **التاريخ:** 2026-06-18  
> **الحالة:** ⬜ لم يبدأ  
> **يعتمد على:** `notificationFeed.ts` · `notificationsRouter` · Railway Postgres · Firebase Auth

---

## ملخص القرار المعماري

| البند | القرار |
|-------|--------|
| **قناة التنبيه** | WhatsApp Business Cloud API (Meta مباشرة) — قوالب **Utility** |
| **صفحة الموافقة** | **PWA** داخل نفس الـ SPA (`/m/approve/...`) — لا متجر تطبيقات في المرحلة 1 |
| **مصدر التنبيهات** | نفس `notificationKey` في `buildNotificationFeed` (`transfer:42`, `mos:…`) |
| **تنفيذ الاعتماد** | إعادة استخدام مسارات API الحالية عبر **طبقة موحّدة** `POST /api/notifications/actions` |
| **الأمان** | Firebase Google sign-in + token لمرة واحدة في الرابط + فحص صلاحيات الخادم |
| **الإرسال** | جدول `notification_outbox` + worker دوري على Railway (نفس الحاوية) |
| **التكلفة التشغيلية** | ~$3–15/شهر لشركة متوسطة (مصر Utility ≈ $0.0036/رسالة) |

### ما لا نفعله في المرحلة 1

- لا اعتماد مالي **داخل** واتساب (فقط رابط للتطبيق).
- لا تطبيق React Native منفصل.
- لا Firestore للتنبيهات — Postgres فقط.
- لا تغطية كل أنواع التنبيهات — نبدأ بـ **3 أنواع عالية القيمة**.

---

## أنواع التنبيهات — أولوية التنفيذ

| الأولوية | `type` في feed | إجراء الموبايل | API موجود |
|----------|----------------|----------------|-----------|
| **P1** | `transfer_pending_b` | اعتماد وجهة | `POST …/approve-b` |
| **P1** | `transfer_pending_projects` | اعتماد إدارة مشاريع | `POST …/approve-projects` |
| **P1** | `mos_draft` | اعتماد + GL | `POST /api/mos-extracts/:id/approve` |
| **P2** | `subcontract_extract_pending` | اعتماد | `PATCH …/subcontract-extracts/:id` |
| **P2** | `cheque_overdue` / `cheque_pending` | فتح البنوك (عرض فقط) | — |
| **P3** | `billing_review` | فتح الفوترة | تغيير status |
| **P3** | `consumption_draft` | تأكيد صرف | `POST …/consumption-orders/:id/confirm` |
| **P3** | `overhead_draft` | إقفال أعباء | `POST …/overhead-allocation/…` |

---

## تتبع التقدّم

| المرحلة | الوصف | المدة | الحالة |
|---------|--------|-------|--------|
| 0 | إعداد Meta WhatsApp + متغيرات البيئة | 2–5 أيام | ⬜ |
| 1 | Prisma — هاتف المستخدم + outbox + tokens | 1 يوم | ⬜ |
| 2 | إعدادات المستخدم — رقم واتساب + opt-in | 1–2 يوم | ⬜ |
| 3 | API موحّد للإجراءات + تفاصيل التنبيه | 2–3 أيام | ⬜ |
| 4 | واجهة PWA موبايل `/m/*` | 2–3 أيام | ⬜ |
| 5 | ربط الأحداث → outbox (P1) | 1–2 يوم | ⬜ |
| 6 | Worker إرسال واتساب | 2 يوم | ⬜ |
| 7 | تذكير 24 ساعة + إلغاء عند الاعتماد | 1 يوم | ⬜ |
| 8 | اختبار + نشر Railway | 1–2 يوم | ⬜ |
| 9 | توسعة P2/P3 (اختياري) | لاحقاً | ⬜ |

**الترتيب الموصى به:** `0 → 1 → 2 → 3 → 4 → 5 → 6 → 8 → 7 → 9`

**المدة الإجمالية للمراحل 0–8:** ~3–4 أسابيع (مطوّر واحد).

---

## المرحلة 0 — إعداد WhatsApp Business (Meta)

**المدة:** 2–5 أيام (انتظار التحقق) · **المخاطر:** تأخر Business Verification

### checklist خارج الكود

- [ ] حساب [Meta Business](https://business.facebook.com/) للشركة
- [ ] تطبيق في [Meta Developers](https://developers.facebook.com/) مع منتج **WhatsApp**
- [ ] رقم هاتف Business (SIM أو VoIP معتمد) — **ليس رقم واتساب شخصي**
- [ ] Business Verification مكتمل
- [ ] تسجيل قوالب الرسائل (انظر § قوالب واتساب أدناه)
- [ ] System User + Token دائم (`WHATSAPP_ACCESS_TOKEN`)
- [ ] `phone_number_id` و `waba_id` من لوحة Meta

### متغيرات بيئة جديدة (`server/src/env.ts`)

```env
# WhatsApp Business Cloud API
WHATSAPP_ENABLED=true
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_BUSINESS_ACCOUNT_ID=...
WHATSAPP_API_VERSION=v21.0

# روابط التطبيق (للرسائل)
APP_PUBLIC_BASE_URL=https://web-cost-app-production.up.railway.app

# توكنات الروابط العميقة
NOTIFICATION_LINK_SECRET=<random-64-chars>
NOTIFICATION_LINK_TTL_HOURS=48

# Worker
NOTIFICATION_WORKER_ENABLED=true
NOTIFICATION_WORKER_INTERVAL_MS=60000
NOTIFICATION_REMINDER_HOURS=24
```

### تحقق يدوي

```powershell
# بعد النشر — health يبقى كما هو
curl https://YOUR-DOMAIN.up.railway.app/api/health/live

# endpoint اختبار داخلي (admin فقط — يُضاف في المرحلة 6)
# POST /api/notifications/test-whatsapp  { "phone": "+2010..." }
```

---

## المرحلة 1 — نموذج البيانات (Prisma)

**المدة:** 1 يوم · **الملف:** `prisma/schema.prisma` + migration جديدة

### 1.1 توسيع `User`

```prisma
model User {
  // ... الحقول الحالية
  phoneE164          String?  @map("phone_e164")           // +201012345678
  whatsappOptIn      Boolean  @default(false) @map("whatsapp_opt_in")
  preferredLanguage  String   @default("ar") @map("preferred_language") // ar | en
  whatsappNotifyTypes Json    @default("[]") @map("whatsapp_notify_types") // [] = الكل المسموح للدور

  notificationOutbox NotificationOutbox[]
  approvalLinkTokens ApprovalLinkToken[]
}
```

### 1.2 `notification_outbox`

```prisma
model NotificationOutbox {
  id               String    @id @default(uuid())
  userId           String    @map("user_id")
  notificationKey  String    @map("notification_key")  // transfer:42
  channel          String    @default("whatsapp")      // whatsapp | (لاحقاً fcm)
  templateName     String    @map("template_name")     // approval_required
  payload          Json      // { titleAr, titleEn, entityLabel, actionUrl }
  status           String    @default("pending")       // pending | sent | failed | skipped | cancelled
  dedupeHash       String    @map("dedupe_hash")         // sha256(userId+key+template)
  attemptCount     Int       @default(0) @map("attempt_count")
  lastError        String?   @map("last_error")
  providerMsgId    String?   @map("provider_message_id")
  scheduledAt      DateTime  @default(now()) @map("scheduled_at")
  sentAt           DateTime? @map("sent_at")
  createdAt        DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([dedupeHash])
  @@index([status, scheduledAt])
  @@index([notificationKey])
  @@map("notification_outbox")
}
```

### 1.3 `approval_link_tokens`

```prisma
model ApprovalLinkToken {
  id              String    @id @default(uuid())
  userId          String    @map("user_id")
  notificationKey String    @map("notification_key")
  tokenHash       String    @unique @map("token_hash")  // sha256 — لا تخزين plain
  expiresAt       DateTime  @map("expires_at")
  usedAt          DateTime? @map("used_at")
  createdAt       DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, notificationKey])
  @@map("approval_link_tokens")
}
```

### أوامر

```powershell
cd "D:\cost web app\web-cost-app"
npx prisma migrate dev --name add_whatsapp_notifications
npm run railway:build   # prisma generate للإنتاج
```

---

## المرحلة 2 — إعدادات المستخدم (واجهة + API)

**المدة:** 1–2 يوم

### 2.1 خادم

| Method | Path | صلاحية |
|--------|------|--------|
| `PATCH` | `/api/settings/users/:id/contact` | `settings` (admin) أو المستخدم لنفسه |
| `GET` | `/api/settings/users/:id/contact` | نفسه أو admin |

**Body:**

```json
{
  "phoneE164": "+201012345678",
  "whatsappOptIn": true,
  "preferredLanguage": "ar",
  "whatsappNotifyTypes": ["transfer_pending_b", "transfer_pending_projects", "mos_draft"]
}
```

**تحقق:**

- صيغة E.164 (`+20…` لمصر)
- `whatsappOptIn=true` يتطلب `phoneE164` غير فارغ
- admin فقط يعدّل مستخدمين آخرين

### 2.2 واجهة — `Settings.tsx` (قسم إدارة المستخدمين)

- حقل **رقم واتساب** مع تلميح الصيغة الدولية
- ☑ **تفعيل تنبيهات واتساب** (opt-in صريح — نص قانوني قصير)
- اختيار لغة الرسالة (ar/en)
- (اختياري) checkboxes لأنواع التنبيهات — افتراضي: كل ما يسمح به دور المستخدم

### 2.3 ملفات متوقعة

| ملف | تغيير |
|-----|-------|
| `server/src/modules/settings.ts` | routes contact |
| `src/components/settings/…` أو `Settings.tsx` | حقول UI |
| `src/services/local/modulesApi.ts` | `settingsApi.patchUserContact` |
| `src/context/LanguageContext.tsx` | مفاتيح `whatsapp_*` |

---

## المرحلة 3 — API الموحّد للإجراءات

**المدة:** 2–3 أيام · **القلب:** `server/src/lib/notificationActions.ts`

### 3.1 قراءة تفاصيل تنبيه للموبايل

```
GET /api/notifications/item?key=transfer:42
```

**Response:**

```json
{
  "key": "transfer:42",
  "type": "transfer_pending_projects",
  "priority": "normal",
  "titleAr": "…",
  "titleEn": "…",
  "summary": { "transferNumber": "PTRF-…", "fromProject": "…", "toProject": "…" },
  "allowedActions": ["approve", "reject", "open_web"],
  "requiresWarehouseCodes": false
}
```

- يستدعي نفس منطق الصلاحيات في `notificationFeed.ts`
- `summary` يُبنى حسب `type` من Postgres

### 3.2 تنفيذ إجراء

```
POST /api/notifications/actions
{
  "key": "transfer:42",
  "action": "approve"   // approve | reject | confirm
}
```

**خريطة الإجراءات (P1):**

| `key` prefix | `action: approve` | يستدعي |
|--------------|-------------------|--------|
| `transfer:` + `pending_b` | `approve` | `projectInventoryTransfers approve-b` |
| `transfer:` + `pending_projects` | `approve` | `approve-projects` (يحل أكواد 127 تلقائياً من المشاريع) |
| `mos:` | `approve` | `mosExtracts approve` |
| `transfer:` | `reject` | `reject-b` أو `reject-projects` حسب الحالة |

**بعد النجاح:**

1. `mark-read` ضمنياً لـ `notificationKey`
2. `cancelPendingOutbox(notificationKey)` — لا تذكير لاحق
3. (اختياري) إدراج outbox `approval_done`

### 3.3 Token الرابط العميق

```
GET /api/notifications/link/verify?t=<plain-token>
→ { valid, key, expiresAt }  // قبل login

POST /api/notifications/link/consume
{ "token": "…" }  // بعد Firebase session — يربط الجلسة بالـ key
```

- التوليد: `createApprovalLinkToken(userId, notificationKey)` عند إدراج outbox
- الرابط: `{APP_PUBLIC_BASE_URL}/m/approve?t={plain}`

### 3.4 ملفات جديدة/معدّلة

| ملف | الدور |
|-----|-------|
| `server/src/lib/notificationActions.ts` | خريطة key → approve handlers |
| `server/src/lib/approvalLinkToken.ts` | توليد/تحقق HMAC |
| `server/src/modules/notifications.ts` | routes جديدة |
| `server/src/lib/notificationFeed.ts` | تصدير `resolveRecipientsForKey()` |
| `src/services/local/modulesApi.ts` | `notificationsApi.item` · `.action` |

### 3.5 اختبارات

```
server/src/lib/notificationActions.test.ts
server/src/lib/approvalLinkToken.test.ts
```

---

## المرحلة 4 — واجهة PWA موبايل (`/m/*`)

**المدة:** 2–3 أيام

### 4.1 التوجيه (React Router أو شرط في `App.tsx`)

| مسار | مكوّن |
|------|--------|
| `/m` | `MobileInboxPage` — قائمة التنبيهات المعلقة |
| `/m/approve` | `MobileApprovePage` — يقرأ `?t=` أو `?key=` |

**لا تفتح نافذة `WindowManager`** — layout موبايل بسيط:

- شعار Concord Plus
- بطاقة التفاصيل
- أزرار كبيرة: **اعتماد** · **رفض** · **فتح في الويب الكامل**
- يتطلب `auth.currentUser` — وإلا شاشة Google sign-in مبسطة (نفس `Login.tsx` logic)

### 4.2 CSS موبايل

- `src/index.css` — `@media (max-width: 640px)` + class `.mobile-approval-shell`
- دعم RTL/LTR من `LanguageContext`
- `viewport` موجود في `index.html`

### 4.3 سلوك بعد الاعتماد

- Toast نجاح
- إخفاء الأزرار + عرض "تم الاعتماد"
- زر "العودة للتنبيهات"

### 4.4 ملفات جديدة

```
src/pages/mobile/MobileShell.tsx
src/pages/mobile/MobileInboxPage.tsx
src/pages/mobile/MobileApprovePage.tsx
src/pages/mobile/useMobileApproval.ts
```

---

## المرحلة 5 — ربط الأحداث بـ outbox (P1)

**المدة:** 1–2 يوم · **الملف:** `server/src/lib/enqueueNotification.ts`

### 5.1 دالة مركزية

```ts
await enqueueWhatsAppForNotification({
  notificationKey: `transfer:${transfer.id}`,
  type: 'transfer_pending_projects',
  titleAr: '…',
  titleEn: '…',
  entityId: String(transfer.id),
});
```

**الخطوات داخلياً:**

1. `resolveRecipientsForKey()` — من `notificationFeed` logic (أدوار + عقود + opt-in + phone)
2. لكل مستلم: `upsert notification_outbox` بـ `dedupeHash`
3. `createApprovalLinkToken()` — رابط فريد لكل مستلم

### 5.2 نقاط الربط (hooks)

| الحدث | الملف | بعد |
|-------|-------|-----|
| إنشاء تحويل → `pending_b` | `projectInventoryTransfers.ts` `POST /` | `enqueue` |
| `approve-b` → `pending_projects` | `projectInventoryTransfers.ts` | `enqueue` للمديرين |
| إنشاء MOS draft | `mosExtracts.ts` `POST /` | `enqueue` |
| اعتماد/رفض/إلغاء | handlers الاعتماد | `cancelOutboxForKey` |

**مهم:** الاستدعاء **بعد** commit الـ transaction — لا داخل `prisma.$transaction` (تجنب rollback يمنع الإرسال).

### 5.3 عدم الإزعاج

- تخطي إذا `WHATSAPP_ENABLED=false`
- تخطي إذا لا مستلمين بـ `whatsappOptIn` + `phoneE164`
- تخطي إذا المستخدم أنشأ الطلب بنفسه (اختياري)

---

## المرحلة 6 — Worker إرسال واتساب

**المدة:** 2 يوم

### 6.1 عميل Meta

**ملف:** `server/src/integrations/whatsappClient.ts`

```ts
sendTemplateMessage({
  toE164: '+2010…',
  templateName: 'approval_required',
  languageCode: 'ar',
  components: [
    { type: 'body', parameters: [title, entityLabel, priorityLabel] },
    { type: 'button', sub_type: 'url', parameters: [tokenPath] },
  ],
});
```

### 6.2 Worker

**ملف:** `server/src/jobs/notificationWorker.ts`

- يُشغّل من `server/src/index.ts` عند `NOTIFICATION_WORKER_ENABLED`
- `setInterval` كل 60 ثانية:
  - `findMany` حيث `status=pending` و `scheduledAt <= now` و `attemptCount < 5`
  - إرسال → `sent` أو `failed` مع `lastError`
  - backoff: +5 دقائق عند الفشل

### 6.3 Endpoint اختبار (admin)

```
POST /api/notifications/test-whatsapp
{ "phoneE164": "+2010…" }
```

### 6.4 مراقبة

- log structured: `[whatsapp] sent key=transfer:42 user=… msgId=…`
- `GET /api/notifications/outbox-stats` (admin) — pending/sent/failed counts

---

## المرحلة 7 — تذكير 24 ساعة

**المدة:** 1 يوم

### المنطق

1. عند `sent` الأول: جدولة صف ثانٍ `templateName=approval_reminder` بعد `NOTIFICATION_REMINDER_HOURS`
2. قبل الإرسال: تحقق أن `notificationKey` ما زال في feed (لم يُعتمد)
3. عند أي `approve/reject`: `UPDATE outbox SET status='cancelled' WHERE notification_key=… AND status='pending'`

### تكلفة إضافية

~30% رسائل إضافية ≈ +$1–3/شهر لشركة متوسطة.

---

## المرحلة 8 — اختبار ونشر

**المدة:** 1–2 يوم

### 8.1 اختبارات آلية

```powershell
npm run test -- server/src/lib/notificationActions.test.ts
npm run test -- server/src/lib/approvalLinkToken.test.ts
npm run test -- server/src/lib/notificationFeed.test.ts
npm run lint
```

### 8.2 Golden paths يدوية

| # | السيناريو | التحقق |
|---|-----------|--------|
| G1 | إنشاء تحويل بين مشروعين | واتساب للمدير + يظهر في الجرس |
| G2 | فتح رابط `/m/approve?t=` على موبايل | login → تفاصيل → اعتماد |
| G3 | اعتماد من الموبايل | stock + GL + اختفاء من feed |
| G4 | اعتماد من الويب | إلغاء تذكير واتساب المعلّق |
| G5 | رابط منتهي / مستخدم خاطئ | 403 برسالة واضحة |
| G6 | مستخدم بدون opt-in | لا رسالة — feed فقط |
| G7 | `WHATSAPP_ENABLED=false` | outbox يُتخطى — لا أخطاء |

### 8.3 نشر Railway

```powershell
git push origin main
# Railway: prisma migrate deploy تلقائي عند start
# أضف متغيرات WHATSAPP_* في لوحة Railway
```

### 8.4 تحقق Post-deploy

```powershell
curl https://web-cost-app-production.up.railway.app/api/health
# admin: POST test-whatsapp
```

---

## قوالب واتساب (Meta — Utility)

### `approval_required` (عربي)

```
🔔 {{1}}

{{2}}
الأولوية: {{3}}

افتح للموافقة:
[زر URL ديناميكي — المسار فقط في parameter]

— Concord Plus
```

| متغير | مثال |
|-------|------|
| `{{1}}` | تنبيه جديد — تحويل مخزن |
| `{{2}}` | PTRF-20260618-0003 بانتظار اعتماد إدارة المشاريع |
| `{{3}}` | عادية / عاجلة |
| زر URL | `m/approve?t=abc123` (نسبي — Meta تضيف النطاق في الإعداد) |

### `approval_reminder` (عربي)

```
⏰ تذكير — {{1}}

{{2}}
ما زال بانتظار موافقتك.

[زر URL]
```

### `approval_done` (اختياري — المرحلة 9)

```
✅ تم الاعتماد

{{1}}
{{2}}
```

---

## الأمان

| التهديد | التخفيف |
|---------|---------|
| تسريب رابط | token لمرة واحدة · TTL 48 ساعة · hash في DB |
| مستخدم غير مخوّل | `requireAuth` + نفس `canApproveTransfers` |
| CSRF على actions | session cookie + SameSite |
| إعادة play | `usedAt` على token · idempotency على approve API |
| تسريب مبالغ | لا مبالغ في رسالة واتساب |
| Meta rate limit | worker مع backoff + dedupe |

**عمليات مالية حساسة (لاحقاً):** إعادة Google popup (`verifyAdministratorIdentity`) قبل اعتماد MOS > حد معين — phase 9.

---

## تكلفة التشغيل (مرجع)

| السيناريو | رسائل/شهر | تكلفة Meta |
|-----------|-----------|------------|
| صغيرة (5 أحداث/يوم) | ~225 | ~$1 |
| متوسطة (20/يوم + تذكير) | ~1,200 | ~$5 |
| نشطة (50/يوم) | ~3,000 | ~$11 |

+ Railway: **$0 إضافي** (نفس الخدمة)  
+ Meta BSP: **$0** (مباشرة)

---

## خريطة الملفات الكاملة

```
prisma/schema.prisma                          ← User + Outbox + Tokens
prisma/migrations/YYYYMMDD_whatsapp_…/        ← migration

server/src/env.ts                             ← WHATSAPP_* vars
server/src/integrations/whatsappClient.ts     ← Meta API
server/src/lib/enqueueNotification.ts         ← إدراج outbox
server/src/lib/notificationActions.ts         ← approve map
server/src/lib/approvalLinkToken.ts           ← tokens
server/src/lib/notificationFeed.ts            ← resolveRecipients
server/src/jobs/notificationWorker.ts         ← cron sender
server/src/modules/notifications.ts           ← routes موسّعة
server/src/modules/projectInventoryTransfers.ts ← hooks
server/src/modules/mosExtracts.ts               ← hooks
server/src/modules/settings.ts                ← user contact
server/src/index.ts                             ← start worker

src/pages/mobile/MobileShell.tsx
src/pages/mobile/MobileInboxPage.tsx
src/pages/mobile/MobileApprovePage.tsx
src/App.tsx                                   ← /m routes
src/components/Settings.tsx                   ← phone + opt-in
src/services/local/modulesApi.ts              ← API client
src/context/LanguageContext.tsx               ← i18n
src/types.ts                                  ← contact types

docs/WHATSAPP_MOBILE_APPROVAL_PLAN.md         ← هذا الملف
```

---

## المخاطر والتخفيف

| المخاطر | الاحتمال | التخفيف |
|---------|----------|---------|
| تأخر Meta Verification | متوسط | ابدأ المراحل 1–5 بدون إرسال فعلي |
| `approve-projects` يحتاج أكواد مخزن | منخفض | auto-resolve من `projectWarehouseGl` |
| ازدواج إرسال | منخفض | `dedupeHash` unique |
| مدير بدون رقم | شائع | feed + تنبيه في Settings للأدمن |
| فشل واتساب | متوسط | feed يبقى مصدر الحقيقة |

---

## أمر الاستئناف السريع

```
@docs/WHATSAPP_MOBILE_APPROVAL_PLAN.md
المرحلة الحالية: 0
التالي: Meta Business + قالب approval_required
ثم: prisma migrate → settings phone → notificationActions → /m/approve
Golden: G1 تحويل + G2 رابط موبايل + G3 اعتماد
```

---

## المرحلة 9 — توسعات لاحقة (اختياري)

- [ ] FCM push كبديل/مكمّل لواتساب
- [ ] باقي أنواع التنبيهات (P2/P3)
- [ ] SSE بدل polling 90s في `NotificationBell.tsx`
- [ ] React Native shell (إن طُلب متجر تطبيقات)
- [ ] digest يومي — رسالة واحدة تجمع كل المعلّق
- [ ] `verifyAdministratorIdentity` على الموبايل للمبالغ الكبيرة
- [ ] لوحة مراقبة outbox في Settings → Database
