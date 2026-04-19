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
| `src/firebase.ts` | Firebase init, emulator wiring, `handleFirestoreError` |
| `src/services/accountingService.ts` | GL journal entries, IPC recording, Chart of Accounts seeding |
| `src/context/LanguageContext.tsx` | i18n (ar/en) + theme (dark/soft/light) |
| `firestore.rules` | Security rules |
| `firestore.indexes.json` | Composite indexes for all `where + orderBy` queries |

### Components

| Component | Firestore Collections |
|-----------|----------------------|
| `Projects.tsx` | `projects` |
| `BOQ.tsx` | `boq_items`, `contracts`, `billing` (progress) |
| `Billing.tsx` | `billing`, `boq_items`, `contracts` |
| `GeneralLedger.tsx` | `transactions`, `chart_of_accounts` |
| `Purchases.tsx` | `purchase_transactions`, `suppliers` |
| `Reports.tsx` | reads all collections |
| `Settings.tsx` | `settings/company_info`, `chart_of_accounts` |

### Data Integrity Rules

- **Billing → GL**: Every non-draft IPC write goes through `accountingService.recordIPC()` which creates/updates a `transactions` doc and stores its ID as `billing.transactionId`.
- **Draft revert**: Uses `writeBatch` to atomically soft-delete the GL entry and clear `transactionId` on the billing doc in one operation.
- **Soft deletes**: All deletions set `isDeleted: true`. Never hard-delete.
- **BOQ progress**: Derived from `billing` docs with `status IN ['submitted','approved','paid']`. Filtered via `useMemo` to exclude phantom entries from deleted BOQ items.

## Workflow

```
feature branch → PR → /review → merge to main
```

- Always run `npm run lint` before committing
- Firestore index changes require `firebase deploy --only firestore:indexes`
- Use `npm run emulate` for local dev to avoid touching production data

## Firebase Emulators

Set `VITE_USE_EMULATORS=true` (done automatically by `npm run emulate`) to connect the app to local emulators instead of production. Emulator UI is at http://localhost:4000.

## Known Constraints

- All `where(...) + orderBy(...)` combos require composite indexes — see `firestore.indexes.json`
- `firestoreDatabaseId` in `firebase-applet-config.json` targets a named (non-default) Firestore database
- Arabic (`ar`) is the primary language; all UI strings must have both `ar` and `en` variants
