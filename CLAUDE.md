# Project: Web Cost App

> **Doc workflow:** Before fixes/improvements, read **`CLAUDE.md`** · **`CONTEXT.md`** · **`DEPLOYMENT_PLAN.md`** · **`docs/DEVELOPER_GUIDE.md`**. After successful implementation, update those files in the same session.

Construction cost management system built with React + TypeScript + Firebase (Firestore + Auth), with a hybrid local SQLite backend for financial core operations.

## Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Vite 6
- **Cloud data**: Firebase Firestore (operational data), Firebase Auth (Google sign-in)
- **Local backend (`VITE_DATA_BACKEND=local`)**: Express (TypeScript) + **PostgreSQL** via Prisma — مصدر الحقيقة لكل البيانات (تشغيلية + نواة مالية)
- **Cloud legacy**: Firebase Firestore (operational data) — يُستخدم فقط عندما `VITE_DATA_BACKEND` غير مضبوط
- **UI libs**: lucide-react, motion/react, recharts
- **Export**: xlsx — PDF عبر منصة `reportDocument` (Chromium `printToPDF` في Electron)

## Commands

From **`web-cost-app/`** (or use the repo-root `package.json` which forwards `--prefix web-cost-app`):

```bash
# Frontend (web-cost-app/)
npm run dev        # Vite dev server — :3000
npm run dev:local  # Vite :3000 + Express :3001 together (preferred for VITE_DATA_BACKEND=local)
npm run lint       # Type-check only (tsc --noEmit)
npm run test       # Vitest
npm run build              # Production build (dev .env)
npm run build:production   # Vite prod build via scripts/generate-vite-env.mjs
npm run build:web          # alias of build:production

# Railway / production API (web-cost-app/)
npm run railway:build      # copy COA seed + prisma generate + tsc (server/tsconfig.build.json)
npm run start:api:prod     # prisma migrate deploy + node dist-server/index.js

# Electron desktop shell (loads WEB_COST_APP_URL or production-url.json or http://localhost:3000)
npm run electron:build:shell   # main.ts (ESM) + preload.ts (CommonJS via tsconfig.preload.json)
npm run electron:dev       # compile shell + electron .
npm run electron:pack      # write-electron-url + Windows NSIS Setup.exe → release/
npm run electron:publish   # pack + GitHub Release (GH_TOKEN, scope repo أو Contents write)

# Data migration (Postgres)
npm run local:migrate
npm run local:backfill-gl          # after migrate — GL from consumption/IPC/cheques (+21 tx typical)
npm run local:verify-postgres
npm run local:promote-google-admin -- <email>   # Railway/local admin (Google sign-in)
npm run local:set-user-role -- <email> project_accountant [--contracts id1,id2]
npm run local:export-firestore-users   # needs FIREBASE_SERVICE_ACCOUNT_*

# Local backend (web-cost-app/server/)
npm run local:api  # Express API — :3001 (required for inventory, materials, distributed invoices)
npm run dev        # Alias in server/ package; prefer dev:local or local:api from web-cost-app root
npm run build      # Compile TypeScript → dist/
npx tsc --noEmit   # Type-check backend only

# Windows desktop shortcut (optional)
npm run desktop:install  # Creates "Web Cost App" on Desktop → scripts/start-app.cmd → dev:local

# Branding (Concord Plus logos — Navy #003B71 · Orange #F58220)
npm run branding:sync    # Regenerate public/branding/*.svg from scripts/sync-branding-svgs.mjs
npm run branding:icons   # branding:sync + PNG exports (desktop-icon, logo-print.png, …)

# Firebase (use npx if firebase CLI not in PATH)
npx firebase-tools deploy --only firestore:indexes --project gen-lang-client-0599011721
npx firebase-tools deploy --only firestore:rules  --project gen-lang-client-0599011721
firebase emulators:start                   # Local emulators (indexes auto-applied from firestore.indexes.json)
# Project ID: gen-lang-client-0599011721  (from firebase-applet-config.json)
```

Parent folder **`../package.json`** (repo root `cost web app/`) proxies `dev` / `dev:local` / `desktop:install` / `build` / `lint` / `test` / `preview` into `web-cost-app/` for convenience when the shell cwd is one level above the app.

**Windows launcher:** `scripts/start-app.cmd` runs `npm run dev:local` and opens the browser when :3000 is ready. Icon: `public/desktop-icon.png` → `scripts/install-desktop-shortcut.ps1` (also `npm run desktop:install`). Shortcut is placed on **local Desktop** and **OneDrive Desktop** when present.

## Architecture

### Key Files

| File | Purpose |
|------|---------|
| `src/firebase.ts` | Firebase init (offline persistence), `handleFirestoreError`; **dev** falls back to `firebase-applet-config.json` when `VITE_*` vars are empty; production/CI requires env |
| `src/services/accountingService.ts` | GL helpers: **`recordPurchaseToProjectInventory`**, **`recordConsumptionIssue`**, **`recordReturnToWarehouse`**, **`recordProjectWarehouseTransfer`** (inter-project 127… transfer); COA cache + `createTransaction()` |
| `src/lib/formatQuantity.ts` | **`formatQuantity(n, language)`** — qty display up to **2** decimals (same as money), **no forced trailing zeros** |
| `src/lib/money.ts` · `server/src/lib/money.ts` | **EGP — 2 decimal places** — `roundMoney()` (`Math.round(n×100)/100`), `MONEY_TOLERANCE = 0.005`, `isMoneyBalanced()`, `formatMoney()` (2 fraction digits). Client: also exposed as **`formatMoney`** on `useLanguage()`. **`roundMoney2`** in `utils.ts` delegates here. **`roundDecimal2`** alias. **Quantities** use the same 2dp via `formatQuantity` / `roundQty` — do not use 3dp milli rounding. Purchase/fixed-asset/inventory journals: **`buildPurchaseWithholdingJournalLines`** — supplier credit = (base+VAT)−WHT after 2dp. |
| `src/context/LanguageContext.tsx` | i18n (ar/en) + theme (dark/soft/light/erp); **`formatMoney(value)`** on context; both persisted to `localStorage` via wrapped `setLanguage`/`setTheme` (init via `readSaved()`); **default fallback theme is `soft`**; `setTheme` syncs to Firestore `users/{uid}.defaultTheme` or local **`user-preferences`** via **`GeneralSettings.tsx`**; on login `App.tsx` reads saved theme; context value stabilized with `useMemo`/`useCallback`; all **`manual_*`** guide strings live here |
| `src/lib/utils.ts` | `cn()` · `normalizeDate()` · **`listKey(id, index, prefix)`** · **`compositeListKey(primary, secondary, index, prefix)`** — React list keys that **never** return `""` (fixes duplicate-key console warnings) |
| `src/lib/boqPricing.ts` | **`tenderAmountExcludingProfit()`** · **`BOQ_DEFAULT_PROFIT_PCT = 12`** — budget/Reports estimated cost when rate breakdown missing; tests **`src/lib/boqPricing.test.ts`** |
| `src/lib/shellWindowPolicy.ts` | **Single-module shell policy** (all themes) — `partitionExclusiveShellWindows`, `retainErpUtilityWindows`, `normalizeShellModuleId` (`display`→`general`); **`SHELL_COEXIST_MODULE_IDS`** = calculator only; enforced in `App.tsx` `openWindow` / `restoreMinimized` / ERP `navigateToModule`. Tests: **`src/lib/shellWindowPolicy.test.ts`**. |
| `src/lib/shellNavigation.ts` | **`resolveSavedDefaultModulePreference()`** — maps stored `defaultModule` including **`none`** (empty desktop); **never** coerces `none` → `ledger`. **`resolveStartupModule`**, legacy module map. Tests: **`shellNavigation.test.ts`**. |
| `src/lib/userPreferences.ts` | **`saveUserPreferences()`**, **`canPersistUserPreferences()`** (local session cookie OR Firebase user), **`persistLanguagePreference()`**, **`USER_PREFS_UPDATED_EVENT`**. Used by **`GeneralSettings.tsx`**, **`PrintSettingsPanel`**, Sidebar/TopNav language toggle. |
| `src/lib/shellModuleVisibility.ts` | **UI-only** nav whitelist `visibleShellModules` — `isShellModuleNavVisible` · `normalizeVisibleShellModules`. Admin sets per user in Settings → Users; **does not** touch permissions / `openWindow` / API. |
| `src/lib/moduleViewPermissions.ts` | **`canOpenModuleView`**, **`SETTINGS_ADMIN_VIEW_IDS`** (`cost_centers` · `activity` · `sample_data`); ERP **`TopNavBar`** sub-views; **`Settings.tsx`** uses **`usePermissions().isAdmin`** (not separate `authApi.me()`). Tests: **`moduleViewPermissions.test.ts`**. |
| `src/context/ErpWorkspaceContext.tsx` | ERP workspace slot — `location`, `navigateTo`, `closeWorkspace`, module drafts; enabled when `usesTopNav(theme)` |
| `src/components/ErpWorkspace.tsx` | ERP main content pane — lazy-loads one module at a time from `location` |
| `src/components/TopNavBar.tsx` | ERP top navigation — `ModuleNavMenu` dropdowns; utilities (general settings, **Electron new window**, calculator, manual); routes via `navigateToModule` in `App.tsx` |
| `src/constants/moduleMenus.ts` | Sub-views per shell module + **`ERP_UTILITY_MODULE_IDS`** (`calculator`, `general`, `display`); **`manual`** is workspace-only in ERP · **Banks:** `accounts` · **`transactions`** (replaces separate `movements`/`cheques`) · `statements` |
| `src/lib/projectWarehouse.ts` | Shared **127…** warehouse resolution: `findWarehouseAccountRowForProject`, `findDisabledProjectWarehouseAccount`, `resolveWarehouseAccountForProject` — used by Inventory, ActualCosts, consumption/return modals |
| `src/lib/devOriginGuard.ts` | Dev-only: redirect `127.0.0.1` → `localhost` so session cookies match Vite proxy |
| `src/lib/dataBackend.ts` | `isLocalBackend` — `VITE_DATA_BACKEND=local` **or** prod + `VITE_API_BASE_URL=/api` (Railway full-stack). Gates Postgres API vs Firestore legacy. |
| `src/lib/offline/` | **Offline sync** — form drafts (IndexedDB) · outbox `safe_save` / `confirm_required` · `Idempotency-Key` · `OfflineStatusBar` / `PendingSyncPanel`. Local/Railway only. Covers purchases · costs · billing · banks · inventory · payroll · fixed assets · **BOQ / VO** · GL. Tests: `offline.test.ts`. |
| `src/lib/liquidityMetrics.ts` | **Shared liquidity KPIs** — `computeLiquidityContractRow`, `computePortfolioPendingBilling`, `cashAndBankBalanceFromGlTxs`, `dashboardCollectionAmountForTx`, `dashboardIpcCollectionAmountForTx`, `receivablesBalanceFromGlTxs`, `hasCustomerReceivableGlActivity`, cheque ISS/CLR pairing; used by **`Dashboard.tsx`**, **`LiquidityReport.tsx`**, **`Projects.tsx`**. Tests: **`17`** cases in `src/lib/liquidityMetrics.test.ts`. |
| `src/lib/dashboardMetrics.ts` | **Dashboard filters/compare/timeline** — `filterDashboardTransactions`, `computeDashboardPeriodStats`, `buildProjectCompareRows` (سيولة), `buildMonthlySeries` (أعمدة شهرية) · **`buildCashFlowSeries`** (تحليل التدفق النقدي — **شهري غير تراكمي**؛ نقطة أصل `__start__` = صفر ثم إجمالي كل شهر؛ الأشهر بلا حركة **`null`** ⇒ `connectNulls` يمدّ الخط؛ رسم Area خطي); UI: `DashboardFilterBar` · `ProjectCompareTable`. Tests: `dashboardMetrics.test.ts`. |
| `src/lib/reportDocument/` | **منصة مستندات التقارير** — بيانات → HTML نظيف / PDF / طباعة؛ ورقة: هيدر مضغوط + جسم + **فوتر سطر واحد** (شركة عند start · نص/ملاحظة وسط · رقم صفحة عند end — يتبع `dir` اللغة) |
| `src/hooks/useReportDocumentPreview.tsx` · `src/components/print/ReportPreviewDialog.tsx` | **الطباعة الموحّدة لكل الموديولات** — بناء `ReportDocument` (جداول أو أقسام شهادات عبر `buildCertificateDocs.ts`) وفتح حوار معاينة موحّد (تنسيق + طباعة + PDF + حفظ التصميم عبر `reportPrintProfilesPersistence.ts`) — المسار القديم `printReport.ts` حُذف |
| `src/lib/reportPrintProfiles.ts` | **Per-report print designs** — `ReportPrintProfile` (orientation/pageSize/density/accent/header/footer), `REPORT_PRINT_DEFAULTS`, `resolveReportPrintProfile()` merges `company_info.reportPrintProfiles`. **Edited in Reports format toolbar** (`ReportFormatToolbar`); General Settings **Print** keeps company name/address/tax/logo/footer text only. |
| `src/lib/concordPlusBrand.ts` | **Concord Plus branding** — `CONCORD_NAVY`/`CONCORD_ORANGE`, `CONCORD_LOGO_VIEWBOX`, `CONCORD_TAGLINE_PARTS`, asset URLs (`CONCORD_BRAND`), `resolveHeaderLogo()` |
| `src/lib/operationsManual.ts` | **In-app operations manual** — `MANUAL_TOPICS` (61 topics), `ManualTopicId`, `resolveManualTopics`, `isManualTopicAllowed` (permission before viewId), `requestOpenManual` / deep-link |
| `src/components/OperationsManual.tsx` | Full manual window (`module id: manual`) — search, module filter, topic list + `ManualTopicContent` |
| `src/components/help/ManualHelpButton.tsx` | Contextual `?` — dropdown preview + «فتح الشرح الكامل»; hidden when topic not allowed for user |
| `src/components/help/ManualTopicContent.tsx` | Shared topic body: summary · before · steps · common mistakes |
| `scripts/sync-branding-svgs.mjs` | Regenerates `public/branding/*.svg` — run **`npm run branding:sync`** after token changes |
| `src/components/branding/ConcordPlusLogoBuild.tsx` | **Login-only** construction animation (icons stagger; tagline words **MEP → Finishing → Infra** in sequence) |
| `src/lib/chartOfAccountsPicker.ts` | **`isChartLeafAccount()`** · **`chartLeafAccountOptions()`** — 8-digit active leaves for GL/Banks pickers |
| `src/lib/journalFilters.ts` | **`JournalQueryFilters`** · **`journalDateKey()`** · **`isJournalDateInRange()`** · **`filterJournalTransactions()`** — GL journal/statement filters + normalized date compare |
| `src/lib/bankTransferMeta.ts` | Bank movement **transfer** metadata — `normalizeTransferMeta()` · `transferDetailLabel()`; legacy `instapay_out`/`instapay_in` → unified `transfer` |
| `src/hooks/useFilteredGlTransactions.ts` | Loads GL txs only after user applies filters; Firestore/API date range + client-side normalize |
| `src/components/gl/JournalFilterPanel.tsx` | Shared filter UI (journal + statement tabs); account from/to = **`SearchableSelect`** leaf 8-digit |
| `src/components/gl/JournalPreviewModal.tsx` | **Shared journal preview** (read-only Dr/Cr + balance check via `MONEY_TOLERANCE`) shown before posting. Lenient `JournalPreviewEntry` (optional `accountName`/`debit`/`credit`). Used by **Payroll accrual** (`accrue-preview`), **client IPC** (`Billing.tsx`), **subcontractor IPC** (`ActualCosts.tsx`). Builders `buildIpcEntries`/`buildSubcontractorIpcEntries` in `accountingService.ts`. |
| `src/components/settings/ChartOfAccountsSettingsPanel.tsx` | **COA tree in Settings** («تهيئة شجرة الحسابات») — moved out of GL; requires `ledger.view` |
| `server/src/lib/journalDate.ts` | Server-side date normalize + **`journalDateQueryUpperBound()`** (`dateTo\uf8ff`) for Postgres string dates with ISO time suffix |
| `server/src/accounting/periodLock.ts` | **Accounting period lock** — `assertPeriodUnlocked` / `PeriodLockedError` (HTTP **423**); exempt via `allowedUserIds` |
| `server/src/modules/accountingPeriods.ts` | `GET/POST /api/accounting-periods` · lock/unlock · allowed-users (admin) |
| `src/components/gl/PeriodLockPanel.tsx` | UI قفل ربع سنوي داخل موديول الفترات المحاسبية |
| `src/hooks/useApiQuery.ts` | **API data hook** — `useApiQuery(factory, deps, { enabled, refreshKey })`؛ النمط الأساسي لقراءة Postgres في local mode |
| `src/lib/bankPersistence.ts` | **Banks dual-write** — `createBankAccount` / `updateBankCheque` / `createBankStatement` … يوجّه إلى `banksApi` في local أو Firestore في cloud |
| `src/lib/bankChequePosting.ts` | Cheque ISS/CLR journal builders + reference helpers (`CH-RECEIVED-{id}-ISS` / `-CLR`) for **Banks** module |
| `src/lib/glAccountBalance.ts` | **GL balance map for Banks forms** — `buildGlAccountBalanceMap()` · `resolveBankGlAccountCode()` · `coaIdToAccountCode()` · `resolveGlBalanceSide()`; tests **`glAccountBalance.test.ts`** |
| `src/hooks/useGlAccountBalances.ts` | Loads capped GL txs once for **`Banks.tsx`** (`glApi` local · Firestore `isDeleted + orderBy date` cloud) → `balanceByCode` passed to **transactions** tab (movements/cheques forms) |
| `src/components/banks/GlAccountBalanceHint.tsx` | Inline hint under bank/offset pickers — **available balance** (bank) · **account balance** Dr/Cr (COA leaf) |
| `src/components/banks/BankAccountsTab.tsx` | **Accounts split-view** — sidebar: «إضافة حساب جديد» + bank names; main: **`BankAccountStatementPanel`** (GL statement default) · «بيانات الحساب» edit form |
| `src/components/banks/BankAccountStatementPanel.tsx` | Embedded GL account statement for selected bank (`embedded`, `bankAccountId`, `onEditAccount`) — replaces standalone `account_statement` tab |
| `src/components/banks/BankTransactionsTab.tsx` | **Transactions split-view** — unified movements + cheques list; main pane embeds **`BankMovementsTab`** / **`BankChequesTab`** in create/detail mode |
| `src/components/banks/BankMovementsTab.tsx` | Bank movements CRUD + transfer wizard; **`embedded`** + **`panelMode`** (`create` \| `detail`) when hosted by **`BankTransactionsTab`** |
| `src/components/banks/BankChequesTab.tsx` | Received/issued cheques ISS+CLR; same **`embedded`** / **`panelMode`** pattern as movements |
| `src/lib/materialsTreeExcel.ts` | Materials tree **Excel export/import** helpers (`exportMaterialsTreeExcel`, `parseMaterialsImportFile`, template download) |
| `src/constants/modules.ts` | `STARTUP_MODULES`, `MODULE_LABELS`, `DEFAULT_MODULE`, `normalizeDefaultModule()` — `display` / `calculator` in labels only, not startup dropdown |
| `src/lib/adminIdentityVerification.ts` | `verifyAdministratorIdentity()` — Google `reauthenticateWithPopup` when Firebase user exists; **password login** (Express session) uses `POST /auth/verify-admin-password` via `authApi.verifyAdminPassword`. |
| `src/constants/dataLimits.ts` | `limit()` caps on heavy `onSnapshot` queries (Reports, ActualCosts, Liquidity, Purchases, Dashboard tx list) |
| `src/types.ts` | Shared types: `UserPermissions`, `ALL_PERMISSIONS`, `DEFAULT_PERMISSIONS`; includes `inventory` + `subcontractor` CRUD modules |
| `src/lib/permissions.ts` | `buildPermissionsForRole()`, `moduleAccess()`, `normalizeUserPermissions()`, `resolvePermissionsFromUserData()`, `firstPermittedStartupModule()` |
| `src/hooks/useChartOfAccountsRef.ts` | **COA for pickers** — in **local mode** reads SQLite only (`chartOfAccountsApi`); cloud mode uses Firestore `chart_of_accounts`. Use in Actual Costs / inventory modals instead of raw `useFirestoreQuery` on COA |
| `src/hooks/useFirestoreQuery.ts` | **Unified Firestore hook** — `mode:'snapshot'` (realtime) or `mode:'once'` (getDocs); returns `{ data, loading, error, size }`; pass `null` from factory to skip |
| `src/lib/firestoreListen.ts` | **Safe `onSnapshot` wrapper** — `listenQuery(q, cb, errCb)` and `listenDoc(ref, cb, errCb)`. In `isLocalBackend` mode converts to one-time `getDocs`/`getDoc` (no WebSocket → prevents `INTERNAL ASSERTION FAILED`). In production uses real `onSnapshot`. **All components use these; direct `onSnapshot` import is banned.** |
| `src/hooks/useUserAccessScope.ts` | **Local:** `role` from `PermissionsContext` (password + Google sessions); `assignedContractIds` from `/auth/me` — **do not gate on Firebase** (Electron password has no Firebase user). **Cloud:** Firestore `users/{uid}` |
| `src/services/local/modulesApi.ts` | Client-side API wrappers (`banksApi`, `settingsApi`, `projectInventoryTransfersApi` → `/inventory/project-transfers`, `inventoryApi`, …) |
| `server/src/modules/settings.ts` | `GET/PUT /api/settings/company_info` · `GET/PATCH /api/settings/user-preferences` (+ `visibleShellModules` on GET) · **admin** `GET/PATCH /api/settings/user-preferences/:userId` · `GET /api/settings/backup-export` · **`GET/POST /api/settings/push-to-production/*`** |
| `server/src/migration/pushToProduction.ts` | Preview + push local Postgres → Railway via `PRODUCTION_DATABASE_URL` |
| `server/src/migration/buildPostgresBackup.ts` | Full Postgres snapshot — **78** collection keys (inventory · warehouse receipts · payroll · fixed assets · OHA · custody · MOS · VO · …); v3 JSON via **`GET /api/settings/backup-export`** |
| `server/src/migration/backupCollections.ts` · `src/constants/backupCollections.ts` | **`POSTGRES_BACKUP_COLLECTIONS`** / **`FIRESTORE_BACKUP_COLLECTIONS`** |
| `server/src/lib/dataMaintenanceWipes.ts` | Postgres wipe handlers per module group — used by **`POST /api/financial-maintenance/wipe`** |
| `server/src/migration/importPostgresBackup.ts` | Full Postgres restore from backup JSON |
| `src/components/settings/PushToProductionPanel.tsx` | Settings → Database — admin push UI (local backend only) |
| `server/src/accounting/projectWarehouseGl.ts` | Inter-project transfer GL: `resolveProjectWarehouseAccount` (auto-reactivates linked disabled 127… rows), `postProjectTransferJournal` |
| `server/src/accounting/syncCoaBatch.ts` | Firestore→SQLite COA batch upsert; **preserves `active`** on project-linked 127… accounts when Firestore sync would disable them |
| `server/src/modules/projectInventoryTransfers.ts` | Project warehouse transfer workflow + GL on `approve-projects` |
| `server/src/modules/ensureLocalProject.ts` | Insert missing `projects` row before FK writes (Firestore ahead of SQLite) |
| `src/main.tsx` | App boot · `installExcelLikeInputBehavior()` · `ThemedToaster` |
| `src/lib/excelLikeInputs.ts` | **Excel-like inputs (app-wide):** focus → select-all (typing replaces); arrow/Tab/Enter navigate cells inside editable `<table>`s. Opt-out: `data-excel-nav="off"` / `data-excel-select="off"`. Tests: `excelLikeInputs.test.ts` |
| `src/lib/spreadsheetGridNav.ts` · `SpreadsheetCellInput` | Explicit grid refs (e.g. Actual Costs IPC) — `data-excel-nav="managed"` so global navigator skips them |
| `firestore.rules` | Security rules |
| `firestore.indexes.json` | Composite indexes — 7 indexes covering all `where + orderBy` query patterns |
| `server/src/app.ts` | Express app — registers all routers; **dev CORS** allows any `localhost` / `127.0.0.1` port (Vite may use 3002+ if 3000 is busy) |
| `server/src/modules/sqliteCore.ts` | Distributed purchase invoices (`status`: draft/confirmed/posted); inventory update on `confirmed` (weighted-average) |
| `server/src/modules/materials.ts` | CRUD for `material_groups` + `material_categories`; **`POST /import`** bulk Excel rows (transaction, skip duplicate codes) |
| `src/components/MaterialsTree.tsx` | Materials tree UI — manual add + **Export / Template / Import** (admin / projects_manager); embedded in `Projects.tsx` and `Inventory.tsx` (materials tab) |
| `server/src/modules/boqMaterials.ts` | Link BOQ items ↔ allowed materials (`boq_item_materials`); also **`link-counts`** · **`consumed-quantity`** · **`unlinked-report`** · **`inherit`** · **`can-delete`** |
| `src/components/BoqMaterialsModal.tsx` | Full link editor for one BOQ item (+ consumed-qty warning) |
| `src/components/inventory/QuickLinkMaterialModal.tsx` | Quick link material → BOQ from consumption (no costs/prices); project BOQ list via `boqApi.list(?projectId=)` |
| `src/components/inventory/UnlinkedMaterialsReport.tsx` | Unlinked BOQ items + unused materials report (Inventory balance tab) |
| `src/components/boq/DeleteBlockedModal.tsx` | In-app modal when BOQ delete blocked (links / consumption / actual costs) |
| `server/src/modules/consumptionOrders.ts` | Site consumption orders: create draft (stores **`expense_account_code` / `expense_account_name`**) → `POST /:id/confirm` (stock + `boq_actual_costs`); **project-scoped access** via `getAccessibleProjectIds` / `assertProjectAccess` (not per-assigned contract) |
| `server/src/modules/returnOrders.ts` | Return orders: `GET /returnable/:lineId` (includes consumption expense account), create → confirm (BOQ reversal + `returnProjectInventory`); list lines include **`consumption_order_number`** |
| `server/src/modules/inventoryMaintenance.ts` | Admin-only **`GET /stats`**, **`POST /purge`** — delete warehouse movements/orders + reset `project_inventory` / `contract_inventory` balances (keeps materials tree + `127…` COA) |
| `server/src/modules/inventoryHelpers.ts` | Weighted avg, reserve/release, `assertContractAccess` (transfers/returns), **`assertProjectAccess`**, **`getAccessibleProjectIds`**, `getAssignedContractIds` |
| `server/src/modules/inventory.ts` | Project warehouse summary/movements; mounts **`/project-transfers`** router; `boq-actuals`; legacy contract inventory |
| `server/src/modules/inventoryTransfers.ts` | **Legacy contract** transfers; reserve on create; qty on `approved` (no GL) |
| `server/src/modules/crud.ts` | Generic CRUD; **contracts/projects writes** require `projects` permission (read also from costs/boq) |
| `server/src/modules/subcontractor.ts` | Subcontractors, assignments, extracts; extract **approve** = admin or projects_manager only |
| `server/src/modules/purchaseTransactions.ts` | **`purchase_transactions`** CRUD + items; subcontractor IPC **`POST /:id/approve`** (admin / projects_manager → GL) |
| `server/src/modules/custodySettlements.ts` | **`custody_settlements`** CRUD; **`POST /:id/approve`** (admin or `ledger.create` → GL via `postCustodySettlementJournals`) |
| `server/src/accounting/custodySettlementJournal.ts` | GL builder — groups expense items by `contractId`; one balanced tx per group + custody Cr |
| `server/src/accounting/subcontractorIpcJournal.ts` | Subcontractor IPC journal on approve (server-side) |
| `src/components/gl/GLCustodySettlement.tsx` | Custody tab — list + modal; per-project numbering `SET-{projectCode}-NNNN`; draft/submit/approve; export/print |
| `src/lib/shellNavigation.ts` | Also **`setPendingCustodySettlementId`** / **`consumePendingCustodySettlementId`** for notification deep-links |
| `server/src/permissions.ts` | Server-side `PermissionKey`, role presets |
| `server/src/middleware/auth.ts` | `requireAuth`, `requirePermission`, `requireRole` middlewares |
| `server/sqlite/migrations/` | **001–013**; legacy local SQLite — **disabled in production** (`SQLITE_CORE_ENABLED=false`) |
| `deploy/railway-api.Dockerfile` | Railway full-stack: Vite build then prune UI deps; Express + Prisma runtime; SPA in `dist/` |
| `railway.toml` | Railway project config (Dockerfile builder, `/api/health` check) |
| `scripts/generate-vite-env.mjs` | Writes `.env.production` from `VITE_*` (Railway build vars or local `.env`) |
| `scripts/start-api-production.mjs` | Production entrypoint: migrate deploy → `dist-server/index.js` |
| `docs/RAILWAY_DEPLOY.md` | Step-by-step Railway deploy (Postgres + env vars + migrate + Electron URL) |
| `electron/main.ts` | Thin Electron shell — **multi app windows** (`createAppWindow`, same `persist:webcost`); **Ctrl+N** / IPC `open-new-window` (shortcut via **`input.code === 'KeyN'`** — layout-safe for Arabic keyboard); **OAuth popup** lifecycle only for non-app windows; F12 · Ctrl+Shift+R (`KeyR`) · `WEB_COST_APP_URL` / `production-url.json` |
| `electron/updater.ts` | `electron-updater` — GitHub Releases · `createRequire` (CJS) · skip if load fails |
| `src/lib/electronShell.ts` | `isElectronShell` · `requestOpenNewWindow` · `requestWindowMaximize` · `requestAppQuit` · desktop notifications · `Login.tsx` uses `signInWithPopup` in Electron |
| `server/src/migration/verifyMigrationCounts.ts` | Post-migrate verification; **PASS with warnings** when Postgres has extra GL rows after `backfill-gl` |

