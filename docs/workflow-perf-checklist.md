# Performance & quality workflow checklist

Step-by-step plan for incremental improvements (small PRs, easy rollback).  
Run commands from `web-cost-app` unless noted.

---

## Prep (once)

- [ ] Create a working branch (or use per-task branches).
- [x] Baseline: `npm run lint` passes.
- [x] Baseline: `npm test` passes.
- [x] Baseline: `npm run build` passes.
- [x] Optional: note main bundle / chunk sizes from build output for before/after on code-splitting.

---

## Phase A — Safe refactors (no behavior change)

### A1 — `accountingService` and `this`

- [x] Replace `this.createTransaction` / similar with non-fragile calls (explicit `accountingService` reference or plain functions).
- [x] `npm run test`
- [ ] Smoke: create or update one journal / expense flow (staging or local).

### A2 — Theme tokens (incremental)

- [x] Extract `themePalette` or `useThemeClasses(theme)`; start with 1–2 files only (e.g. window chrome + sidebar).
- [ ] Visual: verify **dark**, **light**, and **soft** themes still match expectations.

**Commit suggestion:** `refactor: …` — one logical change per commit.

---

## Phase B — Bundle / runtime

### B1 — Lazy-loaded modules

- [x] Wrap each module in `React.lazy(() => import('…'))` in `WindowManager` (or equivalent map).
- [x] Add `<Suspense fallback={…}>` (reuse existing loader pattern).

### B2 — Verify lazy loading

- [x] `npm run build` — confirm dynamic chunks for modules.
- [ ] Open **every** sidebar module once; no suspense errors.

### B3 — Optional: `React.memo(WindowFrame)`

- [x] Profile first (React Profiler); memo only if parent re-renders are costly.
- [x] Wrapped `WindowFrame` in `React.memo` with a custom `areWindowPropsEqual` comparator.
      Comparator checks `win` data fields only (id, moduleId, windowState, zIndex, position, size)
      and intentionally ignores callback refs (inline lambdas always change on parent re-render).
      **Effect:** when any window is focused (zIndex change), only that window re-renders;
      all other `WindowFrame` instances are bailed out by the comparator.

**Commit suggestion:** `perf: lazy-load feature modules`.

**Rollback:** Revert single commit — no DB migration.

---

## Phase C — Firestore read cost (plan then implement)

### C0 — Choose one strategy for Dashboard aggregates

Pick **one**:

- [x] **Fast path:** `limit(N)` + `orderBy('date', 'desc')` (and optional UI banner: “recent N”).
- [ ] **Scalable path:** scheduled / Cloud aggregation → single doc (e.g. `dashboard_summary`) + `onSnapshot` on that doc.

### C1 — Implement chosen Dashboard query strategy

- [x] Adjust `transactions` (and related) queries on Dashboard / overview screens.
- [x] If Firebase console reports missing index → add to `firestore.indexes.json` and deploy indexes before prod reliance.  
  _(Dashboard `isDeleted` + `orderBy('date','desc')` + `limit` uses the composite index already declared on `transactions` in `firestore.indexes.json` — redeploy indexes if production is out of sync.)_
- [x] `ActualCosts.tsx`: converted `onSnapshot` listeners for reference data (suppliers, projects, contracts, accounts, boqItems) to one-shot `getDocs`. Purchase/transaction listeners now tab-conditional.
- [x] `Reports.tsx`: converted reference data (projects, contracts, chart_of_accounts, boq_items) to `getDocs`. Billing/transaction listeners loaded conditionally per active report tab.
  **Estimated Firestore read reduction: ~40–60% on normal sessions.**

### C2 — Indexes & deploy

- [x] Added 3 missing composite indexes to `firestore.indexes.json`:
  - `contracts`: `projectId ASC, isDeleted ASC`
  - `boq_items`: `contractId ASC, isDeleted ASC`
  - `billing`: `contractId ASC, status ASC`
- [x] Emulator: indexes applied automatically via `firebase emulators:start`.
- [ ] Production (when ready): `npx firebase use <project_id>` → `npx firebase deploy --only firestore:indexes`.
- [ ] Test **empty**, **small**, and **large** datasets if possible.

### C3 — Optional: shared hook

