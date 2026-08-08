import React, { useEffect, useRef, useState, Suspense } from 'react';
import { Briefcase, FileText, TrendingUp, Loader2, Inbox } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { lazyWithRetry } from '../lib/lazyImport';
import { useLanguage } from '../context/LanguageContext';
import { usePermissions } from '../context/PermissionsContext';
import { useErpModuleDraft, useErpModuleView } from '../hooks/useErpModuleView';
import { consumePendingShellView, setPendingBillingFocus, setPendingBoqFocus, type PendingBillingFocus, type PendingBoqFocus } from '../lib/shellNavigation';
import { canOpenTechnicalView } from '../lib/permissions';
import { isErpTheme } from '../lib/erpBrand';
import { isLocalBackend } from '../lib/dataBackend';

const ProjectsLazy = lazyWithRetry(() => import('./Projects').then((m) => ({ default: m.Projects })));
const BOQLazy = lazyWithRetry(() => import('./BOQ').then((m) => ({ default: m.BOQ })));
const BillingLazy = lazyWithRetry(() => import('./Billing').then((m) => ({ default: m.Billing })));
const DocumentsLazy = lazyWithRetry(() =>
  import('./TechnicalOfficeDocuments').then((m) => ({ default: m.TechnicalOfficeDocuments })),
);

export type TechnicalOfficeView = 'projects' | 'boq' | 'billing' | 'documents';

export interface TechnicalOfficeDraft {
  activeView: TechnicalOfficeView;
}

function viewIdToOfficeView(viewId: string): TechnicalOfficeView {
  if (viewId === 'boq' || viewId === 'billing' || viewId === 'documents') return viewId;
  return 'projects';
}

function ViewFallback() {
  const { theme } = useLanguage();
  return (
    <div className="flex min-h-[240px] items-center justify-center">
      <Loader2 className={cn('animate-spin', isErpTheme(theme) ? 'text-[var(--erp-primary)]' : 'text-blue-500')} size={28} />
    </div>
  );
}

export function TechnicalOffice() {
  const { language, theme, dir, t } = useLanguage();
  const { can, isAdmin, permissions } = usePermissions();
  const projectsAccess = can('projects');
  const boqAccess = can('boq');
  const billingAccess = can('billing');
  const { isErpShell, activeViewId, erp } = useErpModuleView('technical', 'projects');
  const draftHydrated = useRef(false);
  const pendingConsumed = useRef(false);

  const [activeView, setActiveView] = useState<TechnicalOfficeView>('projects');

  useEffect(() => {
    if (!isErpShell || !erp || draftHydrated.current) return;
    const saved = erp.getModuleDraft<TechnicalOfficeDraft>('technical');
    if (saved?.activeView) setActiveView(saved.activeView);
    draftHydrated.current = true;
  }, [isErpShell, erp]);

  useEffect(() => {
    if (isErpShell) {
      setActiveView(viewIdToOfficeView(activeViewId));
      return;
    }
    if (pendingConsumed.current) return;
    const pending = consumePendingShellView('technical');
    pendingConsumed.current = true;
    if (pending) setActiveView(viewIdToOfficeView(pending));
  }, [activeViewId, isErpShell]);

  useEffect(() => {
    if (isErpShell) return;
    if (activeView === 'documents' && !isLocalBackend) {
      if (billingAccess.view) setActiveView('billing');
      return;
    }
    const perms = { projects: projectsAccess, boq: boqAccess, billing: billingAccess, documents: billingAccess };
    if (activeView === 'documents' ? isLocalBackend && perms.documents?.view : perms[activeView]?.view) return;
    if (projectsAccess.view) setActiveView('projects');
    else if (boqAccess.view) setActiveView('boq');
    else if (billingAccess.view) setActiveView('billing');
    else if (isLocalBackend && billingAccess.view) setActiveView('documents');
  }, [isErpShell, activeView, projectsAccess.view, boqAccess.view, billingAccess.view, isLocalBackend]);

  useErpModuleDraft('technical', { activeView }, isErpShell, erp);

  const tabs: { id: TechnicalOfficeView; icon: React.ReactNode; labelKey: string; perm: boolean }[] = [
    { id: 'projects', icon: <Briefcase size={16} />, labelKey: 'technical_menu_projects', perm: projectsAccess.view },
    { id: 'boq', icon: <FileText size={16} />, labelKey: 'technical_menu_boq', perm: boqAccess.view },
    { id: 'billing', icon: <TrendingUp size={16} />, labelKey: 'technical_menu_billing', perm: billingAccess.view },
    {
      id: 'documents',
      icon: <Inbox size={16} />,
      labelKey: 'technical_menu_documents',
      perm: isLocalBackend && billingAccess.view,
    },
  ];

  const canViewActive = canOpenTechnicalView(permissions, activeView, { isAdmin });

  return (
    <div
      className={cn(
        'min-h-screen transition-colors',
        theme === 'dark' ? 'bg-[#0a0a0a] text-gray-100' : theme === 'soft' ? 'bg-[#eceff1] text-[#37474f]' : 'bg-gray-50 text-gray-900',
      )}
      dir={dir}
    >
      {!isErpShell && (
        <div className={cn('px-8 pt-8 pb-0 border-b', theme === 'dark' ? 'border-gray-800' : theme === 'soft' ? 'border-[#cfd8dc]' : 'border-gray-200')}>
          <header className="mb-4">
            <h2 className="text-3xl font-bold tracking-tight">{t('technical')}</h2>
            <p className="text-gray-400 mt-1 text-sm">{t('technical_module_desc')}</p>
          </header>
          <div className="flex gap-4">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveView(tab.id)}
                disabled={!tab.perm}
                title={!tab.perm ? t('shell_module_access_denied').replace('{module}', t(tab.labelKey)) : undefined}
                className={cn(
                  'pb-4 px-2 text-sm font-bold transition-all relative',
                  activeSubTabStyle(activeView === tab.id, theme),
                  !tab.perm && 'opacity-45 cursor-not-allowed',
                )}
              >
                <div className="flex items-center gap-2">
                  {tab.icon}
                  {t(tab.labelKey)}
                </div>
                {activeView === tab.id && (
                  <motion.div layoutId="technicalActiveTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {!canViewActive ? (
        <div className={cn('border rounded-xl p-12 text-center mx-8 mt-8', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white')}>
          <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>
            {t('shell_module_access_denied').replace('{module}', t(`technical_menu_${activeView}`))}
          </p>
        </div>
      ) : (
        <Suspense fallback={<ViewFallback />}>
          {activeView === 'projects' && <ProjectsLazy embedded />}
          {activeView === 'boq' && <BOQLazy embedded />}
          {activeView === 'billing' && <BillingLazy embedded />}
          {activeView === 'documents' && isLocalBackend && (
            <DocumentsLazy
              embedded
              onOpenDocument={(focus: PendingBillingFocus | PendingBoqFocus) => {
                if ('variationOrderId' in focus && focus.variationOrderId) {
                  setPendingBoqFocus(focus);
                  setActiveView('boq');
                  return;
                }
                if ('docType' in focus) {
                  setPendingBillingFocus(focus);
                  setActiveView('billing');
                }
              }}
            />
          )}
        </Suspense>
      )}
    </div>
  );
}

function activeSubTabStyle(active: boolean, theme: string): string {
  if (active) return 'text-blue-500';
  if (theme === 'dark') return 'text-gray-500 hover:text-gray-300';
  return 'text-gray-500 hover:text-gray-800';
}