### Components

| Component | Firestore Collections | SQLite (isLocalBackend) |
|-----------|----------------------|------------------------|
| `Projects.tsx` | cloud: Firestore | **local:** `projectsApi` · `contractsApi` · `billingApi` · `glApi` — قراءة/كتابة كاملة |
| `BOQ.tsx` | cloud: Firestore | **local:** `projectsApi` · `contractsApi` · `boqApi` · `billingApi` (progress) |
| `Billing.tsx` | cloud: Firestore + `recordIPC` | **local:** `billingApi` CRUD + journal عبر الخادم؛ MOS panel Postgres فقط (لا مرآة Firestore) |
| `GeneralLedger.tsx` | cloud: Firestore | **local:** `glApi` + `chartOfAccountsApi` (pickers only) — **لا دمج Firestore** · COA edit في **Settings** |
| `ActualCosts.tsx` | cloud: Firestore | **local:** suppliers/COA/projects/boq/purchase/GL عبر API |
| `Reports.tsx` | cloud: Firestore (capped) | **local:** projects/contracts/COA/boq/billing/GL عبر `useApiQuery` — لا دمج Firestore |
| `LiquidityReport.tsx` | cloud: Firestore | **local:** Postgres فقط — KPIs عبر `liquidityMetrics.ts` (مطابق Dashboard) |
| `GeneralSettings.tsx` | `users/{uid}` (cloud) · `user-preferences` (local) | Theme · language · default module · **admin:** `PrintSettingsPanel` (company letterhead data only) |
| `Settings.tsx` | `settings/company_info`, `users`, backup/restore (cloud) | **local:** `authApi.userDirectory` · `settingsApi` · **COA** (`ledger.view`) · **admin sections:** `cost_centers` (local only) · `activity` · `sample_data` via **`usePermissions().isAdmin`** + **`moduleViewPermissions`** · ERP view sync via **`useErpModuleView`**
| `Dashboard.tsx` | cloud: Firestore | **local:** projects/contracts/billing/boq/GL عبر API — فلاتر جانبية · KPI + دلتا · مقارنة سيولة + **تقدم المشروع** · رسم فطيرة حصة أعمال العقود · **بدون** PDF/جدول زمني/أحدث حركات · `dashboardMetrics.ts` |
| `Banks.tsx` | `bank_*` + GL (Firestore) | **local:** `banksApi` + `bankPersistence` — **3 tabs:** `accounts` (statement split-view) · **`transactions`** (movements+cheques split-view) · `statements`; GL via `accountingService`/`glApi`; **no top stat cards** on `accounts`/`transactions` |
| `Inventory.tsx` | cloud: Firestore | **local:** projects/contracts/COA + مخازن/صرف/إرجاع/تحويلات عبر API — **لا Firestore** |
| `PurchaseRequests.tsx` | — | **local:** Postgres `purchase_requests` — طلب توريد (مكود/غير مكود) · BOQ كود+وصف فقط · حالات بدون فاتورة/GL · إشعار + واتساب لمسؤولي المشتريات |
| `OverheadAllocation.tsx` | — | **local:** Postgres — دورات OHA + **قفل فترات محاسبية** (`PeriodLockPanel`) + قائمة دخل (placeholder) |
| ~~`SubcontractorExtracts.tsx`~~ | — | **Hidden** — functionality covered by ActualCosts IPC tab; file on disk but removed from Sidebar + `modules.ts` |

**Shell / routing:** `WindowManager.tsx` **lazy-loads** all feature modules (`React.lazy` + `Suspense`).

**Per-window crash isolation:** every `WindowFrame` wraps its module in `WindowErrorBoundary` (class component). A module crash shows a retry/close fallback scoped to that window only — the rest of the app keeps running. `retryKey` state inside `WindowFrame` resets the boundary on retry.

**Sidebar** (`w-56`, compact design — reduced padding `px-3 py-1.5`, `text-sm`, icons `size={16}`) — themes **`dark`**, **`soft`**, **`light`**:
- Nav items have three visual states driven by `activeModuleId` + `openModuleIds`:
  1. **Active** (`bg-blue-600` blue) — the module whose window has the highest `zIndex` among non-minimized windows. `activeModuleId` is computed in `App.tsx` via `useMemo` over `windows` and passed as a prop to `Sidebar`.
  2. **Open but not active** (`shell.navOpen`) — window exists but is minimized (e.g. user minimized manually). Shows a small blue dot on the trailing edge. **Opening another module closes** the previous one — it does not stay on the taskbar.
  3. **Closed** (`shell.navMuted`) — module not open.
- **Arrow key navigation**: `↑`/`↓` on any focused nav button moves focus to the adjacent item (wraps around). Refs held in `navBtnRefs: useRef<(HTMLButtonElement | null)[]>`.

**Shell — single-module policy (all themes: dark · soft · light · erp):**

| Theme | Layout | Module host | Utilities (general · calculator · manual) |
|-------|--------|-------------|---------------------------------------------|
| **`dark`**, **`soft`**, **`light`** | **`Sidebar`** + floating **`WindowManager`** | One **`AppWindow`** at a time (`openWindow`) | `general` / `manual` = windows; `calculator` = floating panel |
| **`erp`** | **`TopNavBar`** + **`ErpWorkspace`** + optional overlay **`WindowManager`** | One workspace **`location`** (`navigateToModule` → `ErpWorkspaceContext`) | `general` / `display` = overlay windows; `manual` = workspace module; `calculator` = overlay |

- **One primary module** at a time — opening any module **closes** the previous one (not minimize-to-taskbar). Logic: **`src/lib/shellWindowPolicy.ts`** + **`App.tsx`** `openWindow` / `restoreMinimized`.
- **Exception — calculator:** may stay open as a small floating panel alongside the active module (`SHELL_COEXIST_MODULE_IDS`).
- **General settings:** module ids `general` / `display` (legacy) share one slot — `normalizeShellModuleId()` maps both to `general`.
- **Utilities** (`general`, `manual` in sidebar themes): same exclusive rule as main modules (floating windows).
- **ERP (`theme: erp`):** main modules render in **`ErpWorkspace`** (single workspace slot via **`ErpWorkspaceContext.navigateTo`**). Overlay utilities (`general`, `display`, `calculator`) use **`WindowManager`** **`overlayMode`**. **`navigateToModule`** in **`ErpShellContent`**: workspace open → **`closeShellOverlayWindows()`**; utility open → **`erp.closeWorkspace()`** then **`openWindow`**.
- **Entry points:** **`Sidebar`** / **`TopNavBar`** / **`ManualNavigationListeners`** / **`NotificationBell`** — all must go through **`openWindow`** or **`navigateToModule`**; do not bypass with raw **`setWindows`**.
- **Language toggle** with open modules: confirm dialog → **`closeAllWindows()`** (+ **`erp.closeWorkspace()`** in ERP).
- **Do not regress:** opening Dashboard while General Settings is open must **close** General Settings in every theme (ar/en UI strings differ; policy is identical).
- **Verify:** `npm run test -- src/lib/shellWindowPolicy.test.ts` · golden path each theme: general settings → ledger (or any main module) → settings window/workspace must be gone.

**Sidebar footer** (visible to all authenticated users, no permission check):
- **General settings** button (Palette icon) → opens `general` module window (`display` is legacy alias).
- **New desktop window** (Electron only, AppWindow icon) → `requestOpenNewWindow()` / **Ctrl+N** — same session; not shown in browser.
- **Calculator** button (Calculator icon) → opens `calculator` module window (floating, 240×400 px; **does not close** the active module — see **`SHELL_COEXIST_MODULE_IDS`**).
- **User guide** — open **`manual`** module or contextual **`?`** on screens (see **Operations Manual** section).
- **Language toggle** button — switches ar/en directly via `setLanguage()`.

**In-app window switching:**
- OS-level `Alt+Tab` is captured by Windows before the browser and cannot be reliably intercepted in a web app. No keyboard shortcut is implemented for window cycling; use the taskbar (minimized windows strip at the bottom of the desktop area) to restore a **manually minimized** window. Restoring from the taskbar applies the same exclusive policy (closes other non-calculator modules).

**Empty desktop (`WindowManager.tsx`):** when **`windows.length === 0`**, shows centered **`company_info.headerLogo`** via **`resolveHeaderLogo()`** (fallback `logo-print.svg`) at **50% opacity** — no hint text. **`App.tsx` `enteringApp`** splash runs **only before first default module opens** (`!hasOpenedDefault.current`) — **not** when user closes all windows manually.

> `Purchases.tsx` — **removed** from Sidebar / `WindowManager`. File remains on disk.
> `SubcontractorExtracts.tsx` — **hidden** from Sidebar / `modules.ts`. Use ActualCosts IPC tab for subcontractor IPCs.
> `LiquidityReport` — no longer a standalone window. Rendered as a tab inside `Reports.tsx`.

### Data Integrity Rules

- **Billing → GL**: Every non-draft IPC write goes through `accountingService.recordIPC()` which creates/updates a `transactions` doc and stores its ID as `billing.transactionId`.
- **Draft revert**: Uses `writeBatch` to atomically soft-delete the GL entry and clear `transactionId` on the billing doc in one operation (`Billing.tsx`).
- **Supplier creation**: Uses `writeBatch` to atomically create the supplier doc and its `chart_of_accounts` entry in one operation (`ActualCosts.tsx → handleSaveSupplier`). The supplier type (`supplier` vs `subcontractor`) determines the parent code (`21101` vs `21102`) and sequential account code base (`21101001` vs `21102001`).
- **Soft deletes**: All deletions set `isDeleted: true`. Never hard-delete.
- **BOQ progress**: Derived from `billing` docs with `status IN ['submitted','approved','paid']`. Filtered via `useMemo` to exclude phantom entries from deleted BOQ items.
- **Batched Writes rule**: Any operation that writes to more than one collection must use `writeBatch` to guarantee atomicity.
- **projectId vs costCenterId**: On `transactions`, `costCenterId` = contract ID and `projectId` = actual project ID. Never set `projectId` to a contract ID. In `GLJournalEntries`, derive `projectId` from `contracts.find(c => c.id === costCenterId)?.projectId`.
- **Budget alert**: `ActualCosts.tsx` computes `boqBudgetByContract` and `spentByContract` via `useMemo` (no extra Firestore reads). A yellow warning banner appears when `spent + newAmount > BOQ budget` for the selected contract — non-blocking, user can still save.
- **Actual Costs — creditor picker**: Invoice / IPC modals select **chart_of_accounts** leaf accounts under supplier (`21101…`) or subcontractor (`21102…`) branches by **document `id`**, not only rows with `supplierId`. Optional `supplierAccountId` is written on new `purchase_transactions` rows when saving; journal lines use `supplierAccountCode` from the chosen COA row. **Invoice/IPC table rows are clickable** — open modal for preview/edit. Posted invoices (`transactionId` set) open **read-only**. Custody tab uses **`GLCustodySettlement`** → **`custody_settlements`** entity (GL only on **approve**, not on save).
- **Dashboard & Liquidity — collection / receivables KPIs** (2026-06-13): All use `src/lib/liquidityMetrics.ts`.
  - **التحصيلات النقدية** (`Dashboard` card): **`ipcCollected` only** — operational cash in bank: direct `Dr 121…` with pure operating credits, or **`CH-RECEIVED-*-CLR`** when paired ISS credits **only** `12201…` / `21301…` (no mixed `21401…` VAT lines). **Do not count** `CH-*-ISS` (not cash yet). **Exclude** equity/financing credits **`311–314`** (e.g. جاري الشركاء `31401001`). **Exclude** client advances (`21301…`-only) from this card — they appear in Liquidity *دفعات مقدمة*.
  - **مستخلصات تحت التحصيل** (`pendingBilling`): **net Dr on customer receivables `12201…`** from merged GL when any `12201` activity exists; else fallback `uncollected` from billing. **Do not** use `Math.max(receivables, uncollected)` — it inflated the card. **`uncollected` per contract** = `max(0, receivablesNet)` from contract-attributed GL when `12201` activity exists; else `max(0, Σ netPayable − ipcCollected)`. **`LIQUIDITY_BILLED_STATUSES`** includes `review` (not draft). **`netPayable`** on billing docs — do not subtract client advances again (was zeroing the card incorrectly).
  - **Liquidity report** `totalCollected` column = `ipcCollected + clientAdvances` (operating, same CLR/ISS rules via `dashboardCollectionAmountForTx`).
  - Cheque pairing: `glTxsForContractAnalysis` pairs ISS when CLR carries `costCenterId`. Normalize `accountCode` with `String(code).trim()`.
  - **Mis-posted partner funding** on `12201001` instead of `31401001` reduces receivables KPI but does not count as operational collection — fix in GL/Banks, not KPI heuristics.
  - Run **`npm run test -- src/lib/liquidityMetrics.test.ts`** after changes.
- **Sub-account shortcut**: In **`ChartOfAccountsSettingsPanel.tsx`** (Settings → تهيئة شجرة الحسابات), hovering a row shows a green `+` button **only when `acc.isGroup === true`** (levels 1–4). Level-5 leaf accounts (`isGroup: false`) never show this button. Clicking it opens `AccountModal` with `defaultParentCode` and `defaultType` pre-filled, and the modal auto-computes the next sequential code under that parent (max existing child code + 1, or `parentCode + '001'` if no children yet).

### Accounting — Account Codes

Account codes are defined in `AccountCodes` enum in `src/services/accountingService.ts`. **Always use the enum constants, never hardcode strings.**

The chart of accounts uses **5 levels**. Only level-5 accounts (8-digit codes) are used in actual journal entries. Levels 1–4 are group accounts (`isGroup: true`).

| Constant | Code | Description |
|----------|------|-------------|
| `BANK` | 12101001 | البنك التجاري الدولي |
| `CASH` | 12102001 | عهدة نقدية |
| `RECEIVABLES` | 12201001 | العملاء - مستخلصات تحت التحصيل |
| `RETENTION_GUARANTEE` | 12202001 | محتجزات الضمان - عملاء |
| `RECEIVED_CHEQUES_CLEARING` | 12203001 | شيكات واردة برسم التحصيل (وسيط — Dr عند ISS، Cr عند CLR) |
| `ADVANCE_TO_SUPPLIERS` | 12301001 | مقدمات للموردين |
| `ADVANCE_TO_SUBCONTRACTORS` | 12302001 | مقدمات لمقاولي الباطن |
| `VAT_INPUT` | 12401001 | ضريبة القيمة المضافة - مدخلات (مشتريات) |
| `WHT_RECEIVABLE` | 12401002 | ضريبة الخصم والإضافة - مدين (محتجز من العميل) |
| `SOCIAL_INSURANCE_RECEIVABLE` | 12402001 | التأمينات الاجتماعية - مدين |
| `MANPOWER_LEVY_RECEIVABLE` | 12403001 | القوى العاملة - مدين |
| `SUPPLIERS` | 21101001 | الموردون |
| `SUBCONTRACTORS` | 21102001 | مقاولو الباطن |
| `RETENTION_PAYABLE` | 21201001 | محتجزات الضمان - مقاولون |
| `ADVANCE_PAYMENT` | 21301001 | دفعات مقدمة من العملاء (خصم — liability) |
| `VAT_OUTPUT` | 21401001 | ضريبة القيمة المضافة - مخرجات (إيرادات) |
| `WHT_PAYABLE` | 21402001 | مصلحة الضرائب - خصم وإضافة (دائن) |
| `SOCIAL_INSURANCE_PAYABLE` | 21403001 | التأمينات الاجتماعية - دائن |
| `MANPOWER_LEVY_PAYABLE` | 21404001 | القوى العاملة - دائن |
| `ISSUED_CHEQUES_PAYABLE` | 21601001 | شيكات صادرة تحت الصرف (وسيط — Cr عند ISS، Dr عند CLR) |
| `REVENUE` | 41101001 | إيرادات عقود المقاولات |
| `EXPENSE_MATERIALS` | 51101001 | مواد البناء |
| `EXPENSE_LABOUR` | 51102001 | عمالة مباشرة |
| `EXPENSE_SUBCONTRACTOR` | 51103001 | مقاولو الباطن - تكاليف |
| `EXPENSE_EQUIPMENT` | 51104001 | معدات وآلات |
| `EXPENSE_ADMIN` | 52101001 | رواتب وأجور إدارية |
| `EXPENSE_INDIRECT_SITE` | 51201001 | تحميل مصروفات غير مباشرة على العقود (قيد OHA — مدين) |
| `BANK_CHARGES` | 53102001 | رسوم بنكية |

**قواعد مهمة:**
- Revenue accounts start with `4`, expense accounts start with `5`.
- Fixed assets are under prefix `11xxxx`. Current assets (cash, receivables, prepayments, tax receivables) are under prefix `12xxxx`. Cash & bank accounts are `121xxxxx` (banks = `12101xxx`, cash funds = `12102xxx`).
- Non-current / fixed assets are under prefix `11xxxx`; WIP is under current assets prefix `126`.
- VAT و WHT والتأمينات والقوى العاملة **مقسّمة** إلى كودين: مدين (أصل تحت `124`) ودائن (خصم تحت `214`). استخدم الكود الصحيح بحسب جهة القيد.
- IPC collection transactions: debit `BANK (12101001)` + credit `RECEIVABLES (12201001)`.
- Advance payment received: debit `BANK (12101001)` + credit `ADVANCE_PAYMENT (21301001)` — or via received cheque ISS leg (Dr `12203001`, Cr `21301001`) then CLR to bank.
- **Received cheque (Firestore Banks)**: ISS reference `CH-RECEIVED-{chequeId}-ISS`; CLR `CH-RECEIVED-{chequeId}-CLR`. Requires COA leaves **`12203001`** and **`21601001`** (issued). Legacy clearing codes **`12301001`**, **`13101001`** still recognized in metrics for old data.
- **Dashboard cash/bank detection**: uses `startsWith('121')` to cover all banks and cash funds.
- **Account code migration**: `src/services/migrateAccountCodes.ts` contains `migrateAccountCodes()`, `patchMissingCoaAccounts()`, and `deduplicateCoaAccounts()` — these are maintenance utilities available via code only. The Settings UI buttons for these were removed after migrations completed.
- ملف الـ seed الكامل لشجرة الحسابات (5 مستويات): `src/data/chartOfAccountsSeed.ts`. يحتوي على `seedChartOfAccounts()` لتهيئة Firestore.

### Authentication & Registration Flow

- **Google Sign-In only** — no email/password accounts.
- **Registration**: admin manually creates a doc in `users/{uid}` (or `user_permissions/{email}`) in Firestore **before** the user's first login. There is no in-app registration UI.
- **Login flow**: user signs in with Google → `App.tsx` checks `users/{uid}` for permissions. If the doc has no permissions, a full-screen **"Pending Activation"** screen is shown (language toggle + logout only; no module access) until admin grants permissions from inside Settings.
- **Login splash (`Login.tsx` + `App.tsx`)**: `ConcordPlusLogoBuild` — wordmark assembly + **tagline animation login-only** (static `logo-full.svg` after build). **`enteringApp`** overlay = post-login splash **until first module window opens** (`windows.length === 0 && !hasOpenedDefault.current`) — avoids white flash while `WindowManager` lazy-loads; **must not** re-trigger when user closes all windows. `index.html` boot splash shows `logo-full.svg` before React hydrates.
- **Electron OAuth**: popup hidden until Google URL; closes automatically if blank or redirected to app origin — rebuild shell after `electron/main.ts` changes (`npm run electron:build:shell`).
- **Admin sensitive operations**: verified via `verifyAdministratorIdentity()` — **Google** `reauthenticateWithPopup` when signed in with Firebase; **password/Electron login** re-verifies with login password (`POST /auth/verify-admin-password`, admin role required).
- `AdminSensitiveVerifyModal` shows Google button when Firebase user exists; **password field** when `VITE_DATA_BACKEND=local` (password-only sessions show password only). Portals via **`SettingsFloatingDialog`** (`layer: stack`, `SHELL_MODAL_STACK_Z`). Settings Backup / Clear / User dialogs use the same floating shell (`layer: base`); parent dialog **hides** while verify is open so only one overlay is visible, then reappears with progress/result.

#### Dual-Backend Role Sync (important)

Firestore and SQLite maintain **independent** user records. Setting `role: admin` in Firestore does **not** automatically update the SQLite record.

- **`/auth/firebase-session`**: on first Firebase login, creates a SQLite user with `role: 'user'` and `DEFAULT_PERMISSIONS` if no local record exists. If a record already exists, its role is left unchanged.
- **To elevate an admin** in the local backend after first login:
  ```bash
  sqlite3 "server/data/financial-core.sqlite" \
    "UPDATE users SET role='admin', permissions='{\"dashboard\":true,\"ledger\":true,\"projects\":true,\"boq\":true,\"billing\":true,\"costs\":true,\"suppliers\":true,\"reports\":true,\"settings\":true,\"inventory\":true,\"transfers\":true,\"subcontractor\":true}' WHERE email='user@example.com';"
  ```
  The user must then **log out and back in** to refresh the Express session.
- Symptoms of a mismatched SQLite role: toast **"فشل تحميل شجرة الأصناف"** (materials groups 403) and other local API 403 errors even after Firestore admin is set correctly.

### Permissions

- `ALL_PERMISSIONS` — full access (admins only).
- `DEFAULT_PERMISSIONS` — all modules off; new users see **Pending Activation** until admin grants access via Settings.
- Pre-registered users: admin edits `users/{uid}` in **Settings → User management** (not only Firebase Console).

#### Module access vs reference data (critical)

Three different concepts — **do not conflate them**:

| Concept | Meaning | Example |
|---------|---------|---------|
| **Module access** | User may open the module (`openWindow` / API) | `ledger.view === false` → cannot open General Ledger |
| **UI visibility** | Admin whitelist `visibleShellModules` — nav hide only | Hide Reports in Sidebar; permissions + deep-links still work |
| **Reference read** | User may **read** another module's collection as a lookup | `costs.create === true` → may **list** `chart_of_accounts` for invoice creditor picker **without** `ledger.view` |

**UI visibility (2026-08-02):** stored in `user_prefs:{userId}.visibleShellModules` (null = all permitted). Admin edits in **Settings → Users**. Filter via `isShellModuleNavVisible` in Sidebar/TopNav only — **never** gate `openWindow`, notifications, or server `requirePermission`. Helpers: `src/lib/shellModuleVisibility.ts`.

**UI (client):** `moduleAccess(permissions, key).view` + `canOpenShellModule` gates open; visibility filters nav after that.  
**Firestore (server):** `firestore.rules` uses `canModuleUse(moduleKey)` (view **or** create **or** edit) for reference helpers: `canReadCoaRef`, `canReadProjectsRef`, `canReadContractsRef`, `canReadBoqRef`, `canReadSuppliersRef`, `canReadPurchaseTxRef`, `canReadTransactionsRef`, `canReadBillingRef`.

**Firestore rules — literal permission fields (do not regress):**  
Cloud Firestore security rules **cannot** reliably evaluate `permissions[variableKey]`. Rules must use **literal** paths, e.g. `userPerms().costs is map && userPerms().costs.view == true`, implemented in `crudPermUse('costs')` / `crudPermView('costs')` inside `firestore.rules`. Never revert to dynamic `permissions[moduleKey]` indexing.

**Login sync (`App.tsx`):** On each successful login, `users/{uid}` is merged with `{ role, permissions: resolvePermissionsFromUserData(data) }` so Firestore rules see the same CRUD-shaped `permissions` object the client uses. Admin changes in Settings must still call `updateDoc` + `authApi.syncFirebaseUser` for SQLite.

**Default startup module:** `DEFAULT_MODULE` in `constants/modules.ts` is `'ledger'`. `firstPermittedStartupModule()` in `src/lib/permissions.ts` opens the **first module the user may view** (e.g. `costs` only → opens Actual Costs, not GL). Do not open Dashboard/GL queries for users without that module's view (`Dashboard.tsx` gates on `can('dashboard').view`).

**Chart of accounts pickers:** Use `useChartOfAccountsRef({ leafOnly: true })` in Actual Costs (and similar). Local backend: `GET /api/chart-of-accounts` allows read with **any** of `ledger|costs|billing|banks|inventory|projects|boq|suppliers|reports`; writes still require `ledger` (`server/src/app.ts`).

**Server `hasPermission`:** `server/src/permissions.ts` treats CRUD maps as enabled when **any** of `view|create|edit` is true (not only flat booleans).

**Roles** (defined in `src/lib/permissions.ts` + `server/src/permissions.ts`):

| Role | Key Capabilities |
|------|-----------------|
| `admin` | Full access to everything |
| `projects_manager` | projects, boq, billing (view costs), view/approve inventory transfers, view subcontractor |
| `project_accountant` | costs, billing, inventory (full), subcontractor (full) — **writes** scoped to `assignedContractIds` for Actual Costs IPC/invoice; **inventory consumption** scoped by **project** (any contract in an accessible project). Legacy inventory **transfers** still use assigned contracts only. |
| `user` | dashboard only (awaiting admin approval) |

**Module permissions** include `inventory` and `subcontractor` as `ModuleCrudPermission` entries in `UserPermissions`. Sidebar filters items via `moduleAccess(permissions, id).view`.

`useUserAccessScope` hook exposes `role`, `assignedContractIds`, `isAdmin`, `isProjectsManager`, `isProjectAccountant` — use it to scope queries and guard writes client-side.

**Password / Electron login (local mode):** `useUserAccessScope` must read **`role` from `PermissionsContext`** (set by `App.tsx` from Postgres session), not from `onAuthStateChanged` alone — Electron password login has **no Firebase user**. `assignedContractIds` still come from `authApi.me()`. Inventory uses `userRole === 'admin' || userRole === 'projects_manager'` → unrestricted contract scope (`myContractIds = null`).

### Date Handling

Use `normalizeDate(date)` from `src/lib/utils.ts` whenever reading a date field from Firestore — it handles `string | Date | Timestamp` uniformly and returns `YYYY-MM-DD`. Only convert to a locale string at display time.

### Contracts as Cost Centers

`transactions.costCenterId` stores the contract ID for IPC, purchase invoices, and custody settlements. Use this field to filter GL data by contract. Reports module exposes a contract selector that appears automatically when a project with multiple contracts is selected.

## Coding Rules (enforced from review)

### Firestore Listeners — Local Backend Safety

- **Never import `onSnapshot` directly in components.** Always use `listenQuery` / `listenDoc` from `src/lib/firestoreListen.ts`.
- In `VITE_DATA_BACKEND=local` mode, `listenQuery`/`listenDoc` perform a one-time `getDocs`/`getDoc` call and return a no-op unsubscribe. This prevents WebSocket connections to Firestore that cause `FIRESTORE INTERNAL ASSERTION FAILED: Unexpected state` crashes in local development.
- `useFirestoreQuery` with `mode: 'snapshot'` already routes through `listenQuery` internally — no extra action needed when using that hook.
- Raw `useEffect + onSnapshot` (without the wrapper) is still allowed **only** when the component is never used in local dev mode; otherwise wrap it.

