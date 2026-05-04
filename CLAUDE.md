# Project: Web Cost App

Construction cost management system built with React + TypeScript + Firebase (Firestore + Auth).

## Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Vite 6
- **Backend**: Firebase Firestore (NoSQL), Firebase Auth (Google sign-in)
- **UI libs**: lucide-react, motion/react, recharts
- **Export**: xlsx, html2pdf.js, jspdf

## Commands

```bash
npm run dev       # Start dev server on :3000 (hits production Firestore)
npm run emulate   # Start dev server using local Firebase emulators
npm run lint      # Type-check only (tsc --noEmit)
npm run build     # Production build
firebase deploy --only firestore:indexes   # Deploy composite indexes
firebase deploy --only firestore:rules     # Deploy security rules
firebase emulators:start                   # Start local emulators (Auth :9099, Firestore :8080, UI :4000)
```

## Architecture

### Key Files

| File | Purpose |
|------|---------|
| `src/firebase.ts` | Firebase init (offline persistence), emulator wiring, `handleFirestoreError` |
| `src/services/accountingService.ts` | GL journal entries, IPC recording, Chart of Accounts seeding |
| `src/context/LanguageContext.tsx` | i18n (ar/en) + theme (dark/soft/light) — all UI strings must have both variants |
| `src/lib/utils.ts` | `cn()` for class merging, `normalizeDate()` for date normalization |
| `src/types.ts` | Shared types: `UserPermissions`, `ALL_PERMISSIONS`, `DEFAULT_PERMISSIONS` |
| `firestore.rules` | Security rules |
| `firestore.indexes.json` | Composite indexes for all `where + orderBy` queries |

### Components

| Component | Firestore Collections |
|-----------|----------------------|
| `Projects.tsx` | `projects` |
| `BOQ.tsx` | `boq_items`, `contracts`, `billing` (progress) |
| `Billing.tsx` | `billing`, `boq_items`, `contracts` |
| `GeneralLedger.tsx` | `transactions`, `chart_of_accounts`, `contracts`, `projects` |
| `Purchases.tsx` | `purchase_transactions`, `suppliers` |
| `Reports.tsx` | reads all collections + `contracts` for contract filter |
| `Settings.tsx` | `settings/company_info`, `chart_of_accounts` |
| `Dashboard.tsx` | `projects`, `transactions`, `boq_items` |

### Data Integrity Rules

- **Billing → GL**: Every non-draft IPC write goes through `accountingService.recordIPC()` which creates/updates a `transactions` doc and stores its ID as `billing.transactionId`.
- **Draft revert**: Uses `writeBatch` to atomically soft-delete the GL entry and clear `transactionId` on the billing doc in one operation (`Billing.tsx`).
- **Supplier creation**: Uses `writeBatch` to atomically create the supplier doc and its `chart_of_accounts` entry in one operation (`Purchases.tsx → handleSaveSupplier`).
- **Soft deletes**: All deletions set `isDeleted: true`. Never hard-delete.
- **BOQ progress**: Derived from `billing` docs with `status IN ['submitted','approved','paid']`. Filtered via `useMemo` to exclude phantom entries from deleted BOQ items.
- **Batched Writes rule**: Any operation that writes to more than one collection must use `writeBatch` to guarantee atomicity.
- **projectId vs costCenterId**: On `transactions`, `costCenterId` = contract ID and `projectId` = actual project ID. Never set `projectId` to a contract ID. In `GLJournalEntries`, derive `projectId` from `contracts.find(c => c.id === costCenterId)?.projectId`.
- **Budget alert**: `Purchases.tsx` computes `boqBudgetByContract` and `spentByContract` via `useMemo` (no extra Firestore reads). A yellow warning banner appears when `spent + newAmount > BOQ budget` for the selected contract — non-blocking, user can still save.
- **Dashboard collection split**: `Dashboard.tsx` distinguishes two types of cash inflows. `totalCollected` (shown in التحصيلات النقدية card) includes both IPC collections (`RECEIVABLES` credit) and advance payments (`ADVANCE_PAYMENT` credit). `ipcCollected` tracks only IPC receipts. `pendingBilling = totalRevenue - ipcCollected` — advance payments must NOT reduce pending billing because they are a liability, not a reduction of IPC receivables. Cash/bank detection uses `startsWith('121')` to cover all banks (`12101xxx`) and cash funds (`12102xxx`).
- **Sub-account shortcut**: In `GLChartOfAccounts.tsx`, hovering a row shows a green `+` button. Clicking it opens `AccountModal` with `defaultParentCode` and `defaultType` pre-filled from the parent account, so the user doesn't have to select the parent manually.

