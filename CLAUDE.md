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

### Accounting — Account Codes

Account codes are defined in `AccountCodes` enum in `src/services/accountingService.ts`. **Always use the enum constants, never hardcode strings.**

| Constant | Code | Description |
|----------|------|-------------|
| `BANK` | 1111 | البنك |
| `RECEIVABLES` | 1121 | العملاء - مستخلصات تحت التحصيل |
| `RETENTION_GUARANTEE` | 1122 | محتجزات الضمان |
| `REVENUE` | 4111 | إيرادات عقود المقاولات |
| `EXPENSE_MATERIALS` | 5111 | مواد البناء |
| `EXPENSE_LABOUR` | 5112 | عمالة مباشرة |

- Revenue accounts start with `4`, expense accounts start with `5`.
- Collection transactions: debit `BANK (1111)` + credit `RECEIVABLES (1121)`.

### Permissions

- `ALL_PERMISSIONS` — full access (admins only).
- `DEFAULT_PERMISSIONS` — `dashboard: true` only; assigned to new users with no pre-registration. Admin must grant further access via Settings.
- Pre-registered users: admin creates a doc in `user_permissions/{email}` before first login.

### Date Handling

Use `normalizeDate(date)` from `src/lib/utils.ts` whenever reading a date field from Firestore — it handles `string | Date | Timestamp` uniformly and returns `YYYY-MM-DD`. Only convert to a locale string at display time.

### Contracts as Cost Centers

`transactions.costCenterId` stores the contract ID for IPC, purchase invoices, and custody settlements. Use this field to filter GL data by contract. Reports module exposes a contract selector that appears automatically when a project with multiple contracts is selected.

## Workflow

```
feature branch → PR → /review → merge to main
```

- Always run `npm run lint` before committing
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
