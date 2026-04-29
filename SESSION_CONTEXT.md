# Session Context — Web Cost App
**Date:** 2026-04-29  
**Branch:** main  
**Last commit before session:** `3a951f7 fix(Dashboard, Projects): update budget calculations and improve language support`

---

## What Was Done This Session

### 1. Chart of Accounts — Full Redesign (4 Levels)

**Files changed:**
- `src/services/accountingService.ts`
- `src/components/gl/GLChartOfAccounts.tsx`

#### New Account Structure

| Level | Digits | Example | Role |
|-------|--------|---------|------|
| 1 | 1 | `1`, `5` | Main category |
| 2 | 2 | `11`, `51` | Sub-category |
| 3 | 3 | `111`, `511` | Sub-group |
| 4 | 4 | `1111`, `5111` | Detail / leaf (transactable) |

#### New `AccountCodes` enum (accountingService.ts)

```typescript
BANK                  = '1111'
RECEIVABLES           = '1121'
RETENTION_GUARANTEE   = '1122'  // client-side
ADVANCE_TO_SUPPLIERS  = '1131'
WHT_TAX               = '1142'
SOCIAL_INSURANCE      = '1143'
MANPOWER_LEVY         = '1144'
SUPPLIERS             = '2111'
SUBCONTRACTORS        = '2112'  // new — separate from suppliers
RETENTION_PAYABLE     = '2121'  // contractor-side
ADVANCE_PAYMENT       = '2131'  // customer advances (liability)
VAT_TAX               = '2141'
REVENUE               = '4111'
EXPENSE_MATERIALS     = '5111'
EXPENSE_LABOUR        = '5112'
EXPENSE_SUBCONTRACTOR = '5113'  // new
EXPENSE_EQUIPMENT     = '5114'  // new
EXPENSE_ADMIN         = '5211'
BANK_CHARGES          = '5312'  // new
```

#### New `Account` interface field

```typescript
statementType?: 'balance_sheet' | 'income_statement'
```

#### Expense hierarchy (account 5 — all expenses)

```
5   — المصروفات [قائمة دخل]
  51  — تكاليف العقود (COGS)
    511 — تكاليف مباشرة
      5111 مواد البناء
      5112 عمالة مباشرة
      5113 مقاولو الباطن
      5114 معدات وآلات
      5115 نقل ولوجستيات
    512 — تكاليف غير مباشرة للموقع
      5121 إشراف ميداني
      5122 مستلزمات الموقع
  52  — مصروفات تشغيلية
    521 — إدارية وعمومية
      5211 رواتب وأجور إدارية
      5212 إيجارات مكاتب
      5213 مرافق واتصالات
      5214 رسوم قانونية ومهنية
      5215 تأمينات
      5216 إهلاك وإطفاء
      5217 مصروفات مكتبية وقرطاسية
    522 — تسويق وبيع
      5221 دعاية وإعلان
  53  — مصروفات تمويلية
    531 — تكاليف التمويل
      5311 فوائد بنكية
      5312 رسوم بنكية
      5313 خسائر فروق العملة
```

#### GLChartOfAccounts changes
- `seedAccounts()` now inserts **73 accounts** (was 12) with `statementType` field
- Level-based row styling: L1 = bold blue, L2 = semibold, L3 = normal, L4 = muted
- Hover badges: `ميزانية / قائمة دخل` + account type
- Default expanded groups: levels 1 & 2 (`'1','11','12','2','21','22','3','31','4','41','42','5','51','52','53'`)

---

### 2. Income Statement — Full Redesign

**File:** `src/components/Reports.tsx`

#### New data computation (useMemo `glPnL`)

Computed from GL transactions (filtered by `selectedProjectId`):

```
Revenue    = sum credits on accounts starting '4'
COGS       = sum debits  on accounts starting '51'
Gross      = Revenue - COGS
OpEx       = sum debits  on accounts starting '52'
EBIT       = Gross - OpEx
FinEx      = sum debits  on accounts starting '53'
Net Profit = EBIT - FinEx
```

