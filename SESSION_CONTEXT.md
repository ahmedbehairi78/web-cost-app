# Session Context — Web Cost App

**آخر تحديث:** 2026-06-26  
**الحالة:** ✅ **Admin projects / Inventory load on Electron** — fixed and verified by user

---

## ملخص سريع

| البند | التفاصيل |
|-------|----------|
| المستخدم | `myline78@gmail.com` — **admin** على Railway/Electron |
| العميل | Electron → `https://web-cost-app-production.up.railway.app` |
| المشكلة (سابقًا) | «فشل تحميل المشاريع» — admin لا يرى المشاريع في Inventory / Projects |
| السبب | `useUserAccessScope` كان يعتمد Firebase؛ password login بدون Firebase user → role=`user` |
| الإصلاح | `useUserAccessScope.ts` + `Projects.tsx` toasts + `auth/login` session.save |
| Commit | `0332d1f` fix(auth): improve session handling during login (+ scope fix) |

---

## مراجع HANDOFF

- **`CLAUDE.md`** → *HANDOFF — Admin projects + password login scope ✅ (2026-06-26)*
- **`CONTEXT.md`** §16 — Electron password login rules

---

## golden path (Electron admin)

1. Password login as admin
2. **Projects** — قائمة المشاريع تُحمَّل (أو toast واضح عند خطأ API)
3. **Inventory → مخزن المشروع** — dropdown المشاريع غير فارغ للمدير

---

## ملاحظات

- قائمة فارغة **بدون toast** = Postgres `projects` فارغ على Railway → Push to production أو إنشاء مشروع
- **403** = promote admin على Railway Postgres ثم logout/login