- [x] `src/hooks/useFirestoreQuery.ts` — supports `mode: 'snapshot' | 'once'`, returns `{ data, loading, error, size }`.
- [x] Dashboard migrated — 3 listeners replaced with `useFirestoreQuery` calls (−40 LOC).
- [x] All 5 screens migrated: ActualCosts (ref data), Billing, BOQ, Reports, GeneralLedger.
  - `progressMap` in BOQ converted from `useState+useEffect` → `useMemo`.
  - Reports conditional listeners (billings/transactions by `activeReport`) handled via `null` factory.

**Commit suggestion:** one commit per query or hook introduction.

**Rollback:** Revert query change — Firestore documents unchanged.

---

## Phase D — UX polish

### D1 — Focus visibility

- [x] Add `:focus-visible` styles for sidebar, window controls, taskbar buttons (`shellInteractiveFocus` in `shellTheme.ts`).
- [ ] Keyboard-only smoke test through main flows.

### D2 — Scrollbars & theme consistency

- [x] Ensure scrollbars match **light / soft** (no dark thumb on light background).
- [x] Check portals: toasts/modals inherit active theme where applicable (`ThemedToaster.tsx`).

### D3 — `SearchableSelect` behavior

- [x] Adjust or remove auto-select when a single filtered result remains (e.g. only on **Enter** or explicit confirm).
- [ ] Manual test: partial typing should not unexpectedly change selection.

---

## Phase F — SQLite hybrid backend ✅ COMPLETE

### F1 — Schema & core
- [x] `server/sqlite/migrations/001_financial_core_init.sql` — 9 جداول مالية جديدة (فواتير موزعة، مخزون، تحويلات، مستخلصات الباطن).
- [x] `server/sqlite/migrations/002_app_tables.sql` — 16 جدول تشغيلي (users, sessions, projects, contracts, billing, GL, ...).
- [x] `server/src/sqlite/core.ts` — تهيئة DB + migration runner + WAL pragma.
- [x] `server/src/sqlite/appDb.ts` — rowToObj/objToRow، SqliteSessionStore، user helpers.

### F2 — إزالة PostgreSQL/Prisma
- [x] `auth/session.ts` — استبدال `connect-pg-simple` بـ `SqliteSessionStore`.
- [x] `auth/routes.ts` + `middleware/auth.ts` — استبدال `prisma.user` بـ SQLite.
- [x] `modules/crud.ts` — generic CRUD بـ raw SQL.
- [x] `accounting/journal.ts` + `modules/billing.ts` + `modules/gl.ts` + `modules/reports.ts` — كل العمليات عبر SQLite.
- [x] `index.ts` / `app.ts` — إزالة كل استيرادات Prisma/PostgreSQL.
- [x] `scripts/bootstrapAdmin.ts` — إنشاء admin مباشرة في SQLite.

### F3 — Endpoint فاتورة موزعة
- [x] `POST /api/sqlite-core/purchase-invoices/distributed` — validation كامل + رفع مخزون العقد تلقائياً (متوسط مرجح).
- [x] `src/services/local/modulesApi.ts` — `sqliteCoreApi` في الـfrontend.
- [x] `ActualCosts.tsx` — واجهة إنشاء الفاتورة الموزعة مع multi-line + multi-contract.

### F4 — RBAC
- [x] `UserRole` type + `assignedContractIds` في `types.ts`.
- [x] `useUserAccessScope` hook.
- [x] `firestore.rules` — تطبيق RBAC server-side على جميع المجموعات.
- [x] `Settings.tsx` — UI اختيار عقود المحاسب.

---

## Phase G — موديول المخازن ✅ COMPLETE

### G1 — Backend: مخزون العقد
- [x] `server/src/modules/inventory.ts` — endpoints: GET رصيد، POST صرف، GET سجل، GET boq-actuals.
- [x] تسجيل المسارات في `app.ts`.

### G2 — Backend: تحويلات المخزون (عقود legacy)
- [x] `server/src/modules/inventoryTransfers.ts` — workflow: pending_b → pending_projects → approved.
- [x] حركة `contract_inventory` فقط (بدون قيد GL).