### React Hooks
- All `useState` / `useRef` / `useMemo` / `useCallback` declarations must appear at the **top** of the component, before any function definitions. Never declare a hook after code that references its setter.
- **Prefer `useFirestoreQuery`** over raw `useEffect + onSnapshot/getDocs` for all Firestore reads. It handles cleanup, error reporting, and loading state automatically:
  ```ts
  // Realtime listener
  const { data, loading } = useFirestoreQuery<MyType>(
    () => query(collection(db, 'col'), where('x', '==', val)),
    [val],
    { mode: 'snapshot', collectionName: 'col' },
  );
  // One-shot read (reference data)
  const { data } = useFirestoreQuery<MyType>(
    () => query(collection(db, 'col'), where('isDeleted', '==', false)),
    [],
    { mode: 'once', collectionName: 'col' },
  );
  // Conditional — pass null to skip
  const { data } = useFirestoreQuery<MyType>(
    () => contractId ? query(...) : null,
    [contractId],
  );
  ```
- Only use raw `useEffect + onSnapshot` when you need side effects beyond `setData` (e.g. auto-selecting the first item from results).
- Every raw `onSnapshot(query, callback)` must still include an **error callback** as the third argument:
  ```ts
  onSnapshot(q, (snap) => { ... }, (err) => handleFirestoreError(err, OperationType.READ, 'collection'));
  ```
- Never call `handleEntryChange` twice from the same `onChange` handler (React stale-closure batching drops the first call). Handle related side-effects inside `handleEntryChange` itself.

### Financial Precision
- **Money (EGP):** **2 decimal places** — `src/lib/money.ts` + `server/src/lib/money.ts`. `roundMoney()` / `roundDecimal2` on post/save (`journal.ts`, `accountingService.createTransaction`, OHA, invoices…). Display via **`formatMoney()`** / `useLanguage().formatMoney` (always `0.00`). Balance tolerance **`MONEY_TOLERANCE = 0.005`**. Money inputs use **`step="0.01"`** on invoice/fixed-asset amount fields. **Never** use `formatMoney(0)` as `Array.reduce` initial value — sum numbers first, then `formatMoney(total)`.
- **Quantities (BOQ, consumption, inventory, MOS, IPC):** same **2 decimal places** — `formatQuantity` (max 2, no forced trailing zeros) · `roundQty` / `QTY_EPSILON = 0.01` in `consumptionAllocation` (client+server). Inputs use **`step="0.01"`**. Do not reintroduce milli (0.001) rounding.
- **Purchase / fixed-asset / inventory GL:** `buildPurchaseWithholdingJournalLines()` in `accountingService.ts` — Dr (base+VAT) · Cr WHT · Cr supplier where **supplier = round(base+VAT) − round(WHT)** so debits equal credits (avoids independent rounding per leg).
- **`createTransaction`** drops journal lines with both `debit` and `credit` ≤ 0 before balance/COA validation (e.g. WHT line when `whtAmount === 0`). Do not post zero-amount placeholder lines.
- All IPC percentage back-calculations must guard against `worksValueExVat === 0` using a safe division helper — never divide directly and rely on `|| fallback` (which misses `NaN`):
  ```ts
  const safePct = (num: number, denom: number, fallback: number) =>
    denom > 0 ? (num / denom) * 100 : fallback;
  ```
- Billing default rates are in `src/constants/billingDefaults.ts` (`BILLING_DEFAULTS`). Never hardcode `14`, `10`, `1`, `5`, or `0.03` inline.

### Account Code Generation
- Supplier `chart_of_accounts` entries must use **8-digit sequential codes** under `parentCode: '21101'` for suppliers or `parentCode: '21102'` for subcontractors (e.g. `21101002`, `21101003`…, `21102002`…). Never use `Math.random()` to generate account codes — it produces duplicate and non-compliant codes.
- Every `chart_of_accounts` entry created for a supplier must include a `supplierId` field linking back to the supplier doc.
- Always use `AccountCodes` enum constants — never hardcode account code strings.
- When recording purchase invoices / subcontractor IPCs from **`ActualCosts`**, resolve the creditor from the **selected COA account document** (`id` → `accountCode` / names). Pass **`supplierAccountCode`** into **`recordPurchaseToProjectInventory`** (invoice tab) or **`recordSubcontractorIPC`** (IPC tab). Fallback to generic **`AccountCodes.SUPPLIERS` / `AccountCodes.SUBCONTRACTORS`** only if no specific code is provided. Other modules may still link `suppliers` collection `id` to COA via `supplierId` when present.
- Missing standard leaf codes (e.g. **`21402001` WHT_PAYABLE**) are auto-inserted from **`CHART_OF_ACCOUNTS_SEED`** on first journal post failure; `invalidateCoaCache()` runs after patch. User can still run Settings → **إكمال الحسابات الناقصة** for a full seed sync.

### Soft Deletes & Batching
- All deletions must use `isDeleted: true` (soft delete). Never call `deleteDoc()` directly on user data.
- Bulk soft-deletes (e.g. clear BOQ) must use `writeBatch`, chunked at 500 ops. Never use `Promise.all(docs.map(deleteDoc))`.
- Any operation writing to more than one collection must use `writeBatch`.

### Authentication Guard
- Before any Firestore write in `accountingService.ts`, assert `auth.currentUser` is not null **when not in local backend mode** (`assertJournalWriteAuth()`). In **`VITE_DATA_BACKEND=local`** (Railway/Electron password login), journal posting uses **`glApi`** with Express session cookie — **do not** require Firebase `auth.currentUser` on the client.

### Firestore payloads — no `undefined`
- Firestore rejects **`undefined`** on any field (unlike `null` or omitting the key).
- **`transactions`:** **`createTransaction`** (and journal `updateDoc` paths in `accountingService.ts`) use **`sanitizeTransactionFirestoreData()`** so optional **`projectId`** / **`costCenterId`** and optional entry-line fields are **omitted** when unset.
- **`purchase_transactions`:** **`ActualCosts.tsx`** uses **`mapInvoiceLineForPersistence()`** for `invoiceLines` (and SQLite lines) — never set `boqItemId: … \|\| undefined`; use conditional spread or omit the key.

### Type Safety
- Never use `any` in hot-path loops (transaction/entry iterations in `Dashboard.tsx`). Use `Transaction` and `JournalEntry` types from `src/types.ts`.
- `createdAt` fields in Firestore docs must be typed as `Timestamp | Date | string`, not `any`.

### i18n
- No hardcoded Arabic or English strings in JSX. Always use `t('key')` from `useLanguage()`.
- **Operations manual**: all guide copy uses **`manual_*`** keys in `LanguageContext.tsx` (both ar/en). After adding topics, run **`npm run test -- src/lib/operationsManual.test.ts`**.
- No inline `language === 'ar' ? '...' : '...'` ternaries for translatable text. Move to translation maps.
- Locale string (e.g. `'ar-EG'`) must come from `LanguageContext` (`locale` field) — never hardcoded.
- `LanguageContext` must log `console.warn` for missing translation keys in dev (never silently return the raw key in production).

### Theme & User Preferences
- **Persistence API**: use **`saveUserPreferences()`** from **`src/lib/userPreferences.ts`** — local: `settingsApi.patchUserPreferences` (Express session); cloud: Firestore `users/{uid}`. Gate writes with **`canPersistUserPreferences()`** (`isLocalBackend || auth.currentUser`) — **password/Electron login has no Firebase user** but session cookie is enough in local mode.
- **Theme persistence**: `setTheme()` in `LanguageContext` writes to `localStorage` immediately AND is called by **`GeneralSettings.handleThemeChange()`** which also writes `defaultTheme` via **`saveUserPreferences`**. On login, `App.tsx` reads saved theme. `Settings.tsx` no longer handles theme changes.
- **Language persistence**: Sidebar/TopNav toggle → **`persistLanguagePreference()`** → `defaultLanguage` on server/Firestore.
- **Default startup module**: **`NONE_DEFAULT_MODULE = 'none'`** in `constants/modules.ts`. Use **`resolveSavedDefaultModulePreference()`** on login — **do not** `startup.moduleId ?? DEFAULT_MODULE` (that broke «empty desktop»). Emit **`USER_PREFS_UPDATED_EVENT`** after save; listener in **`App.tsx`** must be declared **after** `userPermissions`, `userRole`, `defaultModuleRef` (TDZ — production crash if reordered).
- **Default theme** for new / unauthenticated sessions is `soft` (set in `readSaved()` fallback in `LanguageContext`).
- **Never call `setTheme('dark')` hardcoded** anywhere — always use the persisted value.
- **`onAuthStateChanged` in `App.tsx` must not list `language` in its deps array.** Use `languageRef` (a `useRef` kept in sync by a separate `useEffect`) inside the auth callback to read the current language for toast messages — this prevents the Firebase listener from being torn down and rebuilt on every language switch (which would re-trigger the default-module open logic and reset window state).
- **Shell window policy:** never reintroduce multi-module stacks (minimize-previous-on-open) for primary modules. Use **`shellWindowPolicy.ts`** helpers; opening module B must **close** module A in all themes. Calculator is the only coexist exception.

### Performance
- Expensive derived values (chart data, maps, totals) must be in `useMemo`. `onSnapshot` callbacks should only call `setState` — no computation inside.
- `contractsMap` and `projectsMap` in `GeneralLedger.tsx` must be wrapped in `useMemo`.
- `useCallback` is required for event handlers passed to table row components to prevent full-table re-renders.

### Firebase Config
- **Production / `vite build`:** required `VITE_FIREBASE_*` variables must be set (see `web-cost-app/.env.example`). Missing vars throw at startup.
- **`vite` dev (`npm run dev`):** if `VITE_FIREBASE_*` are empty, `firebase.ts` falls back to **`firebase-applet-config.json`** so local runs work without copying `.env`. Prefer explicit `.env` for a non-applet Firebase project.

### Performance (listeners & rendering)
- **`src/constants/dataLimits.ts`** — central caps (`limit(...)`) on high-volume **`onSnapshot`** queries (Reports, ActualCosts—including GL subset for custody, LiquidityReport, Purchases file, Dashboard transactions). Larger orgs tune these numbers trade-off: **speed vs. full history on screen**.
- **Dashboard** additionally caps **`transactions`** with UI notice when the cap may skew aggregates.
- **Language context** avoids new object/function identity each render (`useMemo` + `useCallback` for context value / `t`).
- **Charts / motion:** keep derived data in **`useMemo`**; avoid heavy work inside snapshot callbacks (only **`setState`**).

---

## Workflow

```
feature branch → PR → /review → merge to main
```

- Always run `npm run lint` (and **`npm run test`** when touching `accountingService` or regressions).
- Golden paths after changes: create IPC, **purchase invoice via Actual Costs** (GL + SQLite stock + **row click preview**), **subcontractor IPC draft → submit → PM approve** (GL on approve), **custody settlement draft → submit → accounting approve** (GL on approve), **consumption order** (BOQ + expense account + GL `CON-…`), **return** (same expense as `CON-…`, GL `RET-…` without double prefix; visible in **Issues & Returns** tab), GL journal, **received cheque ISS+CLR**, Dashboard + Liquidity totals, capped reports if relevant, **OHA close preview** (pool = allocated per account).
- When touching **operations manual** topics or `manual_*` i18n keys, run **`npm run test -- src/lib/operationsManual.test.ts`** (61 topics · ar/en key coverage · permission gates).
- When touching **offline sync** (`src/lib/offline/*`, idle gate, Idempotency), run **`npm run test -- src/lib/offline/offline.test.ts src/lib/operationsManual.test.ts`**.
- When touching **shell / window navigation** (`App.tsx`, `Sidebar`, `TopNavBar`, `shellWindowPolicy.ts`), run **`npm run test -- src/lib/shellWindowPolicy.test.ts`** and golden-path **general settings → main module** in dark + ERP.
- When touching **user preferences / default module / GeneralSettings**, run **`npm run test -- src/lib/shellNavigation.test.ts`** and verify theme + `none` persist after reload.
- When touching **Settings admin sections** or ERP settings sub-menus, run **`npm run test -- src/lib/moduleViewPermissions.test.ts`**.
- **Documentation:** after successful fixes, update **`CLAUDE.md`**, **`CONTEXT.md`**, **`DEPLOYMENT_PLAN.md`**, **`docs/DEVELOPER_GUIDE.md`**.
- When touching **money rounding** or **OHA**, run **`npm run test -- server/src/lib/money.test.ts server/src/accounting/overheadAllocation.test.ts`**.
- After **consumption / multi-BOQ allocation** changes, run **`npm run test:consumption`** and **`npm run local:verify-postgres`** (checks multi-line CON GL when data exists). Plan: **`docs/CONSUMPTION_MULTI_BOQ_PLAN.md`**.
- Firestore index changes require `firebase deploy --only firestore:indexes`
- **Emulators:** `firebase.ts` currently does **not** call `connectFirestoreEmulator` / `connectAuthEmulator`. `VITE_USE_EMULATORS=true` only selects the no-persistence Firestore initialization path; add explicit emulator connectors before assuming reads/writes go to local emulators.

## Firebase Emulators

With **`VITE_USE_EMULATORS=true`**, persistence uses **`getFirestore`** (no IndexedDB persistence) per `firebase.ts`, but the app still needs explicit `connect*Emulator` calls before it talks to local emulators. Emulator UI is typically **`http://localhost:4000`** when started via the Firebase CLI.

## Offline Persistence

Firestore offline persistence is enabled in production via `initializeFirestore` with `persistentLocalCache + persistentMultipleTabManager` in `src/firebase.ts`. This allows users to review cached data during connectivity loss.