Also produces `leafBalances: Record<string, number>` for per-account detail lines.

#### New P&L layout

```
[KPI cards]: إيرادات | مجمل الربح + % | EBIT + % | صافي الربح + %
─────────────────────────────────────────────────────
الإيرادات (green header)
  → leaf accounts 41xx, 42xx
  مجموع الإيرادات
─────────────────────────────────────────────────────
تكاليف العقود (red header)
  ▸ تكاليف مباشرة (511x leaf accounts)
  ▸ تكاليف غير مباشرة (512x leaf accounts)
  مجموع تكاليف العقود
══════════════════════════════
▶ مجمل ربح العقود (Gross Profit) — XX.X% هامش
══════════════════════════════
المصروفات التشغيلية (orange header) [shown if > 0]
  521x, 522x leaf accounts
  مجموع المصروفات التشغيلية
══════════════════════════════
▶ ربح التشغيل (EBIT) — XX.X% هامش
══════════════════════════════
المصروفات التمويلية (rose header) [shown if > 0]
  531x leaf accounts
  مجموع المصروفات التمويلية
══════════════════════════════
★ صافي الربح للفترة — XX.X% هامش
─────────────────────────────────────────────────────
[Project breakdown table — billing data]
```

- Sections only shown when they have non-zero values
- Fallback to `totalRevenue` (billing-based) when no GL revenue exists
- Each profit row color-coded: blue (Gross), violet (EBIT), amber (Net)

---

### 3. Balance Sheet — Full Redesign

**File:** `src/components/Reports.tsx`

#### New data computation (useMemo `balanceSheet`)

Uses **all transactions** (not project-filtered). Computes:

```
currentAssets    = leaf accounts 11xx (debit nature)
nonCurrentAssets = leaf accounts 12xx (debit nature)
totalAssets      = currentAssets + nonCurrentAssets

currentLiab      = leaf accounts 21xx (credit nature)
nonCurrentLiab   = leaf accounts 22xx (credit nature)
totalLiab        = currentLiab + nonCurrentLiab

equityAccounts   = leaf accounts 3xxx (credit nature)
netProfitForBS   = all revenue credits - all expense debits (company-wide)
totalEquity      = equityAccounts + netProfitForBS
totalLE          = totalLiab + totalEquity

isBalanced       = |totalAssets - totalLE| < 1
```

Also exposes `accBal(code, nature)` for per-account lookup.

#### New layout

Two-column grid (Assets | Liabilities & Equity):

**Left column — Assets:**
```
الأصول المتداولة
  111x النقدية والبنوك (sub-group)
  112x العملاء والذمم المدينة
  113x المدفوعات المقدمة
  114x حسابات ضريبية
  115x ذمم مدينة أخرى
  مجموع الأصول المتداولة
الأصول غير المتداولة
  121x الأصول الثابتة
  122x أصول أخرى
  مجموع الأصول غير المتداولة
══════════════════
إجمالي الأصول
```

**Right column — Liabilities & Equity:**
```
الخصوم المتداولة
  211x ذمم دائنة تجارية
  212x محتجزات الضمان
  213x دفعات مقدمة من العملاء
  214x التزامات ضريبية
  215x مستحقات أخرى
  مجموع الخصوم المتداولة
الخصوم غير المتداولة
  221x قروض طويلة الأجل
  مجموع الخصوم غير المتداولة
حقوق الملكية
  311x رأس المال
  312x الاحتياطيات
  313x الأرباح المحتجزة
  صافي ربح الفترة الحالية (italic)
  مجموع حقوق الملكية
══════════════════
إجمالي الخصوم وحقوق الملكية
─────────────────────────────────
رأس المال العامل = الأصول المتداولة − الخصوم المتداولة
```

- Green "متوازنة" / Red "فرق: X" indicator at top
- Sub-groups with dashed separator and optional sub-total
- Zero-balance accounts hidden automatically