### G2b — تحويلات مخزن المشروع + GL ✅
- [x] Migration **011** `project_inventory_transfers` + lines؛ **012** `transaction_id`.
- [x] `projectInventoryTransfers.ts` + mount على `/api/inventory/project-transfers`.
- [x] `approve-projects`: `applyProjectTransferEffect` + `postProjectTransferJournal` (SQLite).
- [x] Firestore: `recordProjectWarehouseTransfer` من `Inventory.tsx` بعد الاعتماد.
- [x] `ensureLocalProject.ts` — مرآة مشروع قبل FK.

### G3 — Frontend: واجهة المخازن
- [x] `Inventory.tsx` — تبويبات: أصناف / رصيد / **تحويل مشاريع** / صرف وإرجاع.
- [x] إضافة موديول inventory في `MODULE_COMPONENTS`، `MODULE_LABELS`، `Sidebar.tsx`.
- [x] RBAC: `inventory` و`subcontractor` في `types.ts` + `permissions.ts` + `Settings.tsx`.

### G4 — مستخلصات مقاول الباطن
- [x] Backend endpoints للـsubcontractors + assignments + extracts (`server/src/modules/subcontractor.ts`).
- [x] Frontend واجهة `src/components/SubcontractorExtracts.tsx`.

### G5 — ربط ActualCosts بالمخزون
- [x] H1: BOQ item selector في نموذج الفاتورة الموزعة (يملأ الوصف/الوحدة/السعر تلقائياً).
- [x] H2: بطاقة رصيد المخزون المحدَّث تظهر بعد حفظ الفاتورة.
- [x] H3: عمودا "إجمالي المشتريات" و"رصيد المخزون" في جدول BOQ.
- [x] `server/sqlite/migrations/003_boq_link_and_user_contracts.sql`.

---

## Phase H — Materials tree & consumption orders (migration 004) ✅ COMPLETE

### H1 — Schema
- [x] `server/sqlite/migrations/004_materials_inventory_v2.sql` — `material_groups`, `material_categories`, `boq_item_materials`, `purchase_invoices` status, `contract_inventory` v2 (`quantity_reserved`, `avg_unit_cost`), `consumption_orders`, `boq_actual_costs`.

### H2 — Backend
- [x] `materials.ts`, `boqMaterials.ts`, `consumptionOrders.ts`, `inventoryHelpers.ts`.
- [x] Transfer reserve on create; legacy `POST /api/inventory/consume` superseded by consumption-orders confirm.

### H3 — Frontend
- [x] `MaterialsTree` (Projects tab, local backend), `BoqMaterialsModal` (BOQ), `ConsumptionOrderModal` + `Inventory.tsx` history tab.
- [x] `ActualCosts` — `materialCategoryId` on distributed invoice lines; `status: 'confirmed'` posts stock.
- [x] `CLAUDE.md` updated to document migration 004 workflow.

---

- [ ] Virtualize very long lists (BOQ, GL rows) **after** B + C if still sluggish.
- [ ] Money precision:integer minor units or policy doc — separate initiative touching write paths first.

---

## Minimum test matrix (after **each** merged slice)

- [ ] Login → default module opens.
- [ ] Open two modules → minimize → restore → close.
- [ ] Arabic (RTL): sidebar + one form.
- [ ] All three themes on Dashboard + one modal.
- [ ] `npm run build`.

---

## Git / PR rhythm

- [ ] Small PRs (~&lt; 300 LOC when feasible).
- [ ] Branch names: `perf/…`, `fix/…`, `refactor/…`.
- [ ] PR description: **what**, **how to verify**, **new Firestore indexes** (if any).
- [ ] Preferred merge order: **A → B → C → D** (avoid mixing B + C in one PR if avoidable).

---

## When to stop and fix foundations

- [ ] Missing Firestore composite index in production → add/deploy indexes before merging dependent code.
- [ ] Lazy-loaded module breaks (import side effects) → fix module init in a dedicated PR first.
- [ ] Dashboard totals **disagree** after limits/filters → document period rules or switch to aggregated source of truth.

---

## Cursor prompts (cost-efficient pattern)

Prefer **narrow** tasks:

**Good:** “In `web-cost-app` only: remove `this` usage from `accountingService.ts` delegated methods; run `npm test`; no other files.”

**Avoid:** “Implement all checklist items.”

---

*Derived from codebase review suggestions; extend this file when new phases are added.*