- **Emulators**: persistence is intentionally disabled (emulators don't support IndexedDB) — `getFirestore` is used instead when `VITE_USE_EMULATORS=true`.
- **Multi-tab**: supported — all open tabs share the same IndexedDB cache.

## General Ledger — Journal & Statement Filters (2026-06-19)

**No auto-load:** journal and account statement **do not fetch** until user clicks **Apply filters**. Separate filter state per sub-tab (`journalTab` / `statementTab` in **`GeneralLedger.tsx`**).

| Piece | Role |
|-------|------|
| **`JournalFilterPanel.tsx`** | Date from/to · projects (multi) · account from/to · Apply / Reset |
| **`useFilteredGlTransactions.ts`** | Firestore query or **`glApi.transactionsQuery()`** when filters applied |
| **`journalFilters.ts`** | Validation · client-side project/account/date refine · **`normalizeGlTransactionDates()`** |
| **`server/src/modules/gl.ts`** | `GET /api/gl/transactions?dateFrom&dateTo&projectIds&accountFrom&accountTo&limit` |
| **`GLAccountStatement.tsx`** | Account picker + period from applied filters; one row per matching entry line — columns: date · **journal reference** · description · counterpart · cost center · Dr/Cr · running balance |

**Account range pickers:** **from / to** = **`SearchableSelect`** via **`chartLeafAccountOptions()`** — active **8-digit leaves only** (`isChartLeafAccount`). Empty = «— الكل —». Statement account picker uses same helper.

**Date filtering (critical):** filter inputs are **`YYYY-MM-DD`**; stored tx dates may be ISO datetime or Firestore Timestamp. Always compare via **`journalDateKey()`** / **`isJournalDateInRange()`** — never raw string `tx.date >= dateFrom`. API/Firestore queries use **`journalDateQueryUpperBound(dateTo)`** (`{dateTo}\uf8ff`) so same-day ISO rows are included. Server normalizes `date` on response.

**COA location:** tree editing moved to **Settings → تهيئة شجرة الحسابات** (`ChartOfAccountsSettingsPanel.tsx`, `ledger.view`). **`GeneralLedger.tsx`** no longer embeds COA tab — still loads COA for pickers/statement.

**Journal list (`GLJournalEntries`):**
- Default **`transactionLimit` = 50** (journal tab) · statement tab **5000** — «تحميل المزيد» adds 50 on journal.
- **`VITE_DATA_BACKEND=local`:** **`glApi.transactionsQuery` only** — no Firestore merge.
- **Sort:** by **`createdAt` desc** (وقت الإدخال) then date — API `orderBy` + `sortJournalByEntryTime`.
- **Posting date (إثبات):** manual JV / reverse / undo use **`stampBusinessToday`** → server **`Africa/Cairo`** via `GET /api/gl/business-today` (`BUSINESS_TIMEZONE`) — not the device clock. Date field is read-only.
- After **new entry / reverse / undo reversal**, `onJournalChanged` bumps `refreshKey`.
- **Line-level cost centers:** use **`resolveEntryCostCenterLine()`** per journal line in `GLJournalEntries` and **`GLAccountStatement`**.

**Account statement rows (2026-08-01):** the statement is a **movement list for one account**, never the full journal. One row per matching **entry line** (a journal may contribute several rows, e.g. payroll split by cost center). **الحساب المقابل** = **opposite side only** — `resolveCounterpartEntries(entries, code, accounts, language, resolveEntrySide(entry))` in **`glBilingual.ts`**. Omitting the `side` argument keeps the legacy «all other accounts» behaviour and must **not** be used for statements: multi-line journals (payroll accrual, `YE-PL-*` income close) would list same-side expense accounts as counterparts. Same rule in **`BankAccountStatementPanel`**.

**Tests:** `npm run test -- src/lib/journalFilters.test.ts src/lib/chartOfAccountsPicker.test.ts src/lib/glBilingual.test.ts`

**Do not regress:** removed fiscal-year-only selector — date range is entirely from filter panel.

## Reports (`Reports.tsx`)

Shared helpers at top of file: `INVENTORY127_AGG_CODE` (= `PROJECT_WAREHOUSE_PARENT` from `src/lib/projectWarehouse.ts`), `aggregateTrialBalanceInventory127`, `splitNetToDebitCredit`. **Money display:** `formatMoney` from `useLanguage()` — project/BOQ **footer totals** via `useMemo` sums (`totalBoqValue`, `totalBoqEstimatedCost`, `totalVoValue`, …) then `formatMoney(total)`. **`costCenterCostSplit.ts`** must import `resolveEntryCostCenterId` from `costCenterAttribution.ts` (used by income/indirect split). **Default tab:** `income` (legacy `overview` deep-links normalize to income).

### Filters

- **Trial balance** and **income statement (GL P&L)** respect **project** + **contract** selectors.
- **Income statement** (`Reports` tab `income`): structure mirrors P&L close — **Revenue `4…`** − **Contract costs `51…`** = **Gross profit on contracts** − **G&A `52…`** (− **Finance `53…`** if any) = **Profit before tax**. No top KPI cards. **Statement mode** = section totals; **analytical** (`showAnalytical`) = leaf lines + project breakdown + cost-center split footnote.
- **IS excludes `fiscal_pl_close` / `YE-PL-*`** via `isExcludedFromIncomeStatement` (keep those journals on BS/TB so equity/closing stay correct). Project filter: `projectId` **or** cost center on a contract of that project (`transactionMatchesProjectFilter`).
- **Income statement leaf rows** (`buildIncomeStatementLeafBalances` / `buildIncomeStatementTotals` in `src/lib/incomeStatementGl.ts`): sum **every** journal line per account code — never `.find()` one line per transaction (payroll / OHA split the same `521…` across cost centers). Tests: `src/lib/incomeStatementGl.test.ts`.
- **Balance sheet** is **company-wide** (all non-deleted `transactions` in scope; not filtered by project/contract UI).

### Budget vs actual (الميزانية vs الفعلي) — tab `'budget'`

- **BOQ (بيع)** = `Σ tenderAmount` (سعر الوحدة × الكمية **بعد** OH + **ربح المقاول**).
- **تكلفة تقديرية (BOQ)** = `Σ tenderAmountExcludingProfit(item)` من **`src/lib/boqPricing.ts`** — (مواد+عمالة+معدات) × OH **بدون** ربح؛ أو عند غياب تفاصيل الـ rates في Postgres: `unitRateTotal ÷ (1 + profit%) × qty` مع **`BOQ_DEFAULT_PROFIT_PCT = 12`**.
- **ميزانية التكلفة** = تكلفة تقديرية + VO (VO على صفوف **المشروع** فقط). **لا** تستخدم `boqValue` كبديل للتكلفة.
- **مستويات التحليل:** مشروع · عقد · بند BOQ — [`BudgetVsActualReport.tsx`](src/components/reports/BudgetVsActualReport.tsx) · [`budgetVsActual.ts`](src/lib/budgetVsActual.ts).
- **عرض/طباعة:** صفحات **A4 أفقية** منفصلة (`.bva-sheet` + `data-multipage`) · كثافة **normal** · الإجماليات في آخر صفحة فقط.
- **الفعلي (local):** كل المستويات من **`GET /api/reports/boq-cost-breakdown`** (= `boq_actual_costs`: صرف · مصروف عقد · باطن · عهدة · OHA) — نفس مصدر تبويب تكاليف BOQ. **لا** GL كامل (يتأثر بإقفال الدخل / مصروف غير مربوط ببند).
- **Tests:** `npm run test -- src/lib/budgetVsActual.test.ts src/lib/boqPricing.test.ts`

### Trial balance (ميزان المراجعة)

- **`periodStart`** splits opening vs in-period movements; closing = opening + movements.
- All **`127…`** leaf accounts are **rolled into one row** (code **`127`**, label *مخزون المشاريع*). Individual `12701001`, etc. do not appear.
- **Closing balances** on that row: **net only** — `closingNet = Σ closingDebit − Σ closingCredit`, then one side (Dr or Cr) via `splitNetToDebitCredit`. Opening/movements still show separate Dr/Cr column totals.
- **Account type analysis** counts the `127` aggregate once under assets (not per leaf).
- Entry matching uses `String(accountCode).trim()`.

### Balance sheet (الميزانية العمومية)

- **Presentation order** follows IFRS/Arabic: non-current assets → current assets; non-current liabilities → current liabilities → equity.
- **Charts** (`showCharts`) default `false`; **analytical** (`showAnalytical`) toggles leaf rows inside `BSGroup` prefixes — **not** for `127` (always one summary line).
- **Project inventory (`127`)**: single line under current assets (after `126`): net Dr/Cr from `netDebit('127')` — not per-project warehouse leaves.
- **Equity** = **prefix `3` only** (`311`–`314` groups incl. **`314`** partners' current / جاري الشركاء). **`totalEquity` does not include unclosed `4`/`5`** — period result stays on the **income statement** tab until closing to retained earnings (`313…`).
- **Balance check**: `totalAssets` vs `totalLiab + totalEquity`. If out of balance, a **footer note** (below working capital) shows the gap; when `|balanceGap − unclosedPeriodPl| < 1`, explains that the gap matches open revenue/expense accounts (not a loss in equity).
- Do **not** re-add `netProfitForBS` into equity totals to “force” balance — that misstates partner capital vs unclosed P&L.

### Print (طباعة) — نظام المستندات الموحّد (2026-07-31)

- **موديول التقارير:** زر الطباعة يبني **`ReportDocument`** عبر [`buildReportsModuleDocument`](src/lib/reportDocument/buildReportsModuleDoc.ts) ثم [`openReportDocument`](src/lib/reportDocument/openDocument.ts) — معاينة iframe + طباعة HTML نظيف + تصدير PDF (jsPDF/autotable). **لا** يستنسخ واجهة الشاشة.
- **بيانات الطباعة = الشاشة:** قائمة الدخل/الميزانية من GL (`buildAnalyticalPrintRows` + زر «التحليلي»)؛ الجدول الزمني من بنود BOQ؛ السيولة من `computeLiquidityContractRow` (جلب API عند الطباعة)؛ تكاليف BOQ مع totals + فصل/قسم على مستوى البند.
- **PDF (Electron):** `print-report-pdf` IPC → Chromium `printToPDF` + خط محلي من الجهاز (أولوية: **Calibri** ثم Segoe UI / Tahoma / Arial تحت Windows Fonts). المتصفح: حوار طباعة ثانوي فقط.
- **طباعة/PDF:** مستند `reportDocument` يقسّم الصفحات (`pageChunks` للميزانية بنفس عدد صفوف الشاشة؛ باقي التقارير حسب الكثافة) مع ترويسة/تذييل لكل ورقة · الكثافة تتحكم بحجم الخط · محاذاة الأرقام على الفاصلة العشرية (LTR + tabular) حسب لغة الواجهة · هوامش Electron `marginType: 'none'` ليتوافق مع `@page`.
- **إعدادات عامة → طباعة:** بيانات الشركة + رابط الشعار + نص التذييل فقط ([`PrintSettingsPanel`](src/components/settings/PrintSettingsPanel.tsx)) — **تصميم الطباعة بالكامل من شريط التنسيق**.
- **بقية الموديولات:** hook **`useReportDocumentPreview`** (`src/hooks/useReportDocumentPreview.tsx`) يفتح **`ReportPreviewDialog`** (`src/components/print/ReportPreviewDialog.tsx`) — معاينة + شريط تنسيق (`ReportFormatToolbar`) + طباعة + PDF + **حفظ التصميم** لكل تقرير عبر **`reportPrintProfilesPersistence.ts`** (local `settingsApi` أو Firestore `company_info.reportPrintProfiles`).
- **شهادات/مستندات:** **`buildCertificateDocs.ts`** — `buildIpcCertificateDocument` · `buildMosCertificateDocument` · `buildVoCertificateDocument` · `buildCustodySettlementSections` تبني مستندات **أقسام** (`sections`: `keyValue` · `table` · `summary` · `signatures` · `note` في `types.ts`؛ ترسمها `renderHtml.ts` مع تقسيم صفحات للجداول المتدفقة).
- **hooks الطباعة القائمة** (`useIpcPrintPreview` · `useMosPrintPreview` · `useVoPrintPreview`) تحتفظ بتوقيع `requestPrint` نفسه لكنها تبني مستند شهادة وتفتحه في `ReportPreviewDialog` داخلياً.
- **المسار القديم حُذف نهائياً (2026-07-31):** لا `printReport.ts` / `triggerReportPrint` / `useReportPrintPreview` / استنساخ DOM، ولا CSS `.report-print-clone` / `body.report-print-mode` / `.report-print-preview-*`، ولا مكتبات **`html2pdf.js` / `jspdf` / `jspdf-autotable`**. لا تستدعِ `window.print()` مباشرة على DOM النافذة — ابنِ `ReportDocument` وافتح المعاينة.

#### Per-report print designs (2026-06-16)

- **`src/lib/reportPrintProfiles.ts`** — single source for print layout. `ReportPrintProfile = { orientation, pageSize (A4/A3), density (compact/normal/comfortable), accent (hex), showHeader, showFooter, … }`.
  - **Built-in tailored defaults** (`REPORT_PRINT_DEFAULTS`): wide tabular reports (`trial`, `costs`, `time`) → **landscape + compact**; **`budget`** → **landscape + normal** (A4 multipage sheets); statements (`income`, `balance`, `liquidity`) → **portrait + normal**.
  - **`resolveReportPrintProfile(stored, id)`** merges company overrides over defaults.
  - **Edit location:** **Reports → format toolbar** only. General Settings Print = company name/address/tax/logo/footer text (preserves stored `reportPrintProfiles` on save).
- **Print letterhead logo**: default **`/branding/logo-print.svg`** (`company_info.headerLogo`); company fields in General Settings. **`PrintReportHeader.tsx`** for single-page reports; **Budget vs Actual** embeds letterhead per sheet.
- **Print footer text**: `company_info.footerText` / `footerTextEn` — General Settings. Defaults in `Reports.tsx` / `Billing.tsx`.

### BOQ cost breakdown (تكاليف BOQ) — tab `'costs'` (2026-06-15)

**Local / Postgres only** (`isLocalBackend`). UI: **`src/components/reports/BoqCostBreakdownReport.tsx`** embedded in **`Reports.tsx`**.

| Filter / option | Behavior |
|-----------------|----------|
| **Project** | Header selector (`all` or one project) |
| **Contract** | Shown on costs tab even when project = `all` (all scoped contracts) |
| **Date range** | Optional `dateFrom` / `dateTo` on `boq_actual_costs.recorded_at` |
| **Detail level** | `project` · `contract` · `boq_item` |

**Data source:** `boq_actual_costs` aggregated server-side — **`GET /api/reports/boq-cost-breakdown`** (`server/src/lib/boqCostBreakdown.ts` · `reportsApi.boqCostBreakdown`). Permission: **`reports`**.

| `cost_element` | Source | Report column |
|----------------|--------|---------------|
| `materials` | Consumption confirm | **Direct** |
| `other` | Contract expense → BOQ confirm | **Direct** |
| `subcontractor` | Subcontractor IPC **approve** (`currentQty×rate`, ex-VAT) — **report only, GL unchanged** | **Direct** |
| `custody` | Custody settlement **approve** when line has optional `boqItemId` — **report only** | **Direct** |
| `overhead` | OHA close → `postBoqLoadingForContractAllocation` | **Allocated indirect** |

**Not included:** warehouse `127…` before consumption · custody lines without BOQ · payroll/G&A not allocated to BOQ — those stay in income statement / GL / Dashboard. Dashboard `spent-by-contract` sums **`materials` only** (avoids double-count with GL class-5).

**Tests:** `npm run test -- server/src/lib/boqCostBreakdown.test.ts`

**Dev:** Tab sets **`needTx = false`** (no GL listener). **`404`** on this route after adding server code usually means **stale API on :3001** (`EADDRINUSE` during `dev:local`) — kill the old process and restart `npm run local:api`.

## BOQ — Rate breakdown persistence (Postgres) — 2026-06-28

- **`boq_items`** stores **`rateMaterials` · `rateLabour` · `rateEquipment` · `rateDirect` · `rateOverheadPct` · `rateProfitPct`** (migration `20260628120000_boq_item_rate_breakdown`).
- **`buildBoqApiPayload`** (`BOQ.tsx`) sends all rate fields on create/update/import — not only `unitRateTotal` / `tenderAmount`.
- **Firestore import** (`importFromFirestoreBackup.ts`) maps the same fields on upsert.
- **Recover lost breakdown** (Postgres rows with zeros): `npm run local:backfill-boq-rates -- path/to/backup.json` or `npm run local:backfill-boq-rates -- --live` (needs `FIREBASE_SERVICE_ACCOUNT_*`). Skips rows that already have non-zero rates.
- **Reports** budget tab uses `tenderAmountExcludingProfit` — with stored rates, estimated cost no longer relies on default 12% alone.

## BOQ — Date Handling

- `startDate` in `boq_items` is stored as ISO `YYYY-MM-DD` string.
- Always use `normalizeDate(item.startDate)` from `src/lib/utils.ts` before any date arithmetic to avoid UTC timezone shifts.
- End date is calculated as: `new Date(sy, sm-1, sd + expectedDuration)` using local-midnight construction — never use `getTime() + ms` arithmetic on ISO strings.
- Work status has four states: **done** (≥99.9% progress), **not started** (start > today), **late** (end < today and not complete), **running** (in progress).
- **Excel import date handling**: `XLSX.read(data, { type: 'array', cellDates: true })` is required so dates are returned as `Date` objects. After reading, convert: if `instanceof Date` → `.toISOString().split('T')[0]`; if numeric (Excel serial) → `new Date(Math.round((n - 25569) * 86400 * 1000)).toISOString().split('T')[0]`.

## BOQ — Variation orders inline in table (2026-08-02)

- **UI:** VOs are **not** a separate panel below the table. After **original BOQ total**, each VO is a section (header + lines + VO subtotal), then **grand total** (`live boq_items` + draft/submitted VO net).
- **Original rows:** exclude items whose id is a VO line `createdBoqItemId` (those appear under their VO section).
- **Component:** `VoOrdersPanel` with `inline` prop renders `<tbody>` fragments inside `BOQ.tsx` table; workflow actions (submit/approve/print) stay on the VO section header.
- **i18n:** `boq_original_total` · `boq_grand_total` · `vo_inline_section_title` · `vo_section_total`.

## BOQ — Item Form (`BOQItemFormModal.tsx`)

The add/edit item modal uses **cascading dropdowns** driven by `existingItems` (the current contract's BOQ items passed as a prop):

1. **Chapter code** → dropdown of unique chapters from existing items + "➕ فصل جديد". Selecting fills `chapterName` automatically.
2. **Work Type code** → filtered by selected chapter + "➕ نوع عمل جديد".
3. **Section code** → filtered by chapter + workType + "➕ قسم جديد". Selecting fills `sectionName` automatically.
4. **Item code** → auto-suggested as the next sequential code within the selected section (increments the last numeric segment of the highest existing `itemCode`). User can override.
5. Choosing "➕ جديد" shows inline text inputs for the new code/name — these are resolved into `formData` at submit time.

**`onSubmit` signature**: `(e: React.FormEvent, resolved: FormData) => void` — the modal passes the fully-resolved `FormData` (with "new" values substituted) as the second argument. `BOQ.tsx → handleSubmit` accepts this as `resolvedData` and uses it instead of stale component state.

## Actual Costs Module

`ActualCosts.tsx` consolidates purchase/subcontractor/custody flows plus **indirect cost entry** (local only). **Tabs + “فاتورة جديدة” / “مستخلص جديد” / “تسوية عهدة جديدة”** sit in **one row**. **Invoice and IPC table rows are clickable** — open the modal for preview; posted documents (`transactionId` set) are **read-only**.

| Tab | `type` value | Description |
|-----|-------------|-------------|
| فاتورة مشتريات | `invoice` | Purchase invoice — **آجلة** (Cr **21101…** مورد) أو **نقدية** (Cr **12102…** عهدة/صندوق) عبر `paymentType` · **Local:** atomic **`POST /purchase-transactions/post-invoice`** (GL + list row + warehouse stock) via `purchaseTransactionsApi.postInvoice` — **do not** split `glApi.createTransaction` then `create`. **Cloud:** `recordPurchaseToProjectInventory()` / fixed-asset / indirect helpers. Toggle **«تسجيل كأصل ثابت»** → Dr **11…**. **Lines:** multi-material + multi-BOQ (`boqItemIds[]`). |
| مستخلص مقاول | `ipc` | Subcontractor IPC — **`draft` → `submitted` → `approved`**; GL **`POST /api/purchase-transactions/:id/approve`** only (admin / projects_manager); on approve also writes **`boq_actual_costs`** (`subcontractor`, period `currentQty×rate`) for reports — **no GL change**; journal preview via **`JournalPreviewModal`** |
| تسوية عهدة | `custody` | **`<GLCustodySettlement>`** — list + modal; optional per-line **BOQ** (`boqItemId`) for reports; numbering **`SET-{projectCode}-0001`**; **`draft` → `submitted` → `approved`**; GL on approve only; optional `boq_actual_costs` (`custody`) on approve when linked |
| مصروف غير مباشر | `indirect` | **local:** Dr expense / Cr creditor via **`createTransaction`**; **`costCenterId`** = indirect center (`GET /api/cost-centers?type=indirect`) |
| مصروف عقد + BOQ | `contract_expense` | **local:** contract expense split across BOQ items → **`contractExpenseOrdersApi`** confirm posts GL `CEX-…` + **`boq_actual_costs`** |

- Invoice / IPC saves write **`supplierAccountId`** (COA doc id) plus **`supplierId`** when linked to **`suppliers`**. **`supplierName`** resolves from supplier directory names or COA labels.
- **Custody tab** writes **`custody_settlements`** via **`custodySettlementsApi`** — **not** direct `accountingService.createTransaction` on save. GL posted server-side on **`POST /api/custody-settlements/:id/approve`** via **`postCustodySettlementJournals`** (`custodySettlementJournal.ts`).
- **`GLCustodySettlement`** receives `accounts`, `contracts`, `canApproveSettlement` (`isAdmin || can('ledger').create`), optional **`initialOpenId`** (notification deep-link). Items group by **`contractId`** into balanced postings with **`costCenterId`**.
- **Custody account picker (“اختر العهدة”)** lists **active leaf** accounts whose codes **`startWith('12102')`** and are **8 digits** (branch **الصناديق / cash on hand** under parent **`12102`**). **`AccountModal`** for new custody accounts uses **`defaultParentCode="12102"`** — not `12203` (شيكات برسم التحصيل).
- **Notifications:** `subcontractor_ipc_pending` · `custody_settlement_pending` — **`NotificationBell`** deep-links to Actual Costs tab + document id (`shellNavigation` pending ids).

### Purchase invoice — end-to-end (`isLocalBackend`)

1. **Payment type:** آجلة → pick supplier leaf **21101…**; نقدية → pick custody/cash leaf **12102…** (8-digit active). Stored as `paymentType` (`credit`|`cash`); cash invoices set `supplierId: null` and credit the chosen 12102 account in GL.
2. Validate: warehouse account (**127** 8-digit), creditor per payment type, at least one line; **each line must have `materialCategoryId`** (materials tree) when local backend is on.
3. **BOQ link UI:** optional multi-select checkboxes per line (`boqItemIds`). Filter = `invoiceBoqItems`: if `costCenterId` → that contract’s BOQ; else if warehouse selected → BOQ for warehouse’s `projectId`; else scoped list. Selecting BOQ **must not** copy BOQ description/unit/rate onto the line — material fields stay from materials tree + user qty/cost.
4. **Firestore GL:** `recordPurchaseToProjectInventory` → `transactions` doc (`transactionId` stored on `purchase_transactions`).
5. **Firestore doc:** `purchase_transactions` with `invoiceLines` (via **`mapInvoiceLineForPersistence`** — no `undefined` fields; may include `boqItemIds`), `warehouseAccountId`, `inventoryAccountCode`, `projectId`; `description` defaults to `''` if empty.
6. **SQLite:** `sqliteCoreApi.createDistributedPurchaseInvoice` with `status: 'confirmed'`, `projectId`, `vatPct`, lines (`materialCategoryId`, qty, unit cost). Server posts **`project_inventory`** (weighted avg incl. VAT). Requires **`projects.id`** FK — frontend calls **`ensureLocalProjectExists`** (mirror from Firestore if missing) before POST.
7. **On SQLite failure:** soft-delete `purchase_transactions` + delete GL `transactionId`; modal stays open; user sees error (no “saved but sync failed”).
8. **On success:** `toast.success`, close modal, refresh inventory snapshot banner when applicable.

**Do not** use legacy `recordPurchaseInvoice()` (expense Dr) for the invoice tab — inventory goes to **127…**, not class-5 expense.

### Fixed asset purchase invoice (toggle «تسجيل كأصل ثابت»)

1. **UI:** payment type (آجلة/نقدية) · creditor (**21101…** or **12102…**) · **asset account** (`SearchableSelect` — active **11…** 8-digit leaves) · auto-filled account name · **amount ex-VAT** · VAT % · WHT % · optional cost center. **No** material lines / project warehouse when toggle is on. Mutually exclusive with **indirect** cost center on same form.
2. **GL:** `recordFixedAssetPurchase()` → `buildPurchaseWithholdingJournalLines` (Dr **11…** incl. VAT · Cr supplier or custody net · Cr WHT).
3. **Local:** `fixedAssetsApi.create` with `status: 'pending_setup'` after purchase header saved — complete depreciation accounts in **`FixedAssets.tsx`** modal.
4. **Auth (Railway/password):** journal posts via **`glApi`** + session cookie — **`assertJournalWriteAuth()`** does **not** require Firebase `auth.currentUser` in local backend mode.

### Fixed Assets module (`FixedAssets.tsx`)

- **Register tab:** list · import/export Excel · pending_setup badge · **Sync from GL** (`POST /api/fixed-assets/sync-from-gl`) for orphan Debits on `11…` cost leaves (excl. `119…`) → `pending_setup`.
- **Balance sheet vs register:** BS reads GL net on COA `11…`; register reads `fixed_assets` only — they can diverge until sync/create.
- **Bootstrap:** empty `fixed_asset_groups` → seed «وسائل النقل» on API start (`bootstrapFixedAssetGroupsIfEmpty`).
- **Asset modal (create/edit/setup):** group defaults · **`SearchableSelect`** for **119…** accum. depreciation · **52…** depreciation expense · **cost center** (contracts + indirect via `buildCostCenterSelectOptions`); account names auto-fill from COA; cost center type derived from picker (direct/indirect).
- **Depreciation tab:** quarterly run + posted history.
- **Permissions:** `project_accountant` has `assets` CRUD so Actual Costs fixed-asset invoice can create the register row (not silent 403).
- **One-shot:** `npx tsx server/src/scripts/syncFixedAssetsFromGl.ts`

### Consumption order modal (`ConsumptionOrderModal.tsx` + `ConsumptionAllocationModal.tsx`)

Used from **`Inventory.tsx`** (project warehouse balance). **Multi-material + multi-BOQ** (2026-08-05):

1. Select **project + issue-to contract** on balance tab.
2. In the order modal: add materials to a **cart** — each material: total qty → **`ConsumptionAllocationModal`** BOQ split → add to cart.
3. One shared **expense account** on the order header for all materials.
4. Save flattens cart to `lines[]` (`materialCategoryId` + `boqItemId` + qty) → create + confirm (server GL).

**Legacy note:** multi-BOQ allocation per material remains; multiple materials in one `CON-…` are now supported in UI (API already allowed it).

**Quick link (2026-07-24):** if no BOQ links for the material and role is `admin` | `projects_manager` | `project_accountant`, show **ربط فوري** → **`QuickLinkMaterialModal`**. Load candidates with **`boqApi.list(\`?projectId=${projectId}\`)`** — **never** `boqApi.list(contractId)` (that becomes `/boq-items{id}` → 404). No costs or selling prices in the modal.

### Return order modal (`ReturnOrderModal.tsx`)

Used from **Issues & Returns** tab. **Multi-line** (2026-08-05): select several returnable consumption lines (same project/contract), set qty each → create + confirm.

1. **`returnOrdersApi.returnable(lineId)`** per candidate — qty limits + expense from linked consumption.
2. Confirm on server posts stock + **`boq_actual_costs`** + **GL** (`returnInventoryJournal.ts`: Dr **127…** / Cr expense groups by CON account) — **no client `recordReturnToWarehouse`** after confirm (avoids double post).
3. **Journal reference:** `return_number` (`RET-…`) as-is.

### Issues & Returns tab (`ConsumptionHistory` in `Inventory.tsx`)

- Loads **`consumptionOrdersApi.list`** + **`returnOrdersApi.list`** (shared contract + status filters).
- Unified table: **صرف** (red qty) / **إرجاع** (blue row, shows `RET-…` and **from CON-…**).
- Multi-line consumption orders: **rowspan** on type / order # / date / status / contract; per-line BOQ + qty rows.
- **Return** on a row seeds that line; sidebar **إذن إرجاع متعدد** when a contract filter is set.
- **Print issue slip** (`consumption_order` print profile): button on order / sidebar → optional names (طالب الصرف · المستلم · أمين المخزن) → `buildConsumptionOrderSections` → `ReportPreviewDialog`.

## Cost Centers & Overhead Allocation (2026-06-15, updated 2026-06-17)

**Postgres/Prisma only** (`VITE_DATA_BACKEND=local`). **`cost_centers`** table: **`direct`** (mirrors contracts — `id = contract.id`) + **`indirect`** (service centers e.g. `HO-001`). **`transactions.cost_center_id`** FK → `cost_centers`. Optional **`journal_entries.cost_center_id`** for line-level attribution (OHA allocation journals). **`overhead_allocation_periods.included_indirect_center_ids`** (JSONB, migration `20260617120000`) — per closing period checkbox selection of which indirect centers to allocate (IFRS: exclude pure G&A e.g. HQ if not loaded to contracts).

| Area | Location |
|------|----------|
| Indirect center CRUD | **Settings** → `IndirectCostCentersPanel` · `GET/POST/PATCH/DELETE /api/cost-centers` |
| Indirect expense entry | **ActualCosts** tab `indirect` · `IndirectExpensePanel` |
| Contract expense → BOQ | **ActualCosts** tab `contract_expense` · `ContractExpensePanel` + `ContractBoqAmountModal` · `POST /api/contract-expense-orders` → confirm `CEX-…` |
| Quarterly overhead close | **Sidebar** module `overhead` · `OverheadAllocation.tsx` · `/api/overhead-allocation` |
| **Accounting period lock** | Same module → tab **قفل الفترة** · `PeriodLockPanel` · `/api/accounting-periods` — blocks GL create/update/soft-delete in locked quarter unless user ∈ `allowedUserIds` |
| Line-level report filter | `src/lib/costCenterAttribution.ts` · `operatingExpenseFromGl.ts` · `costCenterCostSplit.ts` · `Reports.tsx` |

**Accounting period lock (2026-07-26):**

- **Model:** `AccountingPeriodLock` (`accounting_period_locks`) — separate from OHA cycles. Status `locked` \| `open`. Quarterly ranges (`Q1-2026` …).
- **Enforcement:** `assertPeriodUnlocked` in `createTransaction` / `updateTransaction` ([`server/src/accounting/journal.ts`](server/src/accounting/journal.ts)) + soft-delete paths (GL DELETE, billing revert/delete, payroll reopen, OHA reopen). Actor = Express `req.user.id`; exempt if listed in period `allowedUserIds`. Scripts use `skipPeriodLock: true`.
- **Precondition to lock:** `assertNoOpenPlBalancesForPeriodLock(periodEnd)` — if any leaf `4…`/`5…` still has a net balance as of period end, lock returns **409** (`IncomeCloseRequiredError`); close income statement first.
- **API:** `GET/POST /api/accounting-periods` · `POST /:id/lock|unlock` · `PUT /:id/allowed-users` — lock/unlock/exceptions = **admin only**; list needs `ledger` or `overhead` reference read.
- **HTTP:** `PeriodLockedError` → **423** with Arabic message.
- **UI:** `ClosingType` includes `period_lock` · i18n `period_lock_*`.
- **Tests:** `npm run test -- server/src/accounting/periodLock.test.ts`

**OHA close — one GL transaction per indirect center** (not per expense account):

```text
Dr 51201001  costCenterId = contract-001  accountName = توزيع مصروفات ({مركز غير مباشر})
Dr 51201001  costCenterId = contract-002  (same label)
    Cr 52102001  pool  costCenterId = HO-001
    Cr 52103001  pool  costCenterId = HO-001
```

- **Reference:** `OHA-{periodLabel}-{centerCode}` e.g. `OHA-Q2-2026-HO-001` (legacy rows may still have `-52102001` suffix from pre-2026-06-17 closes).
- **Pool distribution:** `distributePoolAmounts()` — last contract gets rounding remainder; **`buildComputedPreviewLines`** must use it (not per-line `round(pool×ratio)`).
- **Review workflow:** editable proposed lines · save/reject · approval modal; `PUT/DELETE /periods/:id/proposed-lines`; validation `validateProposedLinesAgainstPools` with `MONEY_TOLERANCE`.
- **UI balance message:** `overhead_pool_balance_bad` → «القيم الموزعة لا تتساوى مع الإجمالي».
- **OHA journal date:** `resolveOverheadCloseJournalDate` — يوم الإغلاق مُثبَّت داخل `[periodStart, periodEnd]` (لا تؤرّخ إغلاقاً مبكراً لربع مفتوح بتاريخ `periodEnd` المستقبلي — كان يترك رواتب YTD في لوحة التحكم وائتمان OHA خارج الفلتر).
- Pool excludes prior `OHA-*` references. Default distribution basis: **revenue ratio** from billing (`LIQUIDITY_BILLED_STATUSES`). **Permissions:** `overhead` — admin/PM full; `project_accountant` view only. **Reopen** (admin): soft-deletes OHA journals + hard-deletes `boq_actual_costs`; **preserves prior allocation amounts as proposed drafts** (`transactionId = null`) via `snapshotClosedLinesAsProposed` so re-close without edits posts the same split when the live pool still matches; no reversal entries. Clear proposed lines in UI to force a fresh redistribute.
- **Dashboard «غير موزّع»:** مصروف بلا مركز عقد − ائتمان OHA داخل فلتر التاريخ. **إقفال الدخل / قفل الفترة لا يصفّران الصف** — فقط OHA.

**Tests:** `npm run test -- server/src/accounting/overheadAllocation.test.ts` · `npm run test:overhead` · `npm run local:smoke-overhead` · golden path checks in `local:verify-postgres` (cost_centers seed + OHA balance).

## Custody Settlement (2026-06-27)

**Entity:** `custody_settlements` (+ `custody_settlement_items` in Prisma) — migration **`20260627120000_custody_settlements`**.

| Stage | Who | GL |
|-------|-----|-----|
| **draft** | project_accountant / costs user | none |
| **submitted** | same — notifies accounting | none |
| **approved** | **admin** or **`ledger.create`** | **`postCustodySettlementJournals`** — one `gl_transactions` row per contract group |

- **Numbering:** `SET-{projectCode}-0001` (sequential per `projectId`; project code from `projects.project_code`).
- **UI:** list + search/filter + modal (like IPC tab); export Excel + print; open existing from table or notification deep-link.
- **Contract allocation:** each expense item row has **مركز التكلفة** dropdown. On approve, items grouped by `contractId`:
  - Same group → one transaction with `costCenterId = contractId`, custody account credited for group's subtotal.
  - No `contractId` → one transaction without cost center.
- **Cloud fallback:** Firestore collection `custody_settlements` when not `isLocalBackend`.
- **API:** `GET/POST/PUT/DELETE /api/custody-settlements` · **`POST /:id/approve`**.

**Do not regress:** saving/submitting a settlement must **not** post GL — only **`approve`** does.

## Liquidity Report

`LiquidityReport.tsx` is a read-only report rendered as a **tab inside `Reports.tsx`** (tab id `'liquidity'`). It is no longer a standalone window and has no entry in `WindowManager` or `modules.ts`. It shows:

- **Summary cards**: cash & banks (`cashAndBankBalanceFromGlTxs`), total billed IPCs, **`cash_collections`** (`ipcCollected` — same as Dashboard), **`pending_billing`** (`computePortfolioPendingBilling` — global `12201…` when GL activity exists).
- **Per-contract table**: billed, **`ipcCollected`** (not ipc+advances), advances (`21301…`), retention, uncollected per contract, collection %.

All per-contract math goes through **`computeLiquidityContractRow`** in `src/lib/liquidityMetrics.ts` (same source as Dashboard/Projects). **Local mode (`VITE_DATA_BACKEND=local`):** GL + billing + contracts + projects من **Postgres عبر API فقط** — لا دمج Firestore (`Dashboard.tsx`, `LiquidityReport.tsx`, `Reports.tsx`).

In `Reports.tsx`, when `activeReport === 'liquidity'`, **`needTx` / `needBillings` are `false`** unless **`showCharts`** is on (charts use `projectStats` → require billing + GL).

## Banks — UI (split-view) — ✅ 2026-07-02

**`Banks.tsx`** exposes three sub-tabs (sidebar themes + ERP **`moduleMenus.ts`** banks sub-views):

| Tab id | Label (ar) | UI |
|--------|------------|-----|
| **`accounts`** | كشف حساب بنكي | **`BankAccountsTab`** — sidebar bank names + add; main = GL statement or account master edit |
| **`transactions`** | المعاملات | **`BankTransactionsTab`** — sidebar unified list (movements + cheques) + create buttons; main = embedded movement/cheque form or detail |
| **`statements`** | كشوف البنك | **`BankStatementsTab`** (unchanged; **top stat cards still show** on this tab only) |

**Legacy ERP view ids** (do not remove from manual/deep-links): **`normalizeBankTab()`** in **`Banks.tsx`** maps `account_statement` → `accounts`; `movements` \| `cheques` → **`transactions`**. **`moduleViewPermissions.ts`**: `transactions` · `movements` · `cheques` · `account_statement` all gate on **`banks`**.

**No aggregate header cards** on **`accounts`** or **`transactions`** — the four KPI cards (active accounts, draft movements, open cheques, month statements) render only when `tab === 'statements'`.

**Split-view pattern** (accounts + transactions): main pane left (RTL: right) · sticky sidebar with list + primary actions · active row `bg-blue-600` · empty-state CTA in main pane. Host tabs pass **`embedded: true`** into **`BankMovementsTab`** / **`BankChequesTab`** with **`panelMode: 'create' | 'detail'`** — standalone full-page chrome hidden when embedded.

**i18n:** `banks_menu_transactions`, `banks_screen_transactions_*`, `banks_transactions_new_movement`, `banks_transactions_new_cheque`, `banks_filter_select_transaction` (+ existing `banks_screen_accounts_*`).

### Bank movements — unified «تحويل» (2026-06-19)

Single movement type **`transfer`** (no separate InstaPay types in UI). Wizard on **`BankMovementsTab.tsx`**:

1. **Scope:** `internal` (company bank ↔ bank) · `external` (beneficiary + COA offset)
2. **Channel:** `bank_app` · `instapay`
3. **Direction:** `out` · `in` (relative to selected `bankAccountId`)

Metadata on `bank_movements`: `transfer_scope`, `transfer_channel`, `transfer_direction`, `instapay_beneficiary`, `instapay_fee`. Legacy rows `instapay_out`/`instapay_in` normalized via **`bankTransferMeta.ts`**. GL: **`buildBankMovementJournalEntries()`** in **`bankMovementPosting.ts`**. InstaPay outgoing fee → optional Dr **`53102001`** (`suggestInstapayFee()`). Prisma migration **`20260619120000_bank_movement_instapay`**.

### Bank / offset balance hints (2026-06-28)

When creating a **cheque** or **movement** draft, selecting a bank account or COA offset shows a live **GL balance hint** below the picker:

| Picker | UI label | Source |
|--------|----------|--------|
| حساب بنكي (`bankAccountId` أو `toBankAccountId` في التحويل الداخلي) | **Available balance** | Net on linked 8-digit COA |
| Offset COA leaf (supplier, subcontractor, custody `12102…`, partner `314…`, expense, other bank `121…`, …) | **Account balance** + (Dr/Cr) | Same map keyed by `accountCode` |

- **`Banks.tsx`** loads GL once via **`useGlAccountBalances`** → passes **`balanceByCode`** to **`BankTransactionsTab`** (movement/cheque forms). Account **statement running balance** comes from **`BankAccountStatementPanel`** line math, not the header KPI cards.
- Balance = **Σ(debit − credit)** over loaded transactions (**`LISTENER_GL_TX_SCREEN_CAP` = 4,500** — same cap pattern as bank statement panel; may differ from full-history GL if org exceeds cap).
- **Do not regress:** hints are read-only; posting logic unchanged. Refresh on `onBankDataMutated` via shared `dataRefreshKey`.
- **Tests:** `npm run test -- src/lib/glAccountBalance.test.ts`

## Banks — Cheques

`Banks.tsx` + `BankChequesTab.tsx` post two GL legs per received/issued cheque. في **local mode** البيانات التشغيلية (`bank_*`) عبر `banksApi` + `bankPersistence.ts`؛ GL عبر `accountingService` → `glApi`.

| Stage | Received | Issued |
|-------|----------|--------|
| **ISS** (first posting) | Dr `12203001` clearing · Cr customer/advance/multi-credit | Dr payee · Cr `21601001` payable |
| **CLR** (bank) | Dr bank · Cr clearing | Dr payable · Cr bank |

- **`projectId` / `costCenterId` (contract)** on ISS and CLR are **optional**, same pattern as **`BankMovementsTab`**: project equals “all projects” or a specific project; contract via **`SearchableSelect`** with a **“no cost center”** row (`value: ''`). When unset, the journal header is posted **without** cost center (pairs with `sanitizeTransactionFirestoreData` in `accountingService.ts`).
- **`bankChequePosting.ts`** builds balanced entries; never hardcode clearing codes in components.
- KPI / Liquidity: count **ISS** leg for collections/advances; **CLR** updates bank balance only.

## Operations Manual (دليل الاستخدام) — ✅ 2026-06-21

In-app **step-by-step guide** for operational workflows — Arabic/English via **`manual_*`** keys in `LanguageContext.tsx`.

### Architecture

| Piece | Role |
|-------|------|
| **`src/lib/operationsManual.ts`** | Topic registry (`MANUAL_TOPICS`), `ManualTopicId`, lookup + **`isManualTopicAllowed`** |
| **`OperationsManual.tsx`** | Standalone module (`module id: manual`) — search + module filter + topic nav. **Sidebar themes:** floating window. **ERP:** workspace panel via **`ErpWorkspace`** (not overlay). |
| **`ManualHelpButton.tsx`** | Contextual **`?`** on module screens — preview dropdown + link to full manual |
| **`ManualTopicContent.tsx`** | Renders summary · before you start · numbered steps · common mistakes |

### Permission rules (do not regress)

- **`isManualTopicAllowed`**: if `topic.permission` is set, it is checked **before** `viewId` / module gate (e.g. **`settings.coa.tree`** needs **`ledger.view` + settings access**).
- **`ManualHelpButton`**: returns **`null`** when topic missing or not allowed — same rules as the manual list.
- Shell utilities **`display`**, **`calculator`**, **`manual`**: visible to all signed-in users (`SHELL_UTILITY_MODULE_IDS`). **`manual`** follows the same **single-module** close policy as other primaries when opened from the sidebar; in **ERP** it uses the workspace slot (replacing the current main module).

### Topic inventory (**61** topics)

| Module / phase | Topic prefix / count |
|----------------|----------------------|
| Actual Costs | `costs.*` (5) — purchase · indirect · fixed asset · IPC · custody |
| Technical office | `technical.*` (7) — projects · contract · BOQ · billing · MOS |
| Inventory | `inventory.*` (7) — materials · BOQ link · receipt · consumption · multi-BOQ · return · transfer |
| GL / OHA | `ledger.*` (5) — filters · manual entry · reverse · statement · overhead close |
| Banks | `banks.*` (5) — transfer · income/expense · received/issued cheque · reject |
| Fixed assets | `assets.*` (3) |
| Payroll | `payroll.*` (11) |
| Reports | `reports.*` (8) — shared print/filters + 7 tabs |
| Settings / tools | `settings.*` (8) + `tools.calculator.use` + `tools.offline.sync` |

### UI wiring

- **`?`** on module headers / primary actions (e.g. `ActualCosts`, `Reports`, `Payroll`, `Settings`, `FixedAssets`, `GeneralSettings`, `Calculator`).
- **Reports**: header topic follows active tab; second **`?`** beside Print → `reports.shared.filters_print`.
- **Settings → Database**: separate **`?`** on backup, push-to-production, data maintenance.
- **Print design**: admin block at bottom of **`GeneralSettings.tsx`** (`PrintSettingsPanel`).

### Adding a new topic

1. Add id to **`ManualTopicId`** + entry in **`MANUAL_TOPICS`** (`operationsManual.ts`).
2. Add **`manual_<area>_<topic>_*`** keys in **`LanguageContext.tsx`** (ar + en).
3. Place **`ManualHelpButton topicId="…"`** on the relevant screen.
4. Run **`npm run test -- src/lib/operationsManual.test.ts`**.

### Verify

```powershell
npm run test -- src/lib/operationsManual.test.ts
```

Golden path: open any **`?`** → preview → «فتح الشرح الكامل» → correct topic in manual window; filter by module; confirm limited user does not see admin-only topics.

## Display Settings

**`GeneralSettings.tsx`** (module ids **`display`** / **`general`**) — Sidebar / TopNav footer **Palette** icon. All authenticated users; no `settings` permission required.

- **Theme**: Dark / Soft / Light / **ERP** — saves `defaultTheme` (Firestore or local user-preferences).
- **Language**: ar/en via `setLanguage()`.
- **Default startup module**: `STARTUP_MODULES` dropdown (excludes `settings`).
- **Print & company** (admin only): embedded **`PrintSettingsPanel`** — company letterhead fields only; print layout via Reports format toolbar.
- **Single-module policy:** opening any other module **closes** general settings (all themes). Opening general settings **closes** the current main module / ERP workspace. See **Shell — single-module policy** above.

**Sidebar / TopNav footer (all authenticated users):** General settings · **Electron: new desktop window** (`requestOpenNewWindow`, Ctrl+N) · calculator · manual · language · logout. New OS window shares **`persist:webcost`**; single-module policy still applies **per OS window**.

Replaces the former Display section in **`Settings.tsx`**. `WindowManager` lazy-loads **`GeneralSettingsLazy`** for both `display` and `general`. Excluded from **`STARTUP_MODULES`**.

---

## 🔴 HANDOFF — إدخال شبيه بإكسل على الجداول والحقول ✅ (2026-08-08)

> **جلسة 2026-08-08:** تعميم سلوك إكسل — تحديد القيمة عند التركيز (الكتابة تمحو الموجود) · تنقل بالأسهم داخل جداول التحرير (مستخلصات، قيد، رواتب، …).

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **طبقة عامة** | `installExcelLikeInputBehavior()` عند الإقلاع | `excelLikeInputs.ts` · `main.tsx` |
| **تحديد عند التركيز** | text/number/textarea | نفس الملف |
| **تنقل جدول** | Arrow / Enter / Tab؛ صفوف بأعداد أعمدة مختلفة | اكتشاف DOM داخل `<table>` |
| **توافق** | `SpreadsheetCellInput` → `data-excel-nav="managed"` | `SpreadsheetCellInput.tsx` |
| **اختبارات** | 8 + 4 حالات | `excelLikeInputs.test.ts` · `spreadsheetGridNav.test.ts` |

### لا تراجع

- لا تعطّل التثبيت من `main.tsx` دون بديل.
- للتنقل اليدوي الخاص: `data-excel-nav="managed"` أو `off`.
- لا تعتمد على استبدال كل `<input>` يدوياً — الطبقة العامة تغطي الجداول الموجودة.

### تحقق

```powershell
npm run test -- src/lib/excelLikeInputs.test.ts src/lib/spreadsheetGridNav.test.ts
# Ctrl+Shift+R → مستخلصات / تكاليف IPC → ركّز خلية → اكتب (يستبدل) → أسهم بين الخلايا
```

---

## 🔴 HANDOFF — لوحة التحكم: OHA يُنقل من «غير موزّع» ✅ (2026-07-31)

> بعد توزيع OHA كان صف «غير موزّع / عمومية» يبقى لأن المصروف يُحسب على مستوى القيد (صافي OHA=0) ولا تُخصم دائنية المجمع. كذلك إقفال الدخل كان يُتجاهل (`expense > 0` فقط).

### الإصلاح
- احتساب مصروف التشغيل **سطر بسطر** + مركز تكلفة السطر → عقود تحصل على Dr `512…`، ومجمع HO يُخصم من غير موزّع
- استبعاد `fiscal_pl_close` / `fiscal_opening` من لوحة التحكم (التكاليف التشغيلية تبقى ظاهرة بعد الإقفال)
- إن بقي مبلغ في «غير موزّع» بعد OHA = مصروف لم يُدرج في مراكز OHA المشمولة (أو بلا مركز عقد)

```powershell
npm run test -- src/lib/dashboardMetrics.test.ts
```

---

## 🔴 HANDOFF — منع قفل الفترة قبل إقفال الدخل ✅ (2026-07-31)

> **جلسة 2026-07-31:** قفل الفترة المحاسبية مرفوض (HTTP 409) إذا بقيت أرصدة على حسابات `4…`/`5…` حتى `periodEnd` — يجب إقفال قائمة الدخل أولاً.

| مسار | تحقق |
|------|------|
| `POST /api/accounting-periods` | `assertNoOpenPlBalancesForPeriodLock` |
| `POST /api/accounting-periods/:id/lock` | نفس التحقق (إن لم تكن مقفلة مسبقاً) |
| خطأ | `IncomeCloseRequiredError` → 409 + رسالة عربية |

لا تراجع: لا تسمح بالقفل اليدوي مع P&L مفتوح؛ مسار الافتتاحي بعد `pl_closed` يبقى كما هو.

---

## 🔴 HANDOFF — توحيد تكاليف لوحة التحكم ✅ (2026-07-31)

> **جلسة 2026-07-31 مساءً:** بطاقة «التكاليف الفعلية» والرسم ومقارنة المشاريع كانت تستخدم 3 معادلات مختلفة.

### السبب
- KPI = GL opex + مواد (`boq_actual_costs` materials) بدون تاريخ أحياناً
- الرسم = GL فقط
- المقارنة = GL الموزّع على `projectId` فقط (يستبعد عمومية/بدون مشروع)

### ما تم
- `spent-by-contract`: فلتر تاريخ + `projectId` + `groupBy=month`
- الرسم والمقارنة يأخذان نفس المواد؛ صف **«غير موزّع / عمومية»** لتجميع G&A
- المواد تحترم فلتر الفترة/المشروع/العقد

### تحقق
```powershell
npm run test -- src/lib/dashboardMetrics.test.ts
# أعد تشغيل API → لوحة التحكم → Σ عمود التكلفة ≈ بطاقة التكاليف ≈ نهاية منحنى التكاليف
```

---

## 🔴 HANDOFF — ربط مستخلص باطن + عهدة → BOQ للتقارير فقط ✅ (2026-07-31)

> **جلسة 2026-07-31:** كتابة `boq_actual_costs` عند اعتماد مستخلص الباطن (تلقائي من بنود IPC) وعند اعتماد تسوية العهدة إن رُبط بند BOQ اختيارياً — **بدون تغيير قيود اليومية**.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **DB** | `purchase_transaction_id` · `custody_settlement_id` على `boq_actual_costs` | migration `20260731180000` |
| **IPC** | عند approve: `cost_element=subcontractor` بمبلغ الفترة `currentQty×rate` | `boqActualFromSources.ts` · `purchaseTransactions.ts` |
| **عهدة** | حقل اختياري `boqItemId` في البنود → `cost_element=custody` عند approve | `GLCustodySettlement.tsx` · `custodySettlements.ts` |
| **Dashboard** | `spent-by-contract` = **`materials` فقط** (منع ازدواج مع GL) | `inventory.ts` |
| **Backfill** | مستخلصات/عهود معتمدة سابقاً | `npm run local:backfill-ipc-custody-boq` |

### لا تراجع

- لا تغيّر `buildSubcontractorIpcEntries` / `postCustodySettlementJournals` لأجل التقارير.
- لا تُدرج `subcontractor`/`custody`/`other`/`overhead` في `spent-by-contract` (لوحة التحكم).
- مبلغ تقرير IPC = **الفترة** (`currentQty×rate`) وليس المبلغ التراكمي في حقل `amount`.

### تحقق

```powershell
npx prisma migrate deploy
npm run local:backfill-ipc-custody-boq
npm run test -- server/src/accounting/boqActualFromSources.test.ts
# أعد تشغيل API ثم: تقارير → تكاليف BOQ — الإجمالي يرتفع بمستخلصات الباطن المعتمدة
```

---

## 🔴 HANDOFF — جرس التنبيهات → شاشة المصدر + صلاحية ✅ (2026-08-02)

> **جلسة 2026-08-02:** النقر على تنبيه يفتح الموديول/التبويب المصدر (أوامر شراء · تكاليف · مخزون · بنوك · مستخلصات · VO · OHA) فقط إن وُجدت صلاحية الدخول.

| المجال | ملخص | ملفات |
|--------|------|--------|
| **توجيه** | `resolveNotificationNavigation` + pending focus بعد نجاح الصلاحية | `notificationNavigation.ts` · `NotificationBell.tsx` |
| **صلاحية** | `canOpenShellModule` + `canOpenModuleView` قبل `openWindow`؛ toast عند الرفض | نفس + `App.tsx` `openWindow` |
| **تبويب** | costs/inventory/banks/ledger تستهلك `pendingShellView`؛ remount عند `viewId` | `ActualCosts` · `Inventory` · `Banks` · `GeneralLedger` · `App.tsx` |
| **ERP click** | قائمة الجرس عبر portal + تفعيل بـ `mousedown`؛ تجاهل خارج `.shell-dropdown-panel` | `NotificationBell.tsx` |
| **ERP same-view** | `navigateTo(..., { force: true })` + `remountKey` حتى لو التبويب مفتوح | `ErpWorkspaceContext` · `ErpWorkspace` · `openFromNotification` |

```powershell
npm run test -- src/lib/notificationNavigation.test.ts
# Ctrl+Shift+R ثم جرس → تنبيه → يجب فتح شاشة المصدر
```

---

## 🔴 HANDOFF — أوامر الشراء (Purchase Requests) ✅ (2026-08-02)

> **جلسة 2026-08-02:** موديول مستقل لكل المستخدمين · حالة فقط عند التنفيذ (لا فاتورة/GL) · BOQ كود+وصف · إشعار + واتساب.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **DB** | `PurchaseRequest` · أرقام `PR-YYYYMMDD-NNNN` | migration `20260802120000_purchase_requests` |
| **API** | meta · materials-lookup · boq-picker · list · create · status · notify-whatsapp · soft delete | `purchaseRequests.ts` · `/api/purchase-requests` |
| **UI** | تبويب نشط/منفّذ · نموذج مكود/غير مكود · Excel · واتساب | `PurchaseRequests.tsx` · `purchaseRequestsExcel.ts` |
| **صلاحيات** | فتح للجميع؛ إنشاء افتراضي؛ edit للحالات (admin/PM/accountant) | `permissions.ts` · `moduleViewPermissions` |
| **إشعارات** | `purchase_request_pending` + deep-link + واتساب لمَن لديهم edit + هاتف opt-in | `notificationFeed` · `notificationHooks` · `NotificationBell` |

### لا تراجع

- لا ترحّل GL ولا تنشئ فاتورة عند `executed`.
- `boq-picker` لا يعيد أسعار/كميات — فقط `id` · `itemCode` · `description`.
- لا تخفِ الموديول عن مستخدم `DEFAULT_PERMISSIONS` (view+create).

### تحقق

```powershell
npx prisma migrate deploy
npm run test -- src/lib/moduleViewPermissions.test.ts
# أعد تشغيل API → أوامر الشراء → إنشاء طلب → جرس للمسؤولين → حالة «تم التنفيذ»
```

---

## 🔴 HANDOFF — توحيد الطباعة على منصة reportDocument ✅ (2026-07-31)

> **جلسة 2026-07-31:** ترحيل كل الطباعة (كشوف + شهادات + PDF قيد اليومية) إلى `ReportDocument` + `ReportPreviewDialog` وحذف مسار الاستنساخ القديم بالكامل.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **محرك الأقسام** | `ReportDocSection` (`keyValue` · `table` · `summary` · `signatures` · `note`) + رسمها مع تقسيم صفحات | `reportDocument/types.ts` · `renderHtml.ts` · `buildTableDoc.ts` |
| **حوار معاينة موحّد** | `ReportPreviewDialog` (iframe + `ReportFormatToolbar` + طباعة + PDF + حفظ التصميم) عبر hook `useReportDocumentPreview` | `ReportPreviewDialog.tsx` · `useReportDocumentPreview.tsx` |
| **حفظ التصاميم** | `saveReportPrintProfile` — local `settingsApi` أو Firestore `company_info.reportPrintProfiles` | `reportPrintProfilesPersistence.ts` |
| **شهادات** | IPC عميل/باطن · MOS · أوامر تغيير · تسوية عهدة كمستندات أقسام | `buildCertificateDocs.ts` · `useIpcPrintPreview` · `useMosPrintPreview` · `useVoPrintPreview` · `GLCustodySettlement.tsx` |
| **كشوف** | بنكي · GL · مخزن · أصول ثابتة · رواتب عبر `buildTableReportDocument` | `BankAccountStatementPanel` · `GLAccountStatement` · `Inventory` · `FixedAssets` · `Payroll` |
| **PDF قيد اليومية** | استبدال `html2pdf.js` بمستند منصة | `GLJournalEntries.tsx` |
| **تنظيف** | حذف `printReport.ts` · `useReportPrintPreview` · مكوّنات print القديمة · CSS clone/preview (~900 سطر) · إزالة `html2pdf.js`/`jspdf`/`jspdf-autotable` | `index.css` · `package.json` |

### لا تراجع

- لا `window.print()` مباشرة على DOM النافذة ولا استنساخ clone — ابنِ `ReportDocument` وافتح `ReportPreviewDialog`.
- لا تُعِد مكتبات `html2pdf.js` / `jspdf` — PDF عبر Chromium `printToPDF` (Electron) أو حوار الطباعة (متصفح).
- CSS `.report-page-viewer` و`.bva-*` (عرض الشاشة في التقارير) باقية — لا تحذفها مع أي تنظيف لاحق.

### تحقق

```powershell
npm run test -- src/lib/reportDocument/reportDocument.test.ts   # 14 tests ✅
npx tsc --noEmit   # لا أخطاء في ملفات الطباعة (الأخطاء المتبقية قديمة)
```

Golden path: تقارير → طباعة (معاينة + PDF)؛ مستخلص → طباعة (شهادة)؛ تسوية عهدة → طباعة؛ قيد يومية → PDF؛ عدّل التصميم من شريط التنسيق → حفظ → يبقى بعد إعادة الفتح.

---

## 🔴 HANDOFF — قائمة الدخل: هيكل إقفال + فلتر + تحليلي ✅ (2026-07-29)

> **جلسة 2026-07-29:** إصلاح تكاليف = 0 عند «كل المشاريع» (بسبب `fiscal_pl_close`) · كشف يعكس قيد الإقفال · وضع تحليلي.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **فلتر** | استبعاد `fiscal_pl_close` / `YE-PL-*` من تجميع قائمة الدخل فقط؛ فلتر مشروع عبر `projectId` أو مركز تكلفة العقد | `incomeStatementGl.ts` · `Reports.tsx` |
| **هيكل** | إيرادات `4` − تكاليف عقود `51` = مجمل ربح − عمومية/إدارية `52` (− تمويلية `53`) = ربح قبل الضريبة | `Reports.tsx` |
| **UI** | بدون بطاقات KPI علوية؛ زر إظهار/إخفاء التحليلي (`showAnalytical`) | `Reports.tsx` |
| **اختبارات** | إقفال لا يصفّر التكاليف عند الاستبعاد | `incomeStatementGl.test.ts` (7) |

### لا تراجع

- لا تُدرج `fiscal_pl_close` في تجميع قائمة الدخل (تبقى في الميزانية/ميزان المراجعة).
- لا تُعد بطاقات الإجماليات أعلى تبويب قائمة الدخل.
- لا تسمية EBIT / صافي الربح بدل «ربح الفترة قبل الضريبة».

### تحقق

```powershell
npm run test -- src/lib/incomeStatementGl.test.ts
# تقارير → قائمة الدخل → كل المشاريع (تكاليف ≠ 0) → مشروع بيل → إظهار التحليلي
```

---

## 🔴 HANDOFF — كشف الأيام + تأمينات/ضريبة مصرية ✅ (2026-07-29)

> **جلسة 2026-07-29:** استبدال مسار «قالب/استيراد كشف رواتب مالي» و«بصمة» بـ **كشف الأيام** · تأمينات 11% + ضريبة دخل تصاعدية تلقائياً · يدوي: مكافأة/حافز/سلف.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **شريط الكشف** | **قالب الأيام** · **استيراد الأيام** · تصدير/طباعة/حفظ/استحقاق/حذف — **بدون** قالب/استيراد مالي كامل | `Payroll.tsx` |
| **أعمدة الجدول** | أساسي/إضافي/جزاءات/تأمينات/ضريبة = للقراءة؛ مكافأة·حافز·سلف = تعديل يدوي (+ إعادة حساب SI/tax) | `Payroll.tsx` · `egyptPayrollStatutory.ts` |
| **Excel** | `قالب_كشف_الأيام.xlsx` — حضور · إجازات · غياب بدون إذن · إضافي · جزاءات | `payrollExcel.ts` |
| **خادم** | `computeLineTotals` عبر `computeEgyptEmployeeStatutory`؛ تطبيق الأيام يحافظ على مكافأة/حافز/سلف السابقة | `payroll.ts` · `payrollAttendance.ts` |
| **DB** | `AttendanceImportLine.directPenalties` | migration `20260729120000_attendance_direct_penalties` |

### لا تراجع

- لا تُعد أزرار **قالب** / **استيراد** لكشف مالي كامل في شريط المسودة.
- لا تسمّ الأزرار «بصمة» — استخدم **الأيام**.
- لا تجعل التأمينات/الضريبة قابلة للتحرير اليدوي في الجدول.

### تحقق

```powershell
npx prisma migrate deploy
npm run test -- src/lib/egyptPayrollStatutory.test.ts
npm run dev:local   # ثم Ctrl+Shift+R على كشف الرواتب
```

Golden path: كشف مسودة → قالب الأيام → تعبئة → استيراد الأيام → معاينة (SI/tax) → تطبيق → عدّل مكافأة/حافز/سلف → احفظ → استحقاق.

---

## 🔴 HANDOFF — إقفال قائمة الدخل + قيد افتتاحي ✅ (2026-07-27)

> **جلسة 2026-07-27:** إقفال `4/5 → 31301001` · اعتماد ميزانية إن `|gap| ≤ 1` جنيه (تقريب) · قيد افتتاحي للسنة الجديدة. **WIP / 126 ملغى** — لا تُعاد معالجته.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **DB** | `FiscalPeriodClosing` · `transactions.journal_kind` · migration `20260727140000` | `prisma/schema.prisma` |
| **منطق** | معاينة/إقفال دخل · اعتماد BS · افتتاحي · إعادة فتح | `fiscalPeriodClosing.ts` · `fiscalPeriodClosingService.ts` |
| **API** | `/api/fiscal-closings` | `fiscalClosings.ts` · `app.ts` |
| **UI** | تفعيل `IncomeStatementClosingPanel` | موديول الفترات → إعداد قائمة الدخل |
| **تقارير** | استبعاد `fiscal_opening` / `OPEN-*` من تجميع BS/IS/TB | `Reports.tsx` |

### لا تراجع

- لا WIP تلقائي على `126…`.
- لا اعتماد ميزانية إذا `|A−(L+E)| > 1` (`BS_BALANCE_TOLERANCE`)؛ ≤ 1 يُمتص في الأرباح المحتجزة عند الافتتاحي.
- القيد الافتتاحي `journal_kind=fiscal_opening` — لا يُحسب في أرصدة التقارير المستمرة.
- admin فقط للإنشاء/الإقفال/الاعتماد/الافتتاحي/إعادة الفتح.

### تحقق

```powershell
npx prisma migrate deploy
npm run test -- server/src/accounting/fiscalPeriodClosing.test.ts
npx tsc -p server/tsconfig.build.json --noEmit
```

Golden path: فترات محاسبية → إعداد قائمة الدخل → إنشاء دورة → معاينة إقفال الدخل → اعتماد → اعتماد الميزانية (فرق ≤ 1 مقبول) → ترحيل افتتاحي.

---

## 🔴 HANDOFF — قفل الفترات المحاسبية ✅ (2026-07-26)

> **جلسة 2026-07-26:** قفل ربع سنوي للدفاتر + قائمة مستثنين لكل فترة · فرض على مستوى `journal.ts` · واجهة في موديول الفترات المحاسبية.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **DB** | `AccountingPeriodLock` · migration `20260726120000` | `prisma/schema.prisma` |
| **فرض** | `assertPeriodUnlocked` في create/update + soft-delete | `periodLock.ts` · `journal.ts` · gl/billing/payroll/OHA reopen |
| **API** | `/api/accounting-periods` (list · create · lock · unlock · allowed-users) | `accountingPeriods.ts` · `app.ts` |
| **UI** | تبويب `period_lock` · `PeriodLockPanel` | `OverheadAllocation.tsx` · `PeriodLockPanel.tsx` · i18n |
| **خطأ** | `PeriodLockedError` → **423** | `errors.ts` |

### لا تراجع

- لا تعتمد على واجهة العميل فقط — الفرض في الخادم داخل `createTransaction` / `updateTransaction`.
- لا تخلط قفل الدفاتر مع حالة OHA `closed`.
- admin للقفل/الفتح/المستثنين؛ الترحيل في فترة مقفلة فقط لمن في `allowedUserIds` (حتى admin يحتاج إضافته للقائمة).
- سكربتات الصيانة: `skipPeriodLock: true`.

### تحقق

```powershell
npx prisma migrate deploy
npm run test -- server/src/accounting/periodLock.test.ts
npx tsc -p server/tsconfig.build.json --noEmit
```

Golden path: قفل Q2-2026 → قيد/فاتورة بتاريخ داخل الربع → 423؛ أضف مستخدم للمستثنين → ينجح؛ أعد فتح الفترة → يعمل الجميع.

---

## 🔴 HANDOFF — Electron multi-window (same session) ✅ (2026-07-25)

> **جلسة 2026-07-25:** نوافذ Electron متعددة بنفس `persist:webcost` · Ctrl+N · زر في الشريط · **New GUI بدون إعادة login** (`reuseSession`) · اختصار لوحة عربية عبر `input.code` · كشف الجلسة عبر sync IPC + URL.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **قشرة** | `createAppWindow({ reuseSession })` + `--web-cost-reuse-session`؛ Ctrl+N / IPC | `electron/main.ts` · `preload.ts` |
| **كشف reuse** | sync IPC `query-reuse-session` + `?webCostReuseSession=1` + argv — يعمل في المثبّت المعبأ (`sandbox`) | `main.ts` · `preload.ts` · `electronShell.ts` |
| **اختصار** | **`input.code === 'KeyN'`** (+ `preventDefault`) — لوحة عربية | `electron/main.ts` `before-input-event` |
| **جلسة** | النافذة الثانوية مخفية حتى `sessionProbe` + جاهزية الواجهة، ثم `window-reveal` — **لا** Login ولا شعار | `App.tsx` · `electronShell.ts` · `main.ts` |
| **UI** | زر Electron-only في Sidebar + TopNav بجانب Palette (ليس داخل General Settings) | `Sidebar.tsx` · `TopNavBar.tsx` |
| **نشاط** | لا toast موقع جغرافي عند الدخول (أي نافذة) · `IDLE_LOGOUT_MS` = **3 دقائق** (يُيقاف مع offline drafts/outbox) | `useActivitySession.ts` · `sessionLogout.ts` · `idleGate.ts` |

### لا تراجع

- النافذة الأولى فقط: cold-start مسح كوكيز + شاشة كلمة المرور.
- نوافذ Ctrl+N / الزر: `reuseSession: true` — نفس الكوكيز، دخول مباشر بعد `sessionProbe`.
- **Ctrl+N:** استخدم **`input.code === 'KeyN'`** — لا `input.key === 'n'` وحده.
- **كشف New GUI:** لا تعتمد على `additionalArguments`/`argv` وحدها في المثبّت — استخدم **`query-reuse-session`** و/أو `webCostReuseSession=1`.
- لا تربط OAuth lifecycle بنوافذ التطبيق.
- لا تُظهر شاشة Login ولو لحظة في نافذة New GUI — تبقى مخفية حتى `window-reveal`.
- **تطبيق سطح المكتب المثبّت:** زر الواجهة يأتي من Railway (SPA)، لكن **فتح النافذة من القشرة** — مثبّت قديم (مثلاً 1.0.3) **بدون** `open-new-window` لن يعمل. يلزم **`electron:publish`** أو تثبيت Setup **≥ 1.0.7**.

### تحقق

```powershell
npm run electron:build:shell
$env:WEB_COST_APP_URL="https://web-cost-app-production.up.railway.app"
npm run electron:dev
# أو للمثبّت:
$env:WEB_COST_APP_URL="https://web-cost-app-production.up.railway.app"
$env:GH_TOKEN="ghp_..."
npm run electron:publish
```

Golden path: سجّل دخول → Ctrl+N (لوحة عربية أو إنجليزية) أو زر النافذة → نافذة ثانية **بدون** شاشة login · موديول مختلف في كل نافذة.

## Settings — module sections (sidebar + ERP)

| Section `viewId` | Who sees it | Extra gate |
|------------------|-------------|------------|
| `database`, `users` | `settings` permission | — |
| `coa` | `settings` + **`ledger.view`** | `ChartOfAccountsSettingsPanel` |
| `cost_centers` | **`admin`** | **`isLocalBackend`** only — `IndirectCostCentersPanel` |
| `activity`, `sample_data` | **`admin`** | — |

**Do not regress:**
- **`Settings.tsx`**: use **`usePermissions().isAdmin`** from `PermissionsContext` — **never** a separate `authApi.me()` role fetch for section visibility (timeout → role `'user'` → hidden admin tabs).
- **ERP `TopNavBar`**: every settings sub-view through **`canOpenModuleView(..., { isAdmin })`** — no blanket «any `settings` permission opens all tabs».
- **`SETTINGS_ADMIN_VIEW_IDS`** in `moduleViewPermissions.ts` must stay in sync with sidebar section list.

**Tests:** `npm run test -- src/lib/moduleViewPermissions.test.ts`

## Settings — Data Maintenance (admin)

`Settings.tsx` → **Database** section (admin only):

- **Backup & Restore** — **local/Railway:** **`GET /api/settings/backup-export`** exports **full Postgres** (`POSTGRES_BACKUP_COLLECTIONS`, v3 — excludes `sessions`; includes **`passwordHash`** on `users` for restore). **`POST /api/settings/backup-import`** (admin) restores JSON — **`merge`** upserts (keeps existing DB password if user already exists) · **`replace`** truncates backup tables then imports (`importPostgresBackup.ts` restores **`passwordHash`** from backup when present; **`usesNormalizedChildTables`** — GL lines from **`journal_entries`** only, not duplicated from nested `transactions.entries`) and **destroys the Express session** (`requiresReLogin: true`). Client shows a **full restore report** (counts + skip reasons via `BackupImportReportPanel` / `backupImportReport.ts` sessionStorage) and **suppresses forced 401 logout** (`suppressApiUnauthorizedLogout`) until the user clicks «متابعة لتسجيل الدخول». After re-login the last report remains under Settings → Database until dismissed. Generic upsert strips payload **`id`** from Prisma `update` (avoids mass `_upsert_error` on merge). Orphan `journal_entries.costCenterId` cleared; missing parent tx → skip `journal_entries_missing_transaction`. **Cloud legacy:** Firestore **`FIRESTORE_BACKUP_COLLECTIONS`** export/import in browser.
- **Push to production (Railway)** — **`PushToProductionPanel`** (local dev + `admin` only). Merges **local Postgres → Railway Postgres** (upsert by doc id). Requires **`PRODUCTION_DATABASE_URL`** in `.env` (Railway **`DATABASE_PUBLIC_URL`**, `*.proxy.rlwy.net` — **not** `postgres.railway.internal`). Also accepts env alias **`DATABASE_PUBLIC_URL`**. Disabled when `NODE_ENV=production`. Does **not** overwrite Railway **`users`**. Does **not** delete GL rows that exist on Railway only. Google re-auth before push (`AdminSensitiveVerifyModal`).
- **Data Maintenance** — **`CLEAR_DATA_GROUPS`** (Firestore cloud **or** Postgres local) + `ClearDataModal` (type **حذف** / **DELETE** + Google verify). Postgres: **`POST /api/financial-maintenance/wipe`** `{ groups[] }` via **`dataMaintenanceWipes.ts`** (financial · warehouse · custody · payroll · fixed_assets · materials_tree · …). Users/sessions never wiped.
- **`warehouse_movements`** group (visible when `isLocalBackend`): label **حركات وأوامر المخازن** — calls **`POST /api/inventory-maintenance/purge`** with `deleteMovements` + **`resetBalances: true`** (clears consumption/return/transfer/movement SQLite data **and** warehouse balance rows). Does **not** delete `material_groups` / `material_categories` or `127…` warehouse COA. Does **not** delete Firestore `purchase_transactions` / `transactions` — purge those separately if full reset needed.

### Push to production — API (local dev only)

| Method | Path | Permission |
|--------|------|------------|
| GET | `/api/settings/push-to-production/preview?year=` | `admin` |
| POST | `/api/settings/push-to-production` | `admin` |

Preview returns: local vs remote GL counts (incl. fiscal year), **`missingOnRemote`** (local tx ids absent on Railway), **`targetHost`**. **`404`** on these routes = **stale API on :3001** — restart **`npm run local:api`**.

**Pull Railway → local** is **not** implemented — use backup export from Electron/production + import on localhost, or a future admin pull button.

## Local dev vs Railway vs Electron (2026-06-16)

Three **separate** Postgres instances in typical dev — counts (e.g. GL entries for 2026) **will differ** until synced.

| Client | Data source | Notes |
|--------|-------------|--------|
| **`localhost:3000`** + `VITE_DATA_BACKEND=local` | **`DATABASE_URL`** (local Postgres, e.g. `web_cost_app`) | Dev writes land here first |
| **Electron** (Setup 1.0.3) | **Railway** URL baked in `electron/dist/production-url.json` → same API/DB as production site | **No local DB** — reads hosted app only |
| **Browser → Railway URL** | Railway Postgres | Same as Electron |

**Sync paths:**

| Direction | How |
|-----------|-----|
| Local → Railway | Settings → **Push to production** (admin, local API) |
| Code/UI → all clients | `git push` → Railway redeploy — Electron reloads hosted SPA (**no new Setup.exe**) |
| Railway → Local | Manual backup JSON import today; no auto-pull |

**Electron shell updates** (OAuth, window chrome): `npm run electron:publish` — separate from data/content updates.

## Calculator

`Calculator.tsx` is a **utility module** (`module id: 'calculator'`) accessible to **all authenticated users** via a button in the Sidebar footer (Calculator icon). It requires no permissions and is never listed in `STARTUP_MODULES`.

**Features:**
- Basic arithmetic: `+`, `-`, `×`, `÷`, `%`, `±`, `CE`, `AC`, Backspace
- Chained operations — evaluates left-to-right as operators are entered
- Division-by-zero guard returns a localised error string
- **Keyboard support**: digit keys, `+`, `-`, `*`, `/`, `%`, `Enter`/`=`, `Escape` (AC), `Backspace`; `Ctrl+C` copies the current result (when no text is selected); `Ctrl+V` pastes a numeric value from clipboard
- **Copy/Paste**: no dedicated buttons — result text is selectable (native Ctrl+C); `Ctrl+C` also triggers programmatic copy with a brief "Copied" indicator; `Ctrl+V` pastes via `navigator.clipboard.readText()`
- **History panel**: opens as a full-size **overlay** within the calculator window (no resize required); each entry shows expression + result with copy / "Use result" (closes panel and loads the value); entire history can be cleared via the ⋮ menu
- Fully theme-aware (**dark / soft / light / erp**) and bilingual (ar / en), reads from `useLanguage()`

**Window behaviour:**
- Opens as a **small floating panel** (`windowState: 'normal'`, 240 × 400 px) positioned top-right of the desktop area — **`SHELL_COEXIST_MODULE_IDS`** — does **not** close when opened; opening **any other** module closes that module but **leaves calculator open**
- Re-opening an already-open calculator brings it to the front (`normal` state) without disturbing other windows
- The window is **draggable** within the app frame via the title bar (standard `WindowFrame` drag)
- **Alt+Tab** cycles focus through all open app windows in z-index order (`Alt+Shift+Tab` reverses); implemented in `App.tsx` via a `keydown` listener on `window`

**Architecture — shared state via React Context:**
- `CalcProvider` (exported from `Calculator.tsx`) wraps the entire `WindowFrame` for calculator windows — managed in `WindowManager.tsx`
- `CalcTitleBarExtras` (exported from `Calculator.tsx`) is rendered **inside the window title bar** (between the title text and the minimize/maximize/close buttons) for calculator windows only; it renders the **⋮ (MoreVertical) menu** with History toggle and Clear history options
- `Calculator` (the content component) reads `showHistory` / `history` from `CalcContext` — it does **not** manage those states locally
- `WindowManager` imports `CalcProvider` and `CalcTitleBarExtras` **eagerly** (not lazily); the Calculator content component remains lazy-loaded as `CalculatorLazy`
- **`ManualHelpButton`** (`topicId="tools.calculator.use"`) in calculator panel corner

## SQLite Hybrid Backend

The local Express backend (`server/`) handles financial core operations that require complex transactions not suited to Firestore.

### Environment
- `VITE_DATA_BACKEND=local` → enables SQLite APIs in the frontend (`isLocalBackend = true`).
- `VITE_API_BASE_URL=/api` → proxied by Vite to `http://localhost:3001` (`LOCAL_API_PORT`).
- Run **`npm run dev:local`** (or **`npm run local:api`** + **`npm run dev`** in two terminals). Inventory / materials / distributed invoices **require both** Vite (:3000) and API (:3001). Proxy errors `ECONNREFUSED 127.0.0.1:3001` = API not running.
- DB file: `server/data/financial-core.sqlite` (path controlled by `SQLITE_CORE_DB_PATH` env var).
- **`PRODUCTION_DATABASE_URL`** (optional, **local `.env` only**): Railway Postgres public URL for Settings → push-to-production. Never set on Railway service itself.
- `CORS_ORIGIN` in `.env` is the production default; in **development** the server accepts any `http://localhost:*` origin so Vite on :3002+ still gets session cookies.

### Local Write Path (2026-06-06)

When **`VITE_DATA_BACKEND=local`**, operational writes (journal entries, purchase transaction headers) must go through the **Express API + SQLite**, not client-side Firestore `addDoc`. Firestore rules still gate reference reads and cloud-only deployments; patching rules alone does not fix save failures for limited users (e.g. `project_accountant` without `ledger`).

| Write | Local path | Server permission |
|-------|------------|-------------------|
| Journal (`transactions`) | `accountingService.createTransaction` → `glApi.createTransaction` → `POST /api/gl/transactions` | `ledger` **or** `costs` / `billing` / `inventory` / `subcontractor` |
| Purchase header | `purchaseTransactionsApi.create` → `POST /api/purchase-transactions` | `costs` |
| **Purchase invoice (local, posted)** | `purchaseTransactionsApi.postInvoice` → `POST /api/purchase-transactions/post-invoice` (GL + row + optional stock) | `costs` |
| Subcontractor IPC approve | `purchaseTransactionsApi.approve` → `POST /api/purchase-transactions/:id/approve` | admin / projects_manager |
| Custody settlement | `custodySettlementsApi.create/update` → `/api/custody-settlements` | `costs` |
| Custody approve | `custodySettlementsApi.approve` → `POST /api/custody-settlements/:id/approve` | admin or `ledger.create` |
| COA validation cache | `chartOfAccountsApi.list()`; auto **`POST /chart-of-accounts/ensure-missing`** (seed + warehouse extras) when codes missing | `costs` (read); ensure-missing for any COA consumer module |

**Why:** SQLite holds the authoritative user role/permissions for local mode; Firestore rules evaluate a separate `users/{uid}` doc that can drift. Client Firestore writes also failed when deployed rules were stale or used invalid dynamic map keys (`permissions[moduleKey]`).

**SQLite COA bootstrap:** On API start, if `chart_of_accounts` is empty, the server inserts the full **`CHART_OF_ACCOUNTS_SEED`** (`src/data/chartOfAccountsSeedData.ts`). Journal posting also calls **`ensure-missing`** for standard seed codes and dynamic **127…** warehouse leaves (from Firestore COA pickers). Do **not** use `chartOfAccountsApi.create` from the client for auto-patch — it requires `ledger` write.

**Rollback:** `accountingService.softDelete('purchase_transactions', id)` and `deleteTransaction` use local API deletes when `isLocalBackend`.

**Cloud-only mode** (`VITE_DATA_BACKEND` unset / `firebase`): still uses Firestore writes; keep `firestore.deployed.rules` reference-read patches and deploy via `npm run firestore:deploy-rules` (not `firebase deploy --only firestore:rules` — CLI may no-op with current `firebase.json` format).

**Local API startup (2026-06-06):** `server/src/app.ts` must import `{ errorHandler, notFound }` from `./middleware/errors.js`. If missing, `createApp()` throws `ReferenceError: notFound is not defined`, the API never listens, and the client sees **`Internal Server Error`** on `POST /api/auth/firebase-session`. COA bootstrap runs in `try/catch` so a seed failure does not block startup.

**SQLite FK before purchase save:** `purchase_transactions.project_id` → `projects(id)`, `contract_id` → `contracts(id)`. Firestore may have projects/contracts that SQLite does not. **`ensureLocalProjectExists`** (and for IPC **`ensureLocalContractExists`**) must run **before** `purchaseTransactionsApi.create`, not only before `createDistributedPurchaseInvoice`. For invoice rows, send **`contractId: null`** (not `''`) when there is no contract — empty string violates the FK. Server maps this to `SQLITE_CONSTRAINT_FOREIGNKEY` → Arabic message in `server/src/middleware/errors.ts` (surfaced in the UI as a misleading **`Firestore Error`** on path `purchase_transactions` because `handleFirestoreError` wraps all save failures).

### SQLite Tables (migrations 001–013)

| Table | Purpose |
|-------|---------|
| `material_groups` / `material_categories` | Materials tree (group → category with `unit`) |
| `boq_item_materials` | Which material categories may be consumed against each BOQ item |
| `purchase_invoices` | Header: Firestore `invoiceId`, `status` (draft/confirmed/posted) |
| `purchase_invoice_lines` | Lines with optional `boq_item_id`, `material_category_id` |
| `purchase_invoice_allocations` | Per-contract allocation of each line |
| `project_inventory` | Central warehouse per `project_id` + `material_category_id`: qty in/issued/returned/reserved, **`avg_unit_cost`** |
| `project_inventory_movements` | Audit log (receipt / issue / return / reserve / release) |
| `return_orders` / `return_order_lines` | Material returns from site to project warehouse |
| `contract_inventory` | **Legacy** — migration `009` merges balances into `project_inventory`; UI hidden except frozen transfers |
| `consumption_orders` / `consumption_order_lines` | Site issue orders (draft → confirmed); header stores **`expense_account_code` / `expense_account_name`** (migration **010**); lines tie BOQ + material + qty |
| `boq_actual_costs` | Actual cost per BOQ item: consumption (`materials`), contract expense (`other`), OHA load (`overhead`); FK optional `overhead_period_id` / `contract_expense_order_id` |
| `inventory_transfers` | Transfer requests between contracts |
| `inventory_transfer_lines` | Line items per transfer |
| `subcontractors` | Subcontractor master data |
| `subcontract_assignments` | BOQ item → subcontractor assignments |
| `subcontract_extracts` | Subcontractor payment extracts with deduction calculations |
| `users` | Local users (+ `assigned_contract_ids` JSON array) |
| `sessions` | Express sessions |
| `projects` / `contracts` / `boq_items` | Mirrored from Firestore for financial core use |
| `billing` | IPC records |
| `gl_transactions` / `gl_entries` | General ledger |
| `custody_settlements` / `custody_settlement_items` | Custody settlement workflow (draft → submit → approve → GL) |
| `purchase_transactions` / `purchase_transaction_items` | Purchase invoices + subcontractor IPC headers/lines |

### Materials Tree — Excel Import/Export

Rendered by `MaterialsTree.tsx` at the bottom of **Projects** and on the **Materials** tab in **Inventory** (`isLocalBackend` only).

| Action | Who | Notes |
|--------|-----|-------|
| **Export** | All users with `projects` view | Flat rows: group code/name + optional category code/name/unit |
| **Template** | admin / projects_manager | Sample rows (ar or en column headers) |
| **Import** | admin / projects_manager | `POST /api/materials/import` — creates new groups/categories; **skips** duplicate codes (no update-in-place) |

**Excel columns** (either language): `Group Code` / `كود المجموعة`, `Group Name` / `اسم المجموعة`, `Category Code` / `كود الصنف`, `Category Name` / `اسم الصنف`, `Unit` / `الوحدة`. Row with empty category code = group-only row.

Client: `src/lib/materialsTreeExcel.ts` → `materialsApi.importTree(rows)`.

### Opening inventory balances — Excel import (2026-08-05)

**Inventory → Balance** sidebar (local only): **Template** + **Import opening balances** when a project has a linked **127…** warehouse.

| Piece | Detail |
|-------|--------|
| Excel | `src/lib/inventoryOpeningExcel.ts` — columns: Category Code / كود الصنف · Quantity / الكمية · Avg Unit Cost / متوسط التكلفة |
| API | `POST /api/inventory/project/:projectId/opening-import` — admin / PM / `inventory.create` + project access |
| Stock | `upsertProjectInventoryReceipt` with `referenceType: 'opening_balance'`; **skip** if `project_inventory` row already exists |
| GL | One journal `INV-OPEN-{projectCode}-…` — Dr project **127…** / Cr **جاري الشركاء `31401001`** (`openingInventoryJournal.ts`) |
| Amount | `Σ roundMoney(qty × avgUnitCost)` — no VAT |

### Inventory & Materials Workflow
1. **Materials tree** — define groups/categories (`/api/materials` or Excel import); link categories to BOQ items (`/api/boq-materials`).
2. **Project warehouse COA** — warehouse accounts are 8-digit leaf accounts under prefix `127…` (parent/group `127`), selected/created/linked from `Inventory.tsx` → **Balance** tab. Link via `chart_of_accounts.projectId` + `projects.inventoryAccountCode`. Resolution: `src/lib/projectWarehouse.ts` (client) and `server/src/accounting/projectWarehouseGl.ts` (server). **Split-brain trap:** Firestore COA may show `active` while SQLite has `disabled` after `localCoaSync` / `syncCoaBatch` — fixed 2026-06-07 by preserving active on linked 127… rows + auto-reactivate on transfer approval. **Do not** disable COA when unlinking warehouse.
2b. **Opening balances (optional)** — Excel import on Balance tab (see above) when bringing existing stock onto books; otherwise continue with purchase invoices.
2c. **Warehouse receipt (unpriced)** — storekeeper `POST /api/warehouse-receipts` → on submit: `quantityIn++` + `quantityUnpriced++`, **no GL**. Purchasing approves with unit costs + supplier leaf `21101…` → `priceUnpriced` + journal `WR-…` Dr 127 / Cr supplier. UI: Inventory → **استلام مخزني**. Parallel to Actual Costs invoice (do not double-enter same goods).
3. **Purchase invoice** — entered in **Actual Costs** (invoice tab), not Inventory. `status: 'confirmed'` on distributed invoice → **100%** `project_inventory` receipt (VAT-inclusive avg cost) · GL Dr the linked `127xxxxx` warehouse account (no contract expense from invoice). Firestore projects/contracts/BOQ may exist without SQLite rows — **mirror project** (and consumption flow mirrors contract/BOQ) before FK-dependent writes.
4. **Consumption** — `POST /api/consumption-orders` with **`lines[]`** (multi-BOQ + per-line expense). If issue draws **unpriced** stock → status `pending_cost` + **reserve** (no issue/GL/BOQ yet); purchasing `POST /:id/approve-cost` after receipts priced. Otherwise draft → `POST /:id/confirm` as today. GL via **`consumptionJournal.ts`**. UI: **`ConsumptionOrderModal`**; History shows pending-cost badge. **Do not** confirm `pending_cost` via normal confirm.
5. **Return** — `POST /api/return-orders` → `confirm`: reverses BOQ actual + returns qty to project warehouse; GL via **`recordReturnToWarehouse`** in **`ReturnOrderModal`** (expense = consumption order account, else GL lookup on `CON-…` reference).
6. **Inter-project transfer** — `POST /api/inventory/project-transfers` (alias `/api/project-inventory-transfers`): reserve on create; `approve-b` → `pending_projects`; **`approve-projects`**: stock move at original cost + GL **Dr to 127… / Cr from 127…** (`recordProjectWarehouseTransfer` + `postProjectTransferJournal`, ref `PTRF-…`). Body on approve may pass warehouse account codes. Mirror projects in SQLite before create. UI: **Inventory → Project transfers**.
7. **Transfer (legacy contracts)** — complete pending `inventory_transfers` only; no new UI for `contract_inventory` transfers.
8. **Available qty** = `quantity_balance` on `project_inventory` (reserved qty already deducted). **Unpriced qty** = `quantity_unpriced` (subset of physical; issue may go `pending_cost`).

### API Endpoints (local backend)

| Prefix | Module |
|--------|--------|
| `GET/POST /api/materials/groups` … | Materials tree CRUD |
| `POST /api/materials/import` | Bulk import from Excel (`{ rows: [{ groupCode, groupName, categoryCode?, … }] }`) |
| `GET /api/boq-materials/:boqItemId/allowed` | Materials allowed for a BOQ item (includes `groupCode` / `groupName`) |
| `GET /api/boq-materials/by-material/:materialCategoryId?contractId=` | BOQ items linked to a material category (multi-BOQ allocation picker) |
| `GET /api/boq-materials/contract/:contractId/link-counts` | Map `boqItemId → link count` (BOQ status badges) |
| `GET /api/boq-materials/:boqItemId/consumed-quantity` | Prior issued qty for BOQ item (link modal warning) |
| `GET /api/boq-materials/contract/:contractId/unlinked-report` | Unlinked BOQ items + unused material categories |
| `GET /api/boq-materials/:boqItemId/can-delete` | Block delete if links / consumption / actual costs |
| `POST /api/boq-materials/:boqItemId/inherit` | Copy material links from source BOQ item (new item / VO) |
| `POST/PUT/DELETE /api/boq-materials` | Link/unlink BOQ ↔ material |
| `POST /api/sqlite-core/purchase-invoices/distributed` | Distributed invoice (+ inventory when confirmed) |
| `GET/POST/PUT/DELETE /api/purchase-transactions` | Purchase invoices + subcontractor IPC |
| `POST /api/purchase-transactions/:id/approve` | Subcontractor IPC approve → GL |
| `GET/POST/PUT/DELETE /api/custody-settlements` | Custody settlements |
| `POST /api/custody-settlements/:id/approve` | Custody approve → GL |
| `GET/POST /api/accounting-periods` · `POST /:id/lock|unlock` · `PUT /:id/allowed-users` | Quarterly GL period lock (admin manage; list: ledger/overhead) |
| `GET /api/inventory?contractId=` | Contract inventory rows (by material category) |
| `GET /api/inventory/boq-actuals?contractId=X` | Purchase totals + inventory balance by BOQ item |
| `GET /api/reports/boq-cost-breakdown?projectId=&contractId=&level=project\|contract\|boq_item&dateFrom=&dateTo=` | BOQ direct + allocated indirect costs by project/contract/item (`reports` perm) |
| `GET/POST /api/consumption-orders` | List/create consumption orders (`lines[]` multi-BOQ + optional **`expenseAccountCode` / `expenseAccountName`**) |
| `POST /api/consumption-orders/:id/confirm` | Confirm draft → stock + **`boq_actual_costs`** per line + GL (`consumptionJournal.ts`) |
| `POST /api/consumption-orders/:id/approve-cost` | Finalize `pending_cost` after unpriced receipts are priced |
| `GET/POST /api/warehouse-receipts` · `POST /:id/submit\|approve\|reject` | Storekeeper receipt (unpriced qty) → purchasing cost + GL `WR-…` |
| `GET/POST/DELETE /api/consumption-allocation-templates` | Saved BOQ allocation templates per contract + material |
| `GET /api/return-orders` | List return orders (with lines; **`consumptionOrderNumber`** on lines) |
| `GET /api/return-orders/returnable/:consumptionOrderLineId` | Returnable qty + consumption expense account |
| `POST /api/return-orders` | Create return draft |
| `POST /api/return-orders/:id/confirm` | Confirm return → inventory + BOQ; response may include expense account fields |
| `GET /api/inventory-maintenance/stats` | Admin: row counts for warehouse tables |
| `POST /api/inventory-maintenance/purge` | Admin: `{ deleteMovements?, resetBalances? }` — optional `projectId` scope |
| `GET /api/inventory/project/:projectId/summary` | Project warehouse rows + `quantityAvailable` |
| `POST /api/inventory/project/:projectId/opening-import` | Opening balances Excel rows → stock + GL Dr 127… / Cr 31401001 (skip existing) |
| `GET/POST /api/inventory/project-transfers` | Inter-project transfers (reserve on create) |
| `POST /api/inventory/project-transfers/:id/approve-b` | Destination acceptance → `pending_projects` |
| `POST /api/inventory/project-transfers/:id/approve-projects` | PM approve → stock + GL; optional warehouse account codes in body |
| `GET/POST /api/project-inventory-transfers` | Same router (legacy path prefix) |
| `GET /api/inventory-transfers` | Legacy **contract** transfers (pending only) |
| `GET /api/subcontractors` | List subcontractors |
| `POST /api/subcontractors` | Create subcontractor |
| `GET/POST /api/subcontract-assignments` | BOQ item assignments |
| `GET/POST /api/subcontract-extracts` | Extracts |
| `POST /api/subcontract-extracts/:id/submit` / `approve` / `pay` | Status transitions |

### Coding Rules (SQLite backend)
- Use `getDb()` from `server/src/sqlite/appDb.ts` — never open the DB directly.
- Wrap multi-statement operations in `db.transaction(() => { ... })()` for atomicity.
- Always use `rowToObj()` to convert snake_case rows to camelCase before sending to frontend.
- New schema changes go in a new migration file (`00N_description.sql`) — never alter existing migration files.
- `requireAuth` + `requirePermission('module_key')` on every protected route.

### Firestore ↔ SQLite mirror (local dev)

Operational master data often lives in **Firestore** first; SQLite holds the financial core. When a write hits SQLite FKs (`projects`, `contracts`, `boq_items`, `material_categories`):

- **Read-through:** try local API (`projectsApi.get`, `boqApi.list`, …); on **404** load from Firestore and **`create`** into SQLite with the **same document `id`**.
- **Idempotent sync:** parallel React Strict Mode or double `useEffect` may race — treat **`UNIQUE constraint failed`** on `create` as “already exists” (see `ConsumptionOrderModal` helpers).
- **Purchase invoices** need **`project_id`** on `purchase_invoices` and **`project_inventory`** — always ensure project row exists before `POST /sqlite-core/purchase-invoices/distributed`.
- **BOQ for consumption** must exist in SQLite for `boq_item_materials` / order lines; Firestore-only BOQ is synced on modal open, not at BOQ save time (unless user also uses local CRUD).
- **Inventory contract list:** `Inventory.tsx` always merges Firestore `contracts` with `contractsApi.list()` — if the UI shows only one contract for a multi-contract project, check Firestore `projectId` on each contract doc (and legacy rows that stored `projectCode` instead of doc id).

---

## Known Constraints

- **`useFirestoreQuery` factory deps**: the factory function closes over component state — put all reactive values in the `deps` array (second argument). Forgetting a dep causes stale queries (same bug as `useEffect` deps).
- All **`where(...) + orderBy(...)` (+ `limit`)** combos require composite indexes — see **`firestore.indexes.json`**. Adding a new `orderBy` without a matching index will throw at runtime (Firebase Console link in the error).
- `firestoreDatabaseId` in `firebase-applet-config.json` targets a named (non-default) Firestore database.
- Arabic (`ar`) is the primary language; all UI strings must use `t('key')` from `useLanguage()` — never hardcode Arabic/English text in JSX.
- `boq_items` and `contracts` collections use `isDeleted != true` (inequality) rather than `== false` — keep consistent to avoid index conflicts.
- `GeneralLedger.tsx` uses filter-gated transaction loading + pagination (`transactionLimit` default 50 journal / 5000 statement + "Load More" on journal). **Local mode: `glApi.transactionsQuery` only** — no Firestore merge. See **General Ledger — Journal & Statement Filters**.
- **Capped report / screen data:** totals that depend on **full** GL history may differ from capped listeners (Reports, Liquidity, custody context in Actual Costs). For audit-grade full history use GL / exports or planned server-side aggregates.
- **Journal entry `SearchableSelect` onChange**: Never call `handleEntryChange` twice from the same `onChange` handler — React batches both updates from the same stale closure and the second call wins, silently dropping the first field's value. Instead, make `handleEntryChange` handle related field side-effects internally (e.g., auto-fill `accountName` when `accountCode` changes).
- **Named Firestore database**: `firebase-applet-config.json` sets `firestoreDatabaseId: "ai-studio-ed995a7f-1301-474a-bea7-988b7ce5664c"`. Admin user docs must be created in this named database — not the default `(default)` database. Firebase Console direct URL: `https://console.firebase.google.com/project/gen-lang-client-0599011721/firestore/databases/ai-studio-ed995a7f-1301-474a-bea7-988b7ce5664c/data`.
- **Firestore document `id` spread order**: always use `{ ...d.data(), id: d.id }` (Firestore doc ID last) when mapping snapshot docs. Using `{ id: d.id, ...d.data() }` allows an `id: ''` field stored in Firestore data to overwrite the real doc ID, causing React duplicate-key warnings (`Encountered two children with the same key, ''`). All `listenQuery` callbacks in components must follow this pattern.
- **React list keys**: never use bare `key={row.id}` or `key={a.id || a.accountCode}` when either value can be `""` — both collapse to duplicate `key=""`. Use **`listKey(id, index, prefix)`** or **`compositeListKey(primary, secondary, index, prefix)`** from `src/lib/utils.ts`. **`useFirestoreQuery`** already maps `{ ...d.data(), id: d.id }`. **`BOQ.tsx`** uses **`normalizeBoqItem()`** fallback ids. Hot spots: **`GLChartOfAccounts`**, **`Inventory`** (warehouse COA picker), **`Reports`** project stats, **`VoOrderModal`** / **`VoOrdersPanel`**.
- **Stale Vite bundle (`EADDRINUSE` :3000 or :3001):** If `npm run dev:local` logs **`EADDRINUSE`** on **either** child, an old process may still serve stale JS (duplicate-key fixes missing) or an old API (404 on new routes). Fix: stop listeners on **3000 and 3001** (`netstat -ano | findstr :3000` / `:3001` then `taskkill /PID … /F`), restart **`npm run dev:local`**, then **hard refresh** (`Ctrl+Shift+R`) on **`http://localhost:3000`**.
- **Dual-backend role sync**: SQLite user role is independent of Firestore role — see *Dual-Backend Role Sync* section above for the fix.
- **Local save FK (`purchase_transactions`):** Error *«المشروع أو الصنف غير مسجّل في قاعدة البيانات المحلية…»* = SQLite FK, not Firestore rules. Fix: (1) **`npm run local:api`** running; (2) sync project (+ contract for IPC) into SQLite **before** purchase POST — Settings or `ensureLocalProjectExists` / `ensureLocalContractExists` in `ActualCosts.tsx` **ahead of** `purchaseTransactionsApi.create`; (3) use `null` not `''` for optional `contractId` on invoices. Reference pattern: `ConsumptionOrderModal.tsx`, `Inventory.tsx`.
- **Warehouse COA split-brain (local mode):** Shown as active in Firestore / old GL listener but **`disabled` in SQLite** → Inventory transfer approval fails with *«حساب المخزن (127…) معطّل»*. Causes: (1) old «delete warehouse» set `status: disabled`; (2) `bootstrapLocalCoaFromFirestore` / `syncCoaBatch` overwrote SQLite from Firestore. Fixes (2026-06-07): `syncCoaBatch` keeps linked 127… active; `ensureLinkedWarehouseActiveForProject` + server `resolveProjectWarehouseAccount` reactivates; GL reads SQLite via `useChartOfAccountsRef`; `accountingService.updateAccount` writes SQLite in local mode. Diagnose: `sqlite3 server/data/financial-core.sqlite "SELECT account_code, status, project_id FROM chart_of_accounts WHERE account_code GLOB '127?????';"`
- **Dev origin:** Use **`http://localhost:3000`** only (not `127.0.0.1`) — `devOriginGuard.ts` redirects; Vite `strictPort: true`.
- **Stale local API (`EADDRINUSE` :3001):** see combined **:3000 + :3001** note above. Sanity: unauthenticated `GET /api/settings/push-to-production/preview` should return **401**, not **404**.
- **Local vs Electron GL counts:** Local **`DATABASE_URL`** and Railway/Electron are **different databases** until **Push to production**. Electron count = Railway truth for production users.
- **Electron UI after deploy:** Setup.exe loads **hosted SPA** (`production-url.json` → Railway) — **`git push` + Railway redeploy** updates content; **`electron:publish`** updates **shell only** (OAuth, cache policy). Stale UI = Chromium cache in `persist:webcost` — full quit + reopen; **Ctrl+Shift+R** (shell with `reloadIgnoringCache`); packaged shell **clears HTTP cache on startup** after `electron/main.ts` fix + new Setup. **Data fixes** (migrations, `local:backfill-boq-rates`) must run on **Railway Postgres**, not local DB. See **`docs/RAILWAY_DEPLOY.md`** «الإصلاحات لا تظهر على Electron».
- **`useUserAccessScope` + password login:** Gating role on Firebase `onAuthStateChanged` resets admin to `user` on Electron — empty Inventory project picker / «فشل تحميل المشاريع». Fix (2026-06-26): local mode uses `PermissionsContext.role` + `/auth/me` for contracts only. **`POST /auth/login`** must call `req.session.save()` before response (same as `firebase-session`).
- **`App.tsx` hook order (TDZ):** any `useEffect`/`useCallback` that references `userPermissions`, `userRole`, or `defaultModuleRef` must appear **after** those declarations. Violating this causes **`ReferenceError: Cannot access '…' before initialization`** at runtime (minified bundle).
- **`boqApi.list` query string:** always pass `?contractId=` or `?projectId=` (e.g. `` boqApi.list(`?projectId=${id}`) ``). Passing a bare id (`boqApi.list(contractId)`) hits `GET /boq-items/:id` → **404** and empty quick-link BOQ lists in consumption.

---

---

## 🔴 HANDOFF — ربط BOQ↔أصناف + فاتورة مشتريات متعددة + صرف فوري ✅ (2026-07-24)

> **جلسة 2026-07-24:** شارات ربط المواد · منع حذف بند BOQ (نافذة عائمة) · ربط فوري من الصرف · تقرير غير المربوط · وراثة روابط للبنود الجديدة وVO · فاتورة مشتريات: فلتر BOQ + صنف↔عدة بنود · إصلاح تحميل بنود المشروع في الربط الفوري.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **شارات الحالة** | عدد الروابط على أيقونة Package في BOQ (`bg-blue-600`) | `BOQ.tsx` · `GET …/link-counts` |
| **منع الحذف** | `can-delete` → **`DeleteBlockedModal`** (بدل `alert`) | `DeleteBlockedModal.tsx` · `BOQ.tsx` |
| **ربط فوري (صرف)** | صلاحية مضبوطة · بلا تكاليف/أسعار · قائمة بنود **المشروع** | `QuickLinkMaterialModal.tsx` · `ConsumptionOrderModal.tsx` |
| **تحذير كمية منصرفة** | في `BoqMaterialsModal` عبر `consumed-quantity` | `BoqMaterialsModal.tsx` |
| **تقرير غير المربوط** | من رصيد المخزون | `UnlinkedMaterialsReport.tsx` · `Inventory.tsx` |
| **وراثة روابط** | بند BOQ جديد (نفس القسم) · بنود VO جديدة من مصدر | `BOQ.tsx` · `VoOrderModal.tsx` · `POST …/inherit` · `variationOrders` → `newBoqItemIds` |
| **فاتورة مشتريات** | فلتر BOQ بمركز تكلفة أو مشروع المخزن · `boqItemIds[]` متعدد · بيانات الصنف مستقلة عن BOQ | `ActualCosts.tsx` |
| **إصلاح URL صرف** | `boqApi.list(\`?projectId=\`)` بدل `list(contractId)` (كان 404) | `ConsumptionOrderModal.tsx` |
| **i18n** | `session_idle_logout` · `consume_order_quick_link` · `vo_inherited_materials` | `LanguageContext.tsx` |

### لا تراجع

- **ربط فوري:** لا `boqApi.list(contractId)` بدون `?` — يُفسَّر كـ `GET /boq-items/:id`.
- **فاتورة:** لا تنسخ وصف/وحدة/سعر بند BOQ إلى سطر الصنف المشترى عند الربط.
- **حذف BOQ:** استخدم **`DeleteBlockedModal`** — لا `alert()` للمتصفح.
- **شارات الربط:** لون غير أخضر (`bg-blue-600`).

### تحقق

Golden path: BOQ → شارة عدد الروابط · محاولة حذف بند مربوط → نافذة عائمة؛ مخزون → صرف → ربط فوري → تظهر بنود مشروع الصرف؛ فاتورة مشتريات → مركز تكلفة → بنود ذلك العقد فقط · ربط صنف بعدة بنود BOQ دون تغيير وصف الصنف؛ مخزون → تقرير الربط.

```powershell
# بعد سحب كود boqMaterials الجديد: أعد تشغيل API إن ظهر 404 على المسارات الجديدة
npm run dev:local
```

---

## 🔴 HANDOFF — Banks split-view (accounts + transactions) ✅ (2026-07-02)

> **جلسة 2026-07-02:** دمج **الحركات + الشيكات** في تبويب **«المعاملات»** · كشف حساب بنكي + بيانات الحساب في تبويب واحد · إخفاء بطاقات الإجماليات على الحسابات والمعاملات.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **كشف حساب بنكي** | split-view: قائمة أسماء بنوك + كشف GL في المنطقة الرئيسية؛ حذف تبويب `account_statement` | `BankAccountsTab.tsx` · `BankAccountStatementPanel.tsx` · `Banks.tsx` |
| **المعاملات** | تبويب واحد يدمج movements + cheques؛ sidebar موحّد + فلتر نوع/بنك/بحث | `BankTransactionsTab.tsx` · `BankMovementsTab.tsx` · `BankChequesTab.tsx` |
| **إجماليات** | بطاقات KPI الأربع **مخفية** على `accounts` و `transactions` فقط | `Banks.tsx` |
| **ERP / deep-link** | `movements`/`cheques` → `transactions`؛ `account_statement` → `accounts` | `normalizeBankTab()` · `moduleMenus.ts` · `moduleViewPermissions.ts` |
| **i18n** | `banks_menu_transactions` · `banks_screen_transactions_*` · `banks_transactions_new_*` | `LanguageContext.tsx` |

### لا تراجع

- لا تُعيد تبويبي **الحركات** و**الشيكات** منفصلين في **`Banks.tsx`** / **`moduleMenus.ts`** — استخدم **`transactions`**.
- لا تُظهر بطاقات الإجماليات على **المعاملات** أو **كشف حساب بنكي** (تبقى على **كشوف البنك** فقط).
- **`BankMovementsTab`** / **`BankChequesTab`**: عند **`embedded`** لا تعرض header/table كامل — **`panelMode`** يحدد create vs detail.

### تحقق

Golden path: البنوك → **المعاملات** → اختر حركة/شيك → تفاصيل + ترحيل/تحصيل؛ «حركة جديدة» / «شيك جديد»؛ لا KPI cards في الأعلى. **كشف حساب بنكي** → اختر بنك → كشف GL؛ «بيانات الحساب» للتعديل.

```powershell
npm run test -- src/lib/glAccountBalance.test.ts
```

---

## 🔴 HANDOFF — BOQ rate breakdown + React list keys ✅ (2026-06-29)

> **جلسة 2026-06-29:** حفظ تفاصيل أسعار BOQ في Postgres · backfill · إصلاح تحذيرات Console `Encountered two children with the same key, ''`.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **أعمدة rates BOQ** | `rateMaterials` · `rateLabour` · `rateEquipment` · `rateDirect` · `rateOverheadPct` · `rateProfitPct` | migration `20260628120000_boq_item_rate_breakdown` · `BOQ.tsx` save payload |
| **تكلفة تقديرية (تقارير)** | `tenderAmountExcludingProfit()` — OH بدون ربح؛ fallback 12% profit | `src/lib/boqPricing.ts` · `Reports.tsx` |
| **Backfill rates** | من Firestore backup أو `--live` | `npm run local:backfill-boq-rates` · `server/src/scripts/backfillBoqRateFields.ts` |
| **React list keys** | `listKey` · `compositeListKey` — لا `key=""` | `src/lib/utils.ts` · `BOQ.tsx` · `GLChartOfAccounts.tsx` · `Inventory.tsx` · `Reports.tsx` · `VoOrderModal.tsx` · `VoOrdersPanel.tsx` |
| **i18n login** | `login_fresh_required_hint` · `login_desktop_password_only` | `LanguageContext.tsx` · `Login.tsx` |

### لا تراجع

- **`key={acc.id \|\| acc.accountCode}`** — إذا كلاهما `""` يعيد تحذير React؛ استخدم **`compositeListKey(accountCode, id, index, prefix)`**.
- **`npm run dev:local`** يجب أن يستمع على **:3000 و :3001** معًا — `EADDRINUSE` = bundle قديم في المتصفح.
- **`normalizeBoqItem()`** يولّد fallback id — لا تعتمد على `id` خام من API/Firestore في `key={item.id}` بلا index.

### تحقق

```powershell
npx prisma migrate deploy
npm run local:backfill-boq-rates -- --live   # بعد migrate على Railway/محلي
npm run test -- src/lib/boqPricing.test.ts
# dev: أوقف :3000/:3001 ثم npm run dev:local → Ctrl+Shift+R على BOQ — لا duplicate key warnings
```

---

## 🔴 HANDOFF — Banks GL balance hints ✅ (2026-06-28)

> **جلسة 2026-06-28:** عرض **رصيد البنك المتاح** و**رصيد حساب الطرف المقابل** عند إصدار شيك أو تحويل/حركة بنكية.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **حساب الرصيد** | `buildGlAccountBalanceMap` — Σ(debit−credit) per `accountCode` | `src/lib/glAccountBalance.ts` · `glAccountBalance.test.ts` |
| **تحميل GL** | مرة واحدة في موديول البنوك (local `glApi` · cloud Firestore capped) | `useGlAccountBalances.ts` · `Banks.tsx` |
| **الواجهة** | تلميح تحت اختيار البنك + الطرف المقابل (COA) | `GlAccountBalanceHint.tsx` · `BankChequesTab.tsx` · `BankMovementsTab.tsx` |

### لا تراجع

- التلميح **للعرض فقط** — لا يغيّر الترحيل أو التحقق من المبلغ.
- رصيد البنك = حساب GL المرتبط (`coaAccountId` أو `code`)، وليس حقل `openingBalance` التشغيلي وحده.

### تحقق

```powershell
npm run test -- src/lib/glAccountBalance.test.ts
```

Golden path: البنوك → شيكات/حركات → اختر بنك + مورد/عهدة/314… → يظهر الرصيد أسفل القائمة.

---

## 🔴 HANDOFF — Custody settlement · IPC approve · invoice preview ✅ (2026-06-27)

> **جلسة 2026-06-27:** تسوية عهدة (قائمة + اعتماد قبل GL) · اعتماد مستخلص مقاول · معاينة فاتورة مشتريات من الجدول.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **تسوية عهدة** | `custody_settlements` · `SET-{projectCode}-NNNN` · draft/submit/approve · GL عند الاعتماد فقط | `GLCustodySettlement.tsx` · `custodySettlements.ts` · `custodySettlementJournal.ts` · migration `20260627120000` |
| **IPC مقاول** | `draft` → `submitted` → `approved` · GL `POST /purchase-transactions/:id/approve` (admin/PM) | `purchaseTransactions.ts` · `subcontractorIpcJournal.ts` · `ActualCosts.tsx` |
| **فاتورة مشتريات** | نقر صف → معاينة · مرحّلة = read-only · `invoiceLines` في API | `ActualCosts.tsx` · `purchaseTransactions.ts` |
| **إشعارات** | `custody_settlement_pending` · deep-link | `NotificationBell.tsx` · `shellNavigation.ts` |

### لا تراجع

- **تسوية عهدة:** الحفظ/التقديم **لا** يرحّل GL — فقط **`POST /:id/approve`**.
- **IPC:** لا `recordSubcontractorIPC` على الحفظ — GL عند **`approve`** فقط.
- **فاتورة local:** أرسل **`invoiceLines`** في body الـ API (لا header فقط).

### تحقق

```powershell
npx prisma migrate deploy
npm run local:api   # بعد pull — migration custody_settlements
npm run build
npx tsc -p server/tsconfig.build.json --noEmit
```

Golden path: Actual Costs → تسوية عهدة → تقديم → اعتماد (ledger/admin) → GL؛ IPC → تقديم → اعتماد PM → GL؛ فاتورة → حفظ → نقر صف → معاينة.

---

## 🔴 HANDOFF — Fixed asset invoice · money 2dp · journal auth ✅ (2026-06-26)

> **جلسة 2026-06-26 (مساءً):** فاتورة **أصل ثابت** في التكاليف الفعلية · موديول **الأصول الثابتة** · إصلاح ترحيل القيود مع **password login** · **منزلتان عشريتان** للمبالغ.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **فاتورة أصل ثابت** | قائمة **11…** · حقل مبلغ · إخفاء بنود خامات/مخزن · `inputCls` للثيمات | `ActualCosts.tsx` |
| **ترحيل GL (password/Railway)** | `assertJournalWriteAuth()` — local لا يتطلب Firebase user | `accountingService.ts` |
| **backend detect** | prod + `/api` → `isLocalBackend` | `dataBackend.ts` · `generate-vite-env.mjs` |
| **قيد فاتورة مشتريات** | `buildPurchaseWithholdingJournalLines` — supplier = (base+VAT)−WHT | `accountingService.ts` · `journal.ts` |
| **مال 2dp** | `roundMoney` ×100/100 · `MONEY_TOLERANCE=0.005` · `formatMoney` 0.00 | `money.ts` (client+server) |
| **الأصول الثابتة** | قوائم **119…** · **52…** · مركز تكلفة | `FixedAssets.tsx` |

### لا تراجع

- لا `auth.currentUser` وحده لترحيل القيود في **local/Railway** (password login).
- لا تقريب كل بند مستقل (مدين/دائن) بأعداد صحيحة — **2dp** + رصيد المورد مشتق.
- فاتورة أصل ثابت: لا تتطلب مخزن **127…** ولا `materialCategoryId`.

### تحقق

Golden path: Actual Costs → فاتورة → **تسجيل كأصل ثابت** → مورد + حساب **11…** + مبلغ → حفظ (password أو Google على Railway) → Fixed Assets → **إكمال الإعداد** (119 / 52 / مركز تكلفة).

```powershell
npm run test -- server/src/lib/money.test.ts
```

---

## 🔴 HANDOFF — Admin projects + password login scope ✅ (2026-06-26)

> **جلسة 2026-06-26:** مدير النظام (`myline78@gmail.com`) على **Electron/Railway** — «فشل تحميل المشاريع» / قائمة مشاريع فارغة في المخزون والمشاريع رغم دور admin.

### السبب

1. **`useUserAccessScope`** في local mode كان يعتمد على Firebase `onAuthStateChanged` — **تسجيل الدخول بكلمة المرور في Electron لا ينشئ Firebase user** → الدور يُعاد إلى `user` → Inventory يقيّد `myContractIds = []` (ليس `null` للمدير).
2. **`Projects.tsx`** لم يعرض أخطاء `useApiQuery` — فشل API (401/403) يظهر كقائمة فارغة بلا toast.
3. **`POST /auth/login`** لم يكن يستدعي `req.session.save()` صراحةً (بخلاف `firebase-session`) — احتمال فقدان cookie الجلسة في Electron.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **نطاق الدور** | local: `role` من `PermissionsContext`؛ `assignedContractIds` من `/auth/me` فقط | `useUserAccessScope.ts` |
| **أخطاء المشاريع** | `apiLoadErrorToast` للمشاريع/العقود | `Projects.tsx` |
| **حفظ الجلسة** | `req.session.save()` بعد password login | `server/src/auth/routes.ts` |

### لا تراجع

- لا تعِد ربط **`role`** في local mode بـ `auth.currentUser` فقط.
- Inventory: `myContractIds = null` لـ **admin** و **projects_manager** — يعتمد على `userRole` من `useUserAccessScope`.

### تحقق

Golden path (Electron → Railway): admin password login → **Projects** + **Inventory → مخزن المشروع** — dropdown المشاريع ممتلئ؛ toast واضح عند 401/403.

إن القائمة فارغة **بدون خطأ** → جدول `projects` فارغ على Railway (Push to production أو إنشاء مشروع). إن **403** → `npx tsx server/src/scripts/promoteGoogleAdminPg.ts <email>` على `DATABASE_PUBLIC_URL`.

---

## 🔴 HANDOFF — Shell single-module policy ✅ (2026-06-26)

> **جلسة 2026-06-26:** سياسة **موديول واحد** موحّدة لكل الثيمات (dark · soft · light · erp) — إغلاق الموديول السابق عند فتح جديد؛ **الآلة الحاسبة** استثناء.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **سياسة مشتركة** | `partitionExclusiveShellWindows`, `normalizeShellModuleId` (`display`→`general`), `SHELL_COEXIST_MODULE_IDS` = calculator | `src/lib/shellWindowPolicy.ts` · `shellWindowPolicy.test.ts` |
| **Sidebar themes** | `openWindow` / `restoreMinimized` — close previous (not minimize stack) | `App.tsx` |
| **ERP** | workspace → `closeShellOverlayWindows()`; general settings → `erp.closeWorkspace()` + overlay | `App.tsx` `ErpShellContent` · `navigateToModule` |
| **توثيق** | جدول ثيمات · قواعد coding · workflow test | `CLAUDE.md` |

### لا تراجع

- فتح **دفتر اليومية** (أو أي موديول) بينما **إعدادات عامة** مفتوحة → يجب **إغلاق** الإعدادات (ERP overlay + sidebar window).
- لا تُعاد سياسة **minimize-all-others** عند `openWindow` للموديولات الرئيسية.
- **`manual`**: sidebar = window (exclusive); ERP = **`ErpWorkspace`** slot.

### تحقق

```powershell
npm run test -- src/lib/shellWindowPolicy.test.ts
```

Golden path: كل ثيم → Palette (إعدادات عامة) → أي موديول رئيسي → الإعدادات مغلقة؛ مع الآلة الحاسبة مفتوحة → الحاسبة تبقى.

---

## 🔴 HANDOFF — Settings admin sections ✅ (2026-06-26)

> **جلسة 2026-06-26:** إصلاح **مراكز التكلفة غير المباشرة** + **سجل النشاط** + **بيانات تجريبية** — كانت مخفية (dark/soft/light) أو فارغة (ERP).

### السبب

`Settings.tsx` كان يجلب الدور عبر **`authApi.me()`** منفصل (timeout 5s) → `currentUserRole` يبقى `'user'` → أقسام admin لا تظهر في sidebar؛ ERP menu يعرض التبويبات لكن المحتوى فارغ.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **دور admin** | `usePermissions().isAdmin` من `PermissionsContext` | `Settings.tsx` |
| **ERP views** | `useErpModuleView` + `consumePendingShellView('settings')` | `Settings.tsx` |
| **Sub-view gates** | `SETTINGS_ADMIN_VIEW_IDS` · COA needs `ledger.view` | `moduleViewPermissions.ts` |
| **ERP menu** | كل tab عبر `canOpenModuleView(..., { isAdmin })` | `TopNavBar.tsx` |
| **اختبارات** | 6 cases | `moduleViewPermissions.test.ts` |

### لا تراجع

- لا تعِد `authApi.me()` لتحديد ظهور `cost_centers` / `activity` / `sample_data`.
- `cost_centers` يبقى **`isAdmin && isLocalBackend`**.

### تحقق

```powershell
npm run test -- src/lib/moduleViewPermissions.test.ts
```

Golden path: admin + `dev:local` → Settings → مراكز غير مباشرة + سجل نشاط (sidebar + ERP) → المحتوى يظهر.

---

## 🔴 HANDOFF — General Settings persistence + TDZ ✅ (2026-06-26)

> **جلسة 2026-06-26 (مساءً):** حفظ **إعدادات العرض** (ثيم · لغة · شاشة البداية) · **«دون»** كسطح مكتب فارغ · إصلاح **crash** عند التحميل.

### السبب

1. **لم يُحفظ شيء** بعد تسجيل كلمة المرور — الكود كان يتحقق من `auth.currentUser` فقط؛ الجلسة المحلية = Express cookie بدون Firebase user.
2. **«دون»** — `resolveStartupModule('none')` → `moduleId: null` ثم `?? DEFAULT_MODULE` أعاد **ledger**.
3. **TDZ** — `useEffect` لـ `USER_PREFS_UPDATED_EVENT` كان **قبل** `userPermissions` / `defaultModuleRef` → `Cannot access 'T' before initialization`.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **حفظ موحّد** | `saveUserPreferences` · `canPersistUserPreferences` | `userPreferences.ts` · `server/.../settings.ts` (`defaultLanguage`) |
| **شاشة «دون»** | `resolveSavedDefaultModulePreference` — لا coercion إلى ledger | `shellNavigation.ts` · `App.tsx` |
| **طباعة admin** | `PrintSettingsPanel` — `canPersistUserPreferences` + `isAdmin` | `GeneralSettings.tsx` · `PrintSettingsPanel.tsx` |
| **TDZ** | نقل مستمع prefs **بعد** state/refs | `App.tsx` |
| **اختبارات** | 4 cases startup/none | `shellNavigation.test.ts` |

### لا تراجع

- لا تستخدم `auth.currentUser` وحده للتحقق من إمكانية الحفظ في local mode.
- لا `startup.moduleId ?? DEFAULT_MODULE` عند تطبيق تفضيل المستخدم المحفوظ.
- لا تضع hooks تعتمد على `userPermissions`/`defaultModuleRef` **فوق** تعريفها في `App.tsx`.

### تحقق

```powershell
npm run test -- src/lib/shellNavigation.test.ts
npm run build
```

Golden path: Palette → غيّر ثيم/لغة/«دون» → أغلق → أعد الفتح → محفوظ؛ التطبيق يحمّل بدون ReferenceError.

---

## 🔴 HANDOFF — دليل الاستخدام (Operations Manual) ✅ (2026-06-21)

> **جلسة 2026-06-21:** دليل عمليات داخل التطبيق — **61 موضوعاً** · أزرار **`?`** سياقية · نافذة دليل كاملة · اختبارات صلاحيات وترجمات.

### ما تم (مراحل 0–11)

| المرحلة | المحتوى | موضوعات |
|---------|---------|---------|
| 0–6 | costs · technical · inventory · ledger · banks | ~32 |
| 7 | fixed assets | +3 |
| 8 | payroll | +11 |
| 9 | reports (8 tabs + print/filters) | +9 |
| 10 | settings · GeneralSettings · calculator | +9 |
| 11 | verify — permissions fix + vitest | — |

### البنية

| مكوّن | مسار |
|--------|------|
| السجل | `src/lib/operationsManual.ts` — `MANUAL_TOPICS`, `isManualTopicAllowed`, `resolveManualTopics` |
| النافذة | `src/components/OperationsManual.tsx` (`module id: manual`) |
| زر المساعدة | `src/components/help/ManualHelpButton.tsx` — مخفي إذا الموضوع غير مسموح |
| المحتوى | `src/components/help/ManualTopicContent.tsx` |
| i18n | `LanguageContext.tsx` — مفاتيح `manual_*` (ar/en) |
| اختبار | `src/lib/operationsManual.test.ts` |

### قواعد صلاحيات (لا تراجع)

- **`topic.permission` يُفحص قبل `viewId`** — مثال: COA في الإعدادات = `ledger.view` **+** `settings`.
- **`ManualHelpButton`**: لا يظهر بدون `isManualTopicAllowed`.
- **`display` / `calculator` / `manual`**: كل المستخدمين المسجّلين.

### تحقق

```powershell
npm run test -- src/lib/operationsManual.test.ts   # 61 topics · ar/en keys
```

### golden path

1. أي موديول → **`?`** → معاينة → «فتح الشرح الكامل».
2. دليل الاستخدام → بحث + فلتر وحدة.
3. مستخدم محدود (`project_accountant`) → لا موضوعات `settings.database.*`.

---

## 🔴 HANDOFF — HR رواتب: حقول الموظف + توزيع مراكز + معاينة قيد + واتساب + قوالب ✅ (2026-06-20)

> **جلسة 2026-06-20:** حقول تعريف الموظف (ميلاد/تعيين/تأمين سابق/هاتف) · توزيع تكلفة الموظف على عدة مراكز (افتراضي + شهري) · معاينة القيد قبل الترحيل (رواتب/مستخلص عميل/مستخلص باطن) · إشعارات راتب واتساب · تحديث قوالب Excel الثلاثة.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **حقول الموظف** | `birthDate`, `priorInsuranceMonths`, `phoneE164`, `whatsappOptIn` على `PayrollEmployee` (+`hireDate` موجود) | `prisma/schema.prisma` · migration `20260620160000_payroll_employee_profile` · `payroll.ts` POST/PUT/import · `EmployeeModal` في `Payroll.tsx` |
| **توزيع مراكز التكلفة** | `EmployeeCostCenterAllocation` (افتراضي) + `PayrollRunLineAllocation` (شهري)؛ يُنسخ الافتراضي عند إنشاء الكشف؛ قيد الاستحقاق يوزّع `grossSalary` بالنِسَب (Σ=100) | migration `20260620161000_payroll_cost_center_split` · `payroll.ts` (`buildPayrollAccrualEntries`, endpoints `/employees/:id/cost-center-allocations`, `/run-lines/:lineId/allocations`) · `RunLineAllocationModal` في `Payroll.tsx` |
| **معاينة القيد** | مكوّن مشترك `JournalPreviewModal` (نوع `JournalPreviewEntry` متساهل — `accountName/debit/credit` اختيارية)؛ رواتب عبر `GET /runs/:id/accrue-preview`؛ IPC عبر `buildIpcEntries`/`buildSubcontractorIpcEntries` | `src/components/gl/JournalPreviewModal.tsx` · `accountingService.ts` · `Billing.tsx` · `ActualCosts.tsx` · `Payroll.tsx` |
| **واتساب راتب** | `EmployeeNotificationOutbox` + توسيع `notificationWorker` (`processEmployeeNotificationOutboxBatch`)؛ `POST /runs/:id/notify-salaries`؛ قالب عبر `WHATSAPP_SALARY_TEMPLATE` | migration `20260620162000_employee_notification_outbox` · `notificationWorker.ts` · `env.ts` · `payroll.ts` · زر «إرسال إشعارات الرواتب» في `RunDetail` |
| **قوالب Excel** | قالب الموظفين: عمود **رصيد إجازات مرحّل (يوم)**؛ قالب كشف الرواتب + قالب البصمة: أعمدة اختيارية (ميلاد/تعيين/تأمين سابق/رصيد إجازات) لإثراء سجل الموظف عبر `/employees/import` | `src/lib/payrollExcel.ts` · `Payroll.tsx` (إثراء قبل الاستيراد) · `payroll.ts` (`/employees/import` يبذر `EmployeeLeaveBalance.carriedDays` على نوع الإجازة السنوية للسنة الحالية) |

### ملاحظات

- **معاينة OHA** لم تُوحَّد (workflow OHA الحالي أغنى — مقصود).
- **واتساب** dry-run حتى ضبط مفاتيح Meta + قالب راتب معتمد + `WHATSAPP_ENABLED`.
- **مدة التأمين السابقة** حقل تعريفي (لا يدخل قيد الراتب الآن).
- **رصيد الإجازات المرحّل** في قوالب الاستيراد يُبذَر على **نوع الإجازة السنوية** (أولوية كود `annual`، وإلا أول نوع نشِط `defaultAnnualDays > 0`) للسنة الحالية؛ يُتجاهَل بسلاسة إن لم يوجد نوع سنوي.
- أعمدة الإثراء في قالبي الكشف/البصمة **اختيارية** ولا تُحفظ ضمن بيانات الكشف/الحضور — تُمرَّر فقط لـ `/employees/import`.

### تحقق

```powershell
npx prisma migrate deploy
npx tsc -p server/tsconfig.build.json --noEmit
npm run test -- src/lib/liquidityMetrics.test.ts server/src/lib/money.test.ts server/src/accounting/overheadAllocation.test.ts
npm run local:api   # accrue-preview غير مُصرّح → 401 (مُسجّل، ليس 404)
```

### golden path

1. موظف جديد → حقول الميلاد/التعيين/التأمين السابق/الهاتف + توزيع مراكز افتراضي (Σ=100%).
2. كشف رواتب → استيراد/إدخال → زر «توزيع مراكز» لكل سطر (تعديل شهري) → **معاينة القيد** → ترحيل.
3. بعد الاستحقاق → «إرسال إشعارات الرواتب» (dry-run بدون مفاتيح Meta).
4. مستخلص عميل (`Billing`) / مستخلص باطن (`ActualCosts` تبويب IPC) → معاينة القيد قبل الترحيل.
5. تنزيل قوالب الموظفين/الكشف/البصمة → تعبئة أعمدة الإثراء → استيراد → تحديث سجل الموظف + بذر رصيد الإجازات.

---

## 🔴 HANDOFF — GL تصفية + shell + بنوك ✅ (2026-06-19)

> **جلسة 2026-06-19:** دفتر اليومية/كشف حساب · سطح مكتب · إغلاق نوافذ · تحويل بنكي · COA في الإعدادات.

### ما تم

| المجال | ملخص | ملفات |
|--------|------|--------|
| **GL — لا تحميل تلقائي** | Apply filters أولاً؛ فلتر مستقل لكل تبويب (journal / statement) | `GeneralLedger.tsx` · `JournalFilterPanel.tsx` · `useFilteredGlTransactions.ts` |
| **COA → Settings** | «تهيئة شجرة الحسابات» — خارج GL | `ChartOfAccountsSettingsPanel.tsx` · `Settings.tsx` |
| **تصفية تاريخ** | `journalDateKey` + `isJournalDateInRange`؛ API `dateTo\uf8ff` | `journalFilters.ts` · `server/src/lib/journalDate.ts` · `gl.ts` |
| **تصفية حساب** | from/to + كشف حساب = SearchableSelect أوراق 8 أرقام | `chartOfAccountsPicker.ts` · `JournalFilterPanel.tsx` · `GLAccountStatement.tsx` |
| **سطح مكتب فارغ** | شعار شركة وسط · 50% opacity · بدون نص | `WindowManager.tsx` · `resolveHeaderLogo()` |
| **إغلاق كل النوافذ** | لا يعيد `enteringApp` / «جاري تسجيل الدخول» | `App.tsx` — `!hasOpenedDefault.current` |
| **Banks تحويل** | scope → channel → direction تحت نوع «تحويل» واحد | `BankMovementsTab.tsx` · `bankTransferMeta.ts` · `bankMovementPosting.ts` · prisma migration |

### تحقق

```powershell
npm run test -- src/lib/journalFilters.test.ts src/lib/chartOfAccountsPicker.test.ts
npm run build
npx tsc -p server/tsconfig.build.json
```

### golden path

1. GL → طبّق فلتر تاريخ + حساب → دفتر يومية + كشف حساب
2. أغلق كل النوافذ → شعار watermark فقط (لا login overlay)
3. Banks → حركة **تحويل** (داخلي/خارجي × تطبيق/إنستاباي × وارد/صادر) → ترحيل

---

## 🔴 HANDOFF — Concord Plus branding + دخول ✅ (2026-06-17)

> **جلسة 2026-06-17 (مساءً):** شعار Concord Plus · توسيط viewBox · حركة دخول · Electron popup · تذييل طباعة.

### الألوان والأصول

| البند | القيمة |
|-------|--------|
| Navy | `#003B71` |
| Orange | `#F58220` |
| ملفات SVG | `public/branding/` — `logo-full`, `logo-compact`, `logo-print`, `icon-app`, `icon-favicon` |
| مصدر الحقيقة | `src/lib/concordPlusBrand.ts` + `scripts/sync-branding-svgs.mjs` |
| أوامر | `npm run branding:sync` · `npm run branding:icons` |

### viewBox (ضيق — لا فراغ يمين)

| ملف | viewBox |
|-----|---------|
| `logo-full.svg` | `0 0 208 88` — wordmark مُوسَّط (`translate(46,0)`) فوق tagline |
| `logo-compact.svg` | `0 0 104 58` |
| `logo-print.svg` | `0 0 212 92` — هوامش `2px`؛ tagline سطر واحد **وسط** (`text-anchor=middle`, `x=108`) |

### حركة الدخول (فقط)

- **`ConcordPlusLogoBuild.tsx`** — أيقونات تُبنى + كلمات tagline **MEP → Finishing → Infra** بالترتيب.
- **`logo-print.svg`** — **بدون حركة** (طباعة ثابتة).
- بعد الحركة: `img` من `logo-full.svg`.
- **`App.tsx`**: `enteringApp` — طبقة `Login` فوق الواجهة **حتى فتح أول نافذة بعد الدخول** (`!hasOpenedDefault.current`) — **ليس** عند إغلاق كل النوافذ لاحقاً.

### Electron

- نافذة `react-example` البيضاء = popup OAuth — **`electron/main.ts`**: `show: false` حتى Google، إغلاق تلقائي لـ `about:blank`/عودة للتطبيق.
- بعد تعديل: `npm run electron:build:shell` ثم `electron:dev` أو إعادة pack.

### بناء

- مسار imports تحت `src/components/branding/` → `../../lib/…` (ليس `../lib`).
- `ConcordPlusLogoBuild.tsx` import path أُصلح لـ Railway build.

### تحقق

```powershell
npm run branding:sync
npm run build
npm run electron:build:shell   # إن لمسنا electron/main.ts
```

---

## 🔴 HANDOFF — أموال صحيحة + OHA + تقارير ✅ (2026-06-17)

> **جلسة 2026-06-17:** تقريب EGP لأعداد صحيحة · قيد OHA موحّد لكل مركز غير مباشر · إصلاحات تقارير/بناء Railway.

### ما تم

| المجال | ملخص |
|--------|------|
| **أموال 2dp** | `src/lib/money.ts` · `server/src/lib/money.ts` — `roundMoney` (×100/100), `MONEY_TOLERANCE=0.005`, `formatMoney` بمنزلتين |
| **OHA قيد واحد/مركز** | `closeOverheadPeriod` → مرجع `OHA-{label}-{HO-code}` · Dr `51201001` مجمّع/عقد · وصف المدين `توزيع مصروفات ({اسم المركز})` |
| **توزيع البركة** | `buildComputedPreviewLines` → `distributePoolAmounts` (آخر عقد يأخذ الباقي) |
| **مراكز مشمولة** | `included_indirect_center_ids` على دورة الإغلاق + checkboxes في `OverheadAllocation.tsx` |
| **تقارير** | `resolveEntryCostCenterId` import في `costCenterCostSplit.ts` · إجماليات BOQ `useMemo` (لا `reduce(..., formatMoney(0))`) · `BoqCostBreakdownReport` يلف الاستجابة لـ `useApiQuery` |
| **بناء** | `SubcontractorExtracts.tsx` → `../lib/money` · `contractExpenseOrders.ts` → `inventoryHelpers` imports |

### تحقق

```powershell
npm run test -- server/src/accounting/overheadAllocation.test.ts server/src/lib/money.test.ts src/lib/liquidityMetrics.test.ts
npm run build
npx tsc -p server/tsconfig.build.json
```

### ملاحظات

- قيود OHA **المغلقة قبل النشر** تحتفظ بالمرجع/الوصف القديم حتى **إعادة فتح + إغلاق**.
- **الكميات** (BOQ، صرف) مقرَّبة لمنزلتين مثل المال — `formatQuantity.ts` / `roundQty`.

---

## 🔴 HANDOFF — صرف متعدد BOQ ✅ (2026-06-15)

> **الميزة:** أمر صرف للموقع — صنف واحد → عدة بنود BOQ · GL ذري على الخادم · قوالب توزيع · تاريخ مجمّع. الخطة: **`docs/CONSUMPTION_MULTI_BOQ_PLAN.md`** (مراحل 1–9 ✅).

### الخطوة التالية (نشر)

```
git push origin main          → Railway redeploy + prisma migrate deploy (قوالب)
npm run test:consumption      → 17 اختبار
npm run local:verify-postgres   → multi-line CON GL (إن وُجد CON-…)
```

**Setup Electron (اختياري):** ارفع `"version"` في `package.json` → `1.0.3` ثم:

```powershell
$env:WEB_COST_APP_URL="https://web-cost-app-production.up.railway.app"
$env:GH_TOKEN="ghp_..."; npm run electron:publish
```

**ملاحظة:** المحتوى يتحدّث من Railway بدون Setup جديد؛ Setup **1.0.3** يكفي ما لم تُرفع نسخة shell.

### ملفات رئيسية

| منطقة | ملفات |
|--------|--------|
| UI | `ConsumptionOrderModal.tsx` · `ConsumptionAllocationModal.tsx` · `Inventory.tsx` (rowspan) |
| Client lib | `src/lib/consumptionAllocation.ts` |
| API | `consumptionOrders.ts` · `boqMaterials.ts` (`/by-material/:id`) · `consumptionAllocationTemplates.ts` |
| GL | `server/src/accounting/consumptionJournal.ts` — داخل `POST /:id/confirm` فقط (لا `recordConsumptionIssue` من الواجهة) |
| Tests | `npm run test:consumption` |

### Known (صرف)

- **`npm run dev:local`** — إن `EADDRINUSE` على :3000/:3001 أوقف العمليات القديمة ثم أعد التشغيل (404 = API قديم).
- **COA `id` فارغ** — `Inventory.tsx` يستخدم `accountCode` كمفتاح احتياطي.

---

## 🔴 HANDOFF — Release 1.0.3 ✅ (2026-06-16)

> **Release 1.0.3:** ERP mode (odoo theme · top nav · lavender gradient) · cost centers/OHA · notifications · password login · closing accounts. التفاصيل في **`DEPLOYMENT_PLAN.md`** و **`docs/RAILWAY_DEPLOY.md`**.

### مرجع سريع (صيانة — ليس قائمة نشر)

```
@CLAUDE.md @DEPLOYMENT_PLAN.md
✅ Railway · Postgres · Electron v1.0.3 · GitHub Release v1.0.3 · electron-updater · golden paths
✅ Settings → **Push to production** (local admin → Railway Postgres merge)
⬜ (اختياري) export-firestore-users → migrate --users
⬜ (اختياري) Railway → local pull UI
⬜ (اختياري) توقيع Setup.exe (SmartScreen)
تحديث shell: $env:GH_TOKEN="..."; npm run electron:publish
تحديث محتوى: git push → Railway redeploy تلقائي
```

### المستخدم والبيئة

| البند | القيمة |
|-------|--------|
| Railway URL | `https://web-cost-app-production.up.railway.app` |
| admin Railway | `myline78@gmail.com` (`BOOTSTRAP_ADMIN_EMAIL` + promote) |
| محاسب محدود | `momamo242@gmail.com` — `project_accountant` ✅ |
| مسار المشروع | `D:\cost web app\web-cost-app` |
| Postgres Railway | `DATABASE_PUBLIC_URL` — **ليس** `postgres.railway.internal` |
| Desktop shell | **`1.0.3`** — GitHub Release **v1.0.3** · `electron-updater` |
| توزيع أجهزة جديدة | GitHub Releases أو `release-build\Web Cost App Setup 1.0.3.exe` (أو `release\` بعد `electron:pack`) |

### حالة النشر (نهائية)

| البند | الحالة |
|-------|--------|
| Railway + Postgres + golden paths | ✅ |
| Electron login (`signInWithPopup`) | ✅ |
| Setup.exe · PTRF · تعدد أجهزة | ✅ |
| `local:set-user-role` · صلاحيات محدودة | ✅ |
| `electron-updater` + GitHub Release **v1.0.3** | ✅ |
| إصلاح crash `autoUpdater` ESM/CJS | ✅ |
| توقيع Setup.exe | ⬜ اختياري (مؤجل) |
| ترحيل Firestore users → Postgres | ⬜ اختياري |

### حالة المراحل

| المرحلة | الحالة |
|---------|--------|
| **0–8, 10–12** | ✅ **مغلقة** |
| **9** توقيع كود | ⬜ اختياري |
| **11** electron-updater | ✅ v1.0.3 — GitHub Release **v1.0.3** |

### أوامر سريعة

```powershell
cd "D:\cost web app\web-cost-app"
$env:WEB_COST_APP_URL="https://web-cost-app-production.up.railway.app"
npm run dev:local                    # تطوير محلي
npm run test:consumption             # صرف متعدد BOQ
npm run electron:pack                # Setup.exe محلي
$env:GH_TOKEN="ghp_..."; npm run electron:publish   # إصدار shell جديد
npm run local:set-user-role -- email project_accountant
npm run test -- src/lib/liquidityMetrics.test.ts
```

**electron-builder Windows:** `"signAndEditExecutable": false` — بدون شهادة EV/OV.

---

<details>
<summary>أرشيف — HANDOFF 2026-06-15 (Railway + golden paths — قبل Electron)</summary>

Railway full-stack ✅ · migrate + backfill-gl → GL 31 ✅ · golden paths UI ✅ · `electron:pack` أُنجز لاحقاً في نفس اليوم.

</details>

<details>
<summary>أرشيف — HANDOFF 2026-06-14 (Railway deploy + 403)</summary>

403 = صلاحيات Postgres فارغة؛ promote-google-admin. COA فقط = migrate بدون backfill-gl (10 قيود). Railway SQL editor غير متاح — استخدم سكربتات محلية + DATABASE_PUBLIC_URL.

</details>

---

## 🔴 HANDOFF — أرشيف (2026-06-14) — Railway deploy + MOS + B-كامل

> **اقرأ القسم الأحدث أعلاه أولاً** للتقدّم الفعلي. هذا القسم = القرار المعماري + خريطة المراحل.

### القرار المعماري الكبير

التطبيق يُحوَّل من النظام الهجين (SQLite محلي لكل جهاز) إلى **نظام ويب كامل أونلاين** بمعمارية مركزية:

| البند | القرار |
|-------|--------|
| الاستضافة | **Railway** — Express API + **PostgreSQL** مُدار |
| مصدر الحقيقة | **PostgreSQL مركزي** لـ **كل** بيانات التطبيق (تشغيلية + نواة مالية) — **B-كامل** |
| Firebase | **للمصادقة فقط** (Google sign-in + ID token)؛ لا تخزين بيانات تطبيق |
| الواجهة | React تتصل بالـ API المركزي فقط — **لا قراءة Firestore مباشرة** |
| الصلاحيات | **مصدر واحد في الخادم** (يحلّ مشكلة تباعد Firestore↔SQLite وأعطال «تحميل البيانات» نهائياً) |
| المخرج | **EXE رقيق (Electron)** يحمّل الموقع المستضاف دون متصفح خارجي |
| التحديث | **تلقائي عبر الويب** (إعادة نشر = تحديث فوري لكل الأجهزة) |

### سبب التحويل
النظام الهجين خلق مشكلتين: (1) بيانات SQLite غير مشتركة بين الأجهزة؛ (2) أعطال صلاحيات/تحميل بيانات بسبب نظامي صلاحيات متباعدين (قواعد Firestore + خادم SQLite). B-كامل يحلّ الاثنين.

### النسخ الاحتياطي (تم — شبكة أمان قبل أي تفريغ)
- **SQLite:** ✅ `D:\cost web app\backups\20260614-055130\` (ملفات `.sqlite`+`-wal`+`-shm` + ZIP — الثلاثة ضرورية معاً، WAL كان 3.96MB).
- **Firestore:** ✅ صُدّر من **الإعدادات → Backup & Restore** (`backup_YYYY-MM-DD.json`).

### حالة الكود ذات الصلة (محدّث 2026-06-14)
- `prisma/schema.prisma` — ✅ **43 جدولاً**؛ migrations `init_full_schema` + `add_user_assigned_contracts` + `add_bank_tables`.
- **المرحلة 2 ✅** — كل مسارات `app.ts` على Postgres.
- **المرحلة 3 ✅ (خادم)** — `server/src/permissions.ts` CRUD · Bearer+session · `apiClient` يرسل التوكن.
- **المرحلة 4 🟡 شبه مكتمل** — `npm run local:migrate` + SQLite importer ✅؛ `local:verify-postgres` PASS؛ Firestore users ⬜.
- الواجهة `src/` — **✅ ~95%** على API في local mode؛ cloud mode ما زال Firestore حتى Railway.

### المراحل (12) — انظر `DEPLOYMENT_PLAN.md` § «حالة التقدّم»

| # | المرحلة | الحالة |
|---|---------|--------|
| 0–1 | Postgres + Prisma | ✅ |
| 2 | تحويل الموديولات | ✅ |
| 3 | صلاحيات الخادم | ✅ |
| 4 | ترحيل البيانات | 🟡 شبه مكتمل | Firestore + SQLite ✅ · Firestore users ⬜ |
| 5 | تحويل الواجهة للـ API | ✅ ~95% | كل الموديولات على API في local |
| 6–7 | Railway | 🟡 منشور — migrate+backfill ✅ |
| 8–10 | Electron / Setup | 🟡 |
| 12 | اختبار | 🟡 golden paths UI ⬜ |

### الخطوة التالية (B-كامل)
**golden paths** on Railway URL → **`electron:pack`** → phase 12. See resume command above. انظر **أمر الاستئناف** في القسم الأحدث أعلاه و **`docs/RAILWAY_DEPLOY.md`**.

> **المرحلة 0 ✅:** PostgreSQL 16.14 native؛ `web_cost_app` على `localhost:5432`.
> **المرحلة 1 ✅:** `npx prisma migrate dev --name init_full_schema`.

> ملاحظة: الأقسام أدناه (MOS الهجين، الطباعة، KPIs…) تخصّ النظام الهجين السابق وتبقى مرجعاً للسلوك المحاسبي؛ في local mode البيانات من Postgres عبر API.

---

## 🔴 HANDOFF — جلسة 2026-06-14 — مستخلصات التشوين (MOS) داخل المستخلصات (النظام الهجين)

### المستخدم والبيئة

| البند | القيمة |
|-------|--------|
| البريد | `momamo242@gmail.com` · uid `13MZZFXtF7hceRl1ITvmZcrgC5m2` |
| الدور في SQLite | `project_accountant` |
| الوضع | `VITE_DATA_BACKEND=local` · **`http://localhost:3000`** · `npm run dev:local` |
| مسار المشروع | `D:\cost web app\web-cost-app` |

### الميزة: مستخلصات التشوين (Material On-Site — MOS)

توريد خامات للموقع قبل التركيب → كمية معادلة (`supplied × on_site_% / 100`) تُضاف لاحقاً إلى `previous_quantity` في مستخلصات التنفيذ.

**مدمجة داخل موديول المستخلصات (`Billing.tsx`)** — ليست موديول مستقل. زر **«مستخلص جديد»** قائمة منسدلة: **تشوينات (MOS)** · **جاري (interim)** · **نهائي (final)**.

| المكوّن / الملف | الدور |
|------------------|-------|
| `server/sqlite/migrations/015_material_on_site_extracts.sql` | جدول `material_on_site_extracts` (`transaction_id TEXT` ← UUID؛ FK → `transactions(id)`) |
| `server/src/modules/mosExtracts.ts` | راوتر Express: `GET /` · `GET /boq-summary` · `POST /` (draft) · `POST /:id/approve` (يرحّل GL) — `requireAuth`/`requirePermission`/`requireRole` |
| `server/src/app.ts` | `app.use('/api/mos-extracts', mosExtractsRouter)` |
| `src/types.ts` | `MosExtract` · `MosFirestoreDoc` · `MosStatus = 'draft'\|'approved'\|'superseded'` |
| `src/services/local/modulesApi.ts` | `mosExtractsApi` (`list` · `create` · `approve` · `boqSummary`) + `buildQuery` |
| `src/components/billing/MosExtractModal.tsx` | **نموذج متعدد البنود** يشبه المستخلص الجاري (انظر أدناه) · `export MOS_COLLECTION = 'material_on_site'` |
| `src/components/billing/MosExtractsPanel.tsx` | قائمة التشوينات + **اعتماد** لكل مستخلص (يرحّل القيد) |
| `firestore.rules` | `match /material_on_site/{mosId}` يحاكي قواعد `billing` (admin/PM يحدّثان للاعتماد) |

### نموذج إنشاء التشوين = نفس المستخلص الجاري (آخر تعديل)

`MosExtractModal.tsx` يفتح **جميع بنود BOQ** للعقد مجمّعة حسب الفصل (تخطيط جدول مثل `IPCFormModal`):
- أعمدة لكل بند: القسم · البند · الوحدة · الكمية التعاقدية · الفئة · **تشوين سابق معتمد** (مرجعي من `mosExtractsApi.list({status:'approved'})`) · **الكمية الموردة** (إدخال) · **النسبة %** (إدخال، افتراضي **60**) · الكمية المعادلة · المبلغ المستحق (محسوبة).
- حقول عامة: تاريخ التشوين · مرجع إذن الاستلام · ملاحظات.
- الحفظ: ينشئ **مستخلص تشوين لكل بند** بكمية موردة > 0 — Firestore أولاً (للمعرّف) ثم `mosExtractsApi.create` (SQLite) ثم تحديث مرآة Firestore (`extractNumber`/`sqliteId`)؛ rollback `isDeleted` عند فشل SQLite. توست بعدد المُنشأ (`mos_created_count`).
- الاعتماد + ترحيل GL يتمّان من `MosExtractsPanel` لكل مستخلص (لا اعتماد مباشر من النموذج بعد).

ترجمات `LanguageContext.tsx` (ar/en): `mos_*` كاملة + الجديدة `mos_col_section/item/tender_qty/rate/prior`, `mos_total_claimed`, `mos_items_selected`, `mos_created_count`.

### تدفق البيانات MOS (SQLite مصدر الحقيقة، Firestore مرآة)
Firestore `addDoc` → معرّف → `mosExtractsApi.create` (SQLite) → `updateDoc` مرآة. الاعتماد عبر API يرحّل القيد في `transactions` ويخزّن `transaction_id` على صف SQLite.

### تحقق
```powershell
cd "D:\cost web app\web-cost-app"
npm run dev:local   # يتطلب Vite :3000 + API :3001
```
- لا أخطاء TS جديدة من ملفات MOS (تحقق بـ `npx tsc --noEmit`؛ الأخطاء المتبقية قديمة في `ActualCosts`/`Inventory`/`Projects`/`Reports`/`accountingService`/server GL).
- Golden path: مستخلص جديد → **تشوينات** → إدخال كميات لعدة بنود → حفظ → ظهورها في اللوحة → اعتماد → قيد GL.

### ما زال مفتوحاً
1. تشغيل **migration 015** على قاعدة SQLite الفعلية والتحقق من `POST /api/mos-extracts` + `/:id/approve` E2E (لم يُختبر runtime بعد).
2. التحقق أن الكمية المعادلة تُضاف فعلاً إلى `previous_quantity` في المستخلص الجاري التالي (الربط في `Billing.tsx` عبر `mosEquivalentMap`/`mosRefreshSignal`).
3. زر «اعتماد مباشر» داخل النموذج (اختياري — لم يُطلب اعتماده).
4. **Commit** التغييرات.
5. أخطاء TS قديمة في `ActualCosts`, `Inventory`, `Projects`, `Reports`, `accountingService`, server GL — غير متعلقة بـ MOS.

---

## 🔴 HANDOFF — أرشيف (2026-06-14 — طباعة التقارير + مواءمة تقرير السيولة)

<details>
<summary>طباعة التقارير multi-page + KPIs سيولة ↔ Dashboard — مرجع تاريخي</summary>

### المستخدم والبيئة

| البند | القيمة |
|-------|--------|
| البريد | `momamo242@gmail.com` |
| Firebase uid | `13MZZFXtF7hceRl1ITvmZcrgC5m2` |
| الدور في SQLite | `project_accountant` (تحقق بعد أي تغيير صلاحيات) |
| الوضع | `VITE_DATA_BACKEND=local` |
| التشغيل | **`http://localhost:3000`** — **`npm run dev:local`** (Vite + API) |
| مسار المشروع | `D:\cost web app\web-cost-app` (repo root: `D:\cost web app\`) |

### ما تم في الجلسة

| المجال | ملخص | ملفات رئيسية |
|--------|------|----------------|
| **طباعة التقارير** | طباعة التبويب النشط فقط؛ multi-page عبر clone إلى `body` | `src/lib/printReport.ts`, `src/index.css`, `Reports.tsx` |
| **تصميم الطباعة** | رأس/تذييل/عنوان في **كل صفحة**؛ ترقيم صفحات | `index.css` (`.report-print-header`, `.report-print-footer`) |
| **تقرير السيولة ↔ Dashboard** | دمج Firestore+SQLite؛ `ipcCollected` + `pending_billing` | `LiquidityReport.tsx`, `liquidityMetrics.ts`, `Dashboard.tsx` |
| **ثابت GL** | `LISTENER_LIQUIDITY_KPI_GL_CAP = 5_000` | `dataLimits.ts` |
| **دوال KPI** | `computePortfolioPendingBilling`, `cashAndBankBalanceFromGlTxs` | `liquidityMetrics.ts` |
| **Charts — تبويب السيولة** | إيرادات 0 → تحميل `billing`+GL عند `liquidity && showCharts` | `Reports.tsx` |
| **اختبارات** | `liquidityMetrics.test.ts` — **17** حالة | |

### منطق KPIs (لا تراجع)

- **تحصيلات نقدية:** `ipcCollected` — لا ISS، لا `314…`، لا `21301` فقط.
- **مستخلصات تحت التحصيل:** `computePortfolioPendingBilling` — صافي `12201…` من GL عند وجود حركة؛ وإلا مجموع uncollected لكل عقد.
- **طباعة:** `triggerReportPrint(printAreaRef.current)` — لا `window.print()` مباشرة على DOM النافذة.

### أوامر تحقق

```powershell
cd "D:\cost web app\web-cost-app"
npm run dev:local
npm run test -- src/lib/liquidityMetrics.test.ts
```

### ما زال مفتوحاً

1. **تعارض عهدة `12102002`** — **لم يُعتمد** `glAccountBalance.ts`.
2. **Commit** التغييرات · golden paths.
3. شيكات بدون `projectId`/`costCenterId` — لا تظهر في تفاصيل المشروع.
4. **`npm run lint`** — أخطاء TS قديمة في `ActualCosts`, `Inventory`, `Projects`.

### **لم يُعتمد / تراجع**

- `glAccountBalance.ts` لرصيد العهدة.
- `position: fixed` على حاوية التقرير كاملة (يقصّ صفحات).

</details>

---

## 🔴 HANDOFF — أرشيف (2026-06-13 — KPIs سيولة + Dashboard + Projects)

<details>
<summary>KPIs لوحة التحكم، Projects، GL merge، migration 014 — مرجع تاريخي</summary>

Dashboard/Projects: `liquidityMetrics.ts`؛ إصلاح 617k ISS vs 308k CLR؛ `dev:local` + desktop shortcut؛ دفتر يومية merge SQLite. تشخيص: تمويل شريك على `31401001` لا `12201001`.

</details>

---

## 🔴 HANDOFF — أرشيف (2026-06-13 — دفتر يومية مبكر)

<details>
<summary>تشغيل محلي + دفتر اليومية — مرجع تاريخي (قبل KPIs)</summary>

أول جزء من 2026-06-13: `dev:local`, desktop shortcut, دمج GL في `GeneralLedger`. راجع القسم النهائي أعلاه للصورة الكاملة.

</details>

---

## 🔴 HANDOFF — أرشيف (2026-06-07)

<details>
<summary>SQLite-first + مخازن — مرجع تاريخي</summary>

بيئة: `momamo242@gmail.com`, `project_accountant`, `VITE_DATA_BACKEND=local`. إنجازات: Actual Costs SQLite-first، COA محلي، مخازن/تحويلات، migration 013. PTRF E2E غير مُتحقق. مسار كان `g:\cost web app\web-cost-app`.

</details>

## 🔴 HANDOFF — أرشيف (2026-06-06)

<details>
<summary>split-brain Firestore vs SQLite — مرجع تاريخي</summary>

في `VITE_DATA_BACKEND=local` لا تعتمد الحفظ على Firestore list بدون `ledger`. أساس: `localCoaSync.ts`, `ensureJournalCoa.ts`, `App.tsx` login sync. **Do not** elevate all users to `admin`.

</details>

<!-- removed verbose 2026-06-06 handoff — see git history -->