### Accounting — Account Codes

Account codes are defined in `AccountCodes` enum in `src/services/accountingService.ts`. **Always use the enum constants, never hardcode strings.**

The chart of accounts uses **5 levels**. Only level-5 accounts (8-digit codes) are used in actual journal entries. Levels 1–4 are group accounts (`isGroup: true`).

| Constant | Code | Description |
|----------|------|-------------|
| `BANK` | 11101001 | البنك التجاري الدولي |
| `CASH` | 11102001 | عهدة نقدية |
| `RECEIVABLES` | 11201001 | العملاء - مستخلصات تحت التحصيل |
| `RETENTION_GUARANTEE` | 11202001 | محتجزات الضمان - عملاء |
| `ADVANCE_TO_SUPPLIERS` | 11301001 | مقدمات للموردين |
| `ADVANCE_TO_SUBCONTRACTORS` | 11302001 | مقدمات لمقاولي الباطن |
| `VAT_INPUT` | 11401001 | ضريبة القيمة المضافة - مدخلات (مشتريات) |
| `WHT_RECEIVABLE` | 11401002 | ضريبة الخصم والإضافة - مدين (محتجز من العميل) |
| `SOCIAL_INSURANCE_RECEIVABLE` | 11402001 | التأمينات الاجتماعية - مدين |
| `MANPOWER_LEVY_RECEIVABLE` | 11403001 | القوى العاملة - مدين |
| `SUPPLIERS` | 21101001 | الموردون |
| `SUBCONTRACTORS` | 21102001 | مقاولو الباطن |
| `RETENTION_PAYABLE` | 21201001 | محتجزات الضمان - مقاولون |
| `ADVANCE_PAYMENT` | 21301001 | دفعات مقدمة من العملاء (خصم — liability) |
| `VAT_OUTPUT` | 21401001 | ضريبة القيمة المضافة - مخرجات (إيرادات) |
| `WHT_PAYABLE` | 21402001 | مصلحة الضرائب - خصم وإضافة (دائن) |
| `SOCIAL_INSURANCE_PAYABLE` | 21403001 | التأمينات الاجتماعية - دائن |
| `MANPOWER_LEVY_PAYABLE` | 21404001 | القوى العاملة - دائن |
| `REVENUE` | 41101001 | إيرادات عقود المقاولات |
| `EXPENSE_MATERIALS` | 51101001 | مواد البناء |
| `EXPENSE_LABOUR` | 51102001 | عمالة مباشرة |
| `EXPENSE_SUBCONTRACTOR` | 51103001 | مقاولو الباطن - تكاليف |
| `EXPENSE_EQUIPMENT` | 51104001 | معدات وآلات |
| `EXPENSE_ADMIN` | 52101001 | رواتب وأجور إدارية |
| `BANK_CHARGES` | 53102001 | رسوم بنكية |

