import React, { Suspense, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import { lazyWithRetry } from '../lib/lazyImport';
import { cn } from '../lib/utils';
import { ERP_GRADIENT_BG } from '../lib/shellTheme';
import { isErpTheme } from '../lib/erpBrand';
import { useLanguage } from '../context/LanguageContext';
import { useErpWorkspace } from '../context/ErpWorkspaceContext';
import { db } from '../firebase';
import { isLocalBackend } from '../lib/dataBackend';
import { resolveHeaderLogo } from '../lib/concordPlusBrand';
import { settingsApi } from '../services/local/modulesApi';

const DashboardLazy = lazyWithRetry(() => import('./Dashboard').then((m) => ({ default: m.Dashboard })));
const GeneralLedgerLazy = lazyWithRetry(() => import('./GeneralLedger').then((m) => ({ default: m.GeneralLedger })));
const TechnicalOfficeLazy = lazyWithRetry(() => import('./TechnicalOffice').then((m) => ({ default: m.TechnicalOffice })));
const BanksLazy = lazyWithRetry(() => import('./Banks').then((m) => ({ default: m.Banks })));
const ActualCostsLazy = lazyWithRetry(() => import('./ActualCosts').then((m) => ({ default: m.ActualCosts })));
const OverheadAllocationLazy = lazyWithRetry(() =>
  import('./OverheadAllocation').then((m) => ({ default: m.OverheadAllocation })),
);
const ReportsLazy = lazyWithRetry(() => import('./Reports').then((m) => ({ default: m.Reports })));
const SettingsLazy = lazyWithRetry(() => import('./Settings').then((m) => ({ default: m.Settings })));
const InventoryLazy = lazyWithRetry(() => import('./Inventory'));
const FixedAssetsLazy = lazyWithRetry(() => import('./FixedAssets').then((m) => ({ default: m.FixedAssets })));
const PayrollLazy = lazyWithRetry(() => import('./Payroll').then((m) => ({ default: m.Payroll })));
const PurchaseRequestsLazy = lazyWithRetry(() =>
  import('./PurchaseRequests').then((m) => ({ default: m.PurchaseRequests })),
);
const CashBudgetLazy = lazyWithRetry(() =>
  import('./CashBudget').then((m) => ({ default: m.CashBudget })),
);
const OperationsManualLazy = lazyWithRetry(() =>
  import('./OperationsManual').then((m) => ({ default: m.OperationsManual })),
);

const ERP_MODULE_COMPONENTS: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  dashboard: DashboardLazy,
  ledger: GeneralLedgerLazy,
  technical: TechnicalOfficeLazy,
  banks: BanksLazy,
  costs: ActualCostsLazy,
  overhead: OverheadAllocationLazy,
  reports: ReportsLazy,
  settings: SettingsLazy,
  inventory: InventoryLazy,
  purchase_requests: PurchaseRequestsLazy,
  cash_budget: CashBudgetLazy,
  assets: FixedAssetsLazy,
  payroll: PayrollLazy,
  manual: OperationsManualLazy,
};

function ModuleLoadFallback() {
  const { theme } = useLanguage();
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center">
      <Loader2
        className={cn('animate-spin', isErpTheme(theme) ? 'text-[var(--erp-primary)]' : 'text-blue-500')}
        size={28}
      />
    </div>
  );
}

export function ErpWorkspace() {
  const { theme } = useLanguage();
  const { enabled, location } = useErpWorkspace();
  const [desktopLogoUrl, setDesktopLogoUrl] = useState(() => resolveHeaderLogo(null));

  useEffect(() => {
    const load = async () => {
      try {
        if (isLocalBackend) {
          const res = await settingsApi.getCompanyInfo();
          setDesktopLogoUrl(resolveHeaderLogo(res.value?.headerLogo));
          return;
        }
        const settingsDoc = await getDoc(doc(db, 'settings', 'company_info'));
        if (settingsDoc.exists()) {
          const data = settingsDoc.data();
          setDesktopLogoUrl(
            resolveHeaderLogo(typeof data.headerLogo === 'string' ? data.headerLogo : null),
          );
        }
      } catch {
        /* keep default */
      }
    };
    void load();
  }, []);

  if (!enabled) return null;

  const ModuleComponent = location ? ERP_MODULE_COMPONENTS[location.moduleId] : null;

  return (
    <div className={cn('relative flex-1 overflow-hidden min-h-0', isErpTheme(theme) && ERP_GRADIENT_BG)}>
      {!location && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none" aria-hidden>
          <img
            src={desktopLogoUrl}
            alt=""
            className={cn(
              'max-w-[min(420px,55vw)] max-h-[min(240px,38vh)] w-auto h-auto object-contain opacity-50',
              isErpTheme(theme) && 'erp-desktop-logo',
            )}
            draggable={false}
          />
        </div>
      )}

      {ModuleComponent && location && (
        <div
          key={`${location.moduleId}-${location.viewId ?? ''}-${location.remountKey ?? 0}`}
          className={cn(
            'absolute inset-0 overflow-y-auto overflow-x-hidden erp-workspace-panel',
            isErpTheme(theme) && 'erp-page-enter',
          )}
        >
          <Suspense fallback={<ModuleLoadFallback />}>
            <ModuleComponent />
          </Suspense>
        </div>
      )}
    </div>
  );
}
