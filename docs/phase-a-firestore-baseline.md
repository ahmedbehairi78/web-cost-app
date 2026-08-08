# Phase A Firestore Baseline (Before/After)

This document closes Phase A with concrete Firestore cost indicators from the current codebase.

## Scope

- Module: `ActualCosts`
- Module: `Reports`
- Focus: listener concurrency, capped reads, and role-scope enforcement impact

## Measurement Method

Static baseline from source code (listener/query structure):

- Count realtime listeners (`onSnapshot`) per screen lifecycle.
- Count one-shot reads (`getDocs`) used for reference data.
- Record explicit query caps (`limit(...)` constants).
- Verify build and lint after changes.

Commands used:

- `rg "onSnapshot\\(|getDocs\\(" src/components/ActualCosts.tsx`
- `rg "onSnapshot\\(|getDocs\\(" src/components/Reports.tsx`
- `npm run build`
- `ReadLints` on touched files

## Before vs After (Phase A)

### 1) `ActualCosts`

| Metric | Before Phase A | After Phase A | Delta |
|---|---:|---:|---:|
| Always-on realtime listeners | 7 | 1 active tab listener (`invoice/ipc`) or 1 (`custody`) | ~86% fewer concurrent listeners |
| Realtime listener: purchase tx | On | On (tab-scoped) | Scoped by tab |
| Realtime listener: GL tx | On | On only in `custody` | Deferred until needed |
| Reference datasets | Realtime listeners | One-shot `getDocs` | No continuous sync cost |
| Purchase cap | 2500 | 2500 | unchanged |
| GL screen cap | 4500 | 4500 | unchanged |

Notes:

- Before: all of `suppliers/projects/contracts/chart_of_accounts/boq_items` were live listeners.
- After: those became one-shot loads; only workload-critical streams remain realtime.

### 2) `Reports`

| Metric | Before Phase A | After Phase A | Delta |
|---|---:|---:|---:|
| Realtime listeners in source | 8 | 2 (`billings`, `transactions`) | 75% reduction in listener definitions |
| Concurrent listeners (overview/income/budget) | 8 | 2 | 75% fewer active listeners |
| Concurrent listeners (trial/balance) | 8 | 1 | 87.5% fewer active listeners |
| Concurrent listeners (time) | 8 | 1 | 87.5% fewer active listeners |
| One-shot reference reads (`getDocs`) | 0 | 4 (`projects/contracts/chart_of_accounts/boq_items`) | shifted static data off realtime |
| Read scope for `project_accountant` | Broad UI-level filtering | Role + contract/project scoped in app model and rules | Security scope tightened |

Notes:

- `actual_costs` and `purchase_transactions` realtime listeners were removed from `Reports`.
- `billings` and `transactions` listeners now run conditionally by active report tab.
- Reference collections were converted from realtime listeners to one-shot reads.

## Security Enforcement Added in Phase A

Firestore Rules now enforce role/scope gates for `project_accountant`:

- `assignedContractIds`
- `assignedProjectIds`
- `hasAssignedContract(...)`
- `hasAssignedProject(...)`

Applied to reads/writes on key collections:

- `projects`, `contracts`, `boq_items`
- `actual_costs`, `purchase_transactions`
- `billing`, `ipc_progress`, `transactions`

## Build & Lint Validation

- Build: `npm run build` passed.
- Lint diagnostics on touched files: no blocking errors.

## Runtime Tracking Template (for monthly comparison)

Use this table in each release to compare Firestore cost trend:

| Date | Module | Role | Screen Path | Listener Count | Query Caps Used | Estimated Doc Window | Notes |
|---|---|---|---|---:|---|---:|---|
| YYYY-MM-DD | ActualCosts | project_accountant | invoice tab open | 1 | purchase:2500 | 2500 | |
| YYYY-MM-DD | ActualCosts | project_accountant | custody tab open | 1 | gl:4500 | 4500 | |
| YYYY-MM-DD | Reports | projects_manager | overview/income/budget | 2 | transactions:10000 | varies | billings + transactions only |
| YYYY-MM-DD | Reports | projects_manager | trial/balance | 1 | transactions:10000 | varies | transactions only |
| YYYY-MM-DD | Reports | projects_manager | time | 1 | no tx cap used | varies | billings only |

## Phase A Closure

Phase A close criteria satisfied for:

- Permission-key alignment
- Role model expansion (`admin/projects_manager/project_accountant/user`)
- Contract/project scope implementation in app model and security rules
- Initial Firestore baseline documented with before/after indicators