**قواعد مهمة:**
- Revenue accounts start with `4`, expense accounts start with `5`.
- Current assets (cash, receivables, prepayments, tax receivables) are under prefix `11xxxx`. Cash & bank accounts are `111xxxxx` (banks = `11101xxx`, cash funds = `11102xxx`).
- Non-current assets (fixed assets, accumulated depreciation, WIP) are under prefix `12xxxx`.
- VAT و WHT والتأمينات والقوى العاملة **مقسّمة** إلى كودين: مدين (أصل تحت `114`) ودائن (خصم تحت `214`). استخدم الكود الصحيح بحسب جهة القيد.
- IPC collection transactions: debit `BANK (11101001)` + credit `RECEIVABLES (11201001)`.
- Advance payment received: debit `BANK (11101001)` + credit `ADVANCE_PAYMENT (21301001)`.
- **Dashboard cash/bank detection**: uses `startsWith('111')` to cover all banks and cash funds — never `startsWith('12')`.
- **Account code migration**: `src/services/migrateAccountCodes.ts` contains `migrateAccountCodes()` — run once from Settings → Database to fix existing transactions that used the old `12xxxxxx` asset codes.
- ملف الـ seed الكامل لشجرة الحسابات (5 مستويات): `src/data/chartOfAccountsSeed.ts`. يحتوي على `seedChartOfAccounts()` لتهيئة Firestore.

### Permissions

- `ALL_PERMISSIONS` — full access (admins only).
- `DEFAULT_PERMISSIONS` — `dashboard: true` only; assigned to new users with no pre-registration. Admin must grant further access via Settings.
- Pre-registered users: admin creates a doc in `user_permissions/{email}` before first login.

### Date Handling

Use `normalizeDate(date)` from `src/lib/utils.ts` whenever reading a date field from Firestore — it handles `string | Date | Timestamp` uniformly and returns `YYYY-MM-DD`. Only convert to a locale string at display time.

### Contracts as Cost Centers

`transactions.costCenterId` stores the contract ID for IPC, purchase invoices, and custody settlements. Use this field to filter GL data by contract. Reports module exposes a contract selector that appears automatically when a project with multiple contracts is selected.

## Coding Rules (enforced from review)

### React Hooks
- All `useState` / `useRef` / `useMemo` / `useCallback` declarations must appear at the **top** of the component, before any function definitions. Never declare a hook after code that references its setter.
- Every `useEffect` that opens a Firestore listener must **return a cleanup** that calls all unsubscribe functions. Never leave a listener open on unmount.
- Every `onSnapshot(query, callback)` must include an **error callback** as the third argument:
  ```ts
  onSnapshot(q, (snap) => { ... }, (err) => handleFirestoreError(err, OperationType.READ, 'collection'));
  ```
- Never call `handleEntryChange` twice from the same `onChange` handler (React stale-closure batching drops the first call). Handle related side-effects inside `handleEntryChange` itself.

### Financial Precision
- Journal balance tolerance is `0.005` (half-piastre). Do not loosen it.
- All IPC percentage back-calculations must guard against `worksValueExVat === 0` using a safe division helper — never divide directly and rely on `|| fallback` (which misses `NaN`):
  ```ts
  const safePct = (num: number, denom: number, fallback: number) =>
    denom > 0 ? (num / denom) * 100 : fallback;
  ```
- Billing default rates are in `src/constants/billingDefaults.ts` (`BILLING_DEFAULTS`). Never hardcode `14`, `10`, `1`, `5`, or `0.03` inline.

### Account Code Generation
- Supplier `chart_of_accounts` entries must use **8-digit sequential codes** under `parentCode: '21101'` (e.g. `21101002`, `21101003`…). Never use `Math.random()` to generate account codes — it produces duplicate and non-compliant codes.
- Every `chart_of_accounts` entry created for a supplier must include a `supplierId` field linking back to the supplier doc.
- Always use `AccountCodes` enum constants — never hardcode account code strings.

### Soft Deletes & Batching
- All deletions must use `isDeleted: true` (soft delete). Never call `deleteDoc()` directly on user data.
- Bulk soft-deletes (e.g. clear BOQ) must use `writeBatch`, chunked at 500 ops. Never use `Promise.all(docs.map(deleteDoc))`.
- Any operation writing to more than one collection must use `writeBatch`.