---

## Data Migration Note

**Existing Firestore `transactions` with old account codes will be partially misclassified:**

| Old code | Old meaning | Maps to new prefix | New meaning |
|----------|-------------|-------------------|-------------|
| `51` | مواد | `51x` | تكاليف العقود ✓ (same group) |
| `52` | عمالة | `52x` | مصروفات تشغيلية ✗ (should be 511x) |
| `53` | إداري | `53x` | مصروفات تمويلية ✗ (should be 521x) |
| `41` | إيرادات | `41x` | إيرادات تشغيلية ✓ |
| `1101` | البنك | no match | old accounts not in new COA |

**Recommended action:** Seed new COA via "توليد الشجرة الافتراضية" button, then re-enter historical entries with new codes OR run a Firestore migration script to remap old codes.

---

## Pending / Suggested Next Work

### High Priority
- [ ] **Purchases.tsx**: The expense account picker lets users select from COA. Verify it shows only leaf (non-group) expense accounts (5111–5313). May need a filter: `a.type === 'expense' && !a.isGroup`.
- [ ] **ActualCosts.tsx**: Same — verify expense account selection uses new codes.
- [ ] **AccountModal.tsx**: Auto-derive `statementType` from `accountCode` prefix when saving (1,2,3 → balance_sheet; 4,5 → income_statement).

### Medium Priority
- [ ] **Firestore migration**: Script to remap old transaction entries from `51→5111`, `52→5112`, `53→5211`, `41→4111`, `21→2111`, `2201→2141`.
- [ ] **Opening balances**: `trialBalance` useMemo (Reports.tsx line ~245) has `openingDebit/openingCredit` hardcoded to 0. Need a `opening_balances` Firestore collection and period selection UI.
- [ ] **Account editing**: Edit button in GLChartOfAccounts is wired to UI but does nothing. Wire to AccountModal in edit mode.

### Low Priority
- [ ] **Export**: `exportToExcel` for income statement still exports the old `projectStats` structure. Update to export the new GL-based P&L.
- [ ] **Print CSS**: Add `@media print` styles to render P&L and Balance Sheet cleanly without sidebar/nav.
- [ ] **Tax line**: Add income tax line (e.g., 22.5% in Egypt) between "صافي الربح قبل الضريبة" and "صافي الربح بعد الضريبة".

---

## Key Files Reference

| File | Key sections |
|------|-------------|
| `src/services/accountingService.ts` | `AccountCodes` enum (L15), `Account` interface (L38), `recordIPC` (L153), `recordSubcontractorIPC` (L279), `recordPurchaseInvoice` (L234) |
| `src/components/gl/GLChartOfAccounts.tsx` | `seedAccounts` (L38), `renderAccount` (L107), `expandedGroups` (L20) |
| `src/components/Reports.tsx` | `glPnL` useMemo (~L278), `balanceSheet` useMemo (~L310), income statement JSX (~L620), balance sheet JSX (~L870) |
| `src/components/Purchases.tsx` | Uses `expenseAccountCode` selected from COA — check filter |
| `src/components/ActualCosts.tsx` | Uses expense account selection — check filter |
| `src/components/billing/IPCFormModal.tsx` | Calls `accountingService.recordIPC()` |

---

## How to Seed the New Chart of Accounts

1. Go to **الأستاذ العام → شجرة الحسابات**
2. If accounts exist from old seed: manually delete them from Firestore (`chart_of_accounts` collection) OR disable them
3. Click **"توليد الشجرة الافتراضية"** button (only visible when collection is empty)
4. New 73-account tree is inserted with `statementType` tags

---

## Stack Reminder

```
React 19 + TypeScript + Tailwind v4 + Vite 6
Firebase Firestore (named DB) + Firebase Auth
npm run dev      → :3000 (production Firestore)
npm run emulate  → :3000 (local emulators)
npm run lint     → tsc --noEmit
```
