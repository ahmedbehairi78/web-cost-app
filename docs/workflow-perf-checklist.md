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

- [ ] Profile first (React Profiler); memo only if parent re-renders are costly.

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
- [ ] If Firebase console reports missing index → add to `firestore.indexes.json` and deploy indexes before prod reliance.

### C2 — Indexes & deploy

- [ ] Deploy: `firebase deploy --only firestore:indexes` (when using composite queries).
- [ ] Test **empty**, **small**, and **large** datasets if possible.

### C3 — Optional: shared hook

- [ ] Introduce `useFirestoreQuery`-style helper on **one** screen first (e.g. Dashboard).
- [ ] Migrate other screens in separate PRs.

**Commit suggestion:** one commit per query or hook introduction.

**Rollback:** Revert query change — Firestore documents unchanged.

---

## Phase D — UX polish

### D1 — Focus visibility

- [ ] Add `:focus-visible` styles for sidebar, window controls, taskbar buttons.
- [ ] Keyboard-only smoke test through main flows.

### D2 — Scrollbars & theme consistency

- [ ] Ensure scrollbars match **light / soft** (no dark thumb on light background).
- [ ] Check portals: toasts/modals inherit active theme where applicable.

### D3 — `SearchableSelect` behavior

- [ ] Adjust or remove auto-select when a single filtered result remains (e.g. only on **Enter** or explicit confirm).
- [ ] Manual test: partial typing should not unexpectedly change selection.

---

## Phase E — Optional / later

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