### Authentication Guard
- Before any Firestore write in `accountingService.ts`, assert `auth.currentUser` is not null. Throw immediately if the session has expired — do not silently write `undefined` to `createdBy`.

### Type Safety
- Never use `any` in hot-path loops (transaction/entry iterations in `Dashboard.tsx`). Use `Transaction` and `JournalEntry` types from `src/types.ts`.
- `createdAt` fields in Firestore docs must be typed as `Timestamp | Date | string`, not `any`.

### i18n
- No hardcoded Arabic or English strings in JSX. Always use `t('key')` from `useLanguage()`.
- No inline `language === 'ar' ? '...' : '...'` ternaries for translatable text. Move to translation maps.
- Locale string (e.g. `'ar-EG'`) must come from `LanguageContext` (`locale` field) — never hardcoded.
- `LanguageContext` must log `console.warn` for missing translation keys in dev (never silently return the raw key in production).

### Performance
- Expensive derived values (chart data, maps, totals) must be in `useMemo`. `onSnapshot` callbacks should only call `setState` — no computation inside.
- `contractsMap` and `projectsMap` in `GeneralLedger.tsx` must be wrapped in `useMemo`.
- `useCallback` is required for event handlers passed to table row components to prevent full-table re-renders.

### Firebase Config
- Validate all required `VITE_*` environment variables at startup in `firebase.ts`. Throw a clear error immediately if any are missing.

---

---

## Workflow

```
feature branch → PR → /review → merge to main
```

- Always run `npm run lint` before committing
- After each phase of the fix plan, test golden paths: create IPC, create purchase invoice, clear BOQ, open Dashboard
- Firestore index changes require `firebase deploy --only firestore:indexes`
- Use `npm run emulate` for local dev to avoid touching production data

## Firebase Emulators

Set `VITE_USE_EMULATORS=true` (done automatically by `npm run emulate`) to connect the app to local emulators instead of production. Emulator UI is at http://localhost:4000.

## Offline Persistence

Firestore offline persistence is enabled in production via `initializeFirestore` with `persistentLocalCache + persistentMultipleTabManager` in `src/firebase.ts`. This allows users to review cached data during connectivity loss.

- **Emulators**: persistence is intentionally disabled (emulators don't support IndexedDB) — `getFirestore` is used instead when `VITE_USE_EMULATORS=true`.
- **Multi-tab**: supported — all open tabs share the same IndexedDB cache.

## Fiscal Year Filter

`GeneralLedger.tsx` holds a `fiscalYear` state (default: current year). The transactions Firestore query uses `where('date', '>=', '{year}-01-01')` + `where('date', '<=', '{year}-12-31')` to scope all loaded entries to the selected year. Changing the year resets `transactionLimit` to 50. The year selector UI lives in `GLJournalEntries.tsx` header. The existing `(isDeleted ASC, date DESC)` composite index covers this query — no new index needed.

## Known Constraints

- All `where(...) + orderBy(...)` combos require composite indexes — see `firestore.indexes.json`. Adding a new `orderBy` without a matching index will throw at runtime.
- `firestoreDatabaseId` in `firebase-applet-config.json` targets a named (non-default) Firestore database.
- Arabic (`ar`) is the primary language; all UI strings must use `t('key')` from `useLanguage()` — never hardcode Arabic/English text in JSX.
- `boq_items` and `contracts` collections use `isDeleted != true` (inequality) rather than `== false` — keep consistent to avoid index conflicts.
- `GeneralLedger.tsx` uses paginated transaction loading (`limit(transactionLimit)` + "Load More"). Do not remove this pattern.
- **Journal entry `SearchableSelect` onChange**: Never call `handleEntryChange` twice from the same `onChange` handler — React batches both updates from the same stale closure and the second call wins, silently dropping the first field's value. Instead, make `handleEntryChange` handle related field side-effects internally (e.g., auto-fill `accountName` when `accountCode` changes).
