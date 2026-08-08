import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Download,
  Loader2,
  MessageCircle,
  RefreshCw,
  ShoppingCart,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useLanguage } from '../context/LanguageContext';
import { usePermissions } from '../context/PermissionsContext';
import { useErpModuleView } from '../hooks/useErpModuleView';
import { cn, listKey } from '../lib/utils';
import { formatQuantity } from '../lib/formatQuantity';
import { moduleAccess } from '../lib/permissions';
import {
  consumePendingPurchaseRequestId,
  consumePendingShellView,
  peekPendingShellView,
} from '../lib/shellNavigation';
import { exportPurchaseRequestsExcel } from '../lib/purchaseRequestsExcel';
import {
  purchaseRequestsApi,
  type PurchaseRequestPriority,
  type PurchaseRequestRow,
  type PurchaseRequestStatus,
} from '../services/local/modulesApi';

type TabId = 'create' | 'open' | 'executed';

type MetaProject = {
  id: string;
  projectCode: string;
  projectName: string;
  projectNameEn?: string | null;
};
type MetaContract = {
  id: string;
  projectId: string;
  contractName: string;
  contractNameEn?: string | null;
  contractNumber: string;
};
type MaterialOpt = {
  id: number;
  code: string;
  name: string;
  unit: string;
};
type BoqOpt = { id: string; itemCode: string; description: string };

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function materialLabel(row: PurchaseRequestRow): string {
  if (row.materialMode === 'coded') {
    return [row.materialCode, row.materialName].filter(Boolean).join(' — ') || row.materialName || '—';
  }
  return row.description || row.materialName || '—';
}

function isClosedStatus(status: string): boolean {
  return status === 'executed' || status === 'cancelled';
}

function isOverdue(row: PurchaseRequestRow): boolean {
  if (isClosedStatus(row.status)) return false;
  return String(row.neededByDate).slice(0, 10) < todayYmd();
}

function formatDateTimeLabel(value: string | null | undefined, isAr: boolean): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  return `${d.toLocaleDateString(isAr ? 'ar-EG' : 'en-GB')} ${d.toLocaleTimeString(isAr ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Color + weight by priority (low → urgent). */
function priorityToneClass(priority: string): string {
  switch (priority) {
    case 'low':
      return 'bg-slate-100 text-slate-600 font-normal dark:bg-slate-800 dark:text-slate-300';
    case 'medium':
      return 'bg-sky-100 text-sky-800 font-semibold dark:bg-sky-950/50 dark:text-sky-300';
    case 'high':
      return 'bg-amber-100 text-amber-900 font-bold dark:bg-amber-950/40 dark:text-amber-300';
    case 'urgent':
      return 'bg-red-100 text-red-700 font-black tracking-wide dark:bg-red-950/50 dark:text-red-300';
    default:
      return 'bg-gray-100 text-gray-600 font-medium dark:bg-gray-800 dark:text-gray-300';
  }
}

export function PurchaseRequests() {
  const { t, language, theme, dir } = useLanguage();
  const { permissions, role, isAdmin } = usePermissions();
  const isAr = language === 'ar';
  const { isErpShell, activeViewId, erp } = useErpModuleView('purchase_requests', 'open');

  const prAccess = moduleAccess(permissions, 'purchase_requests');
  const canEditStatus =
    isAdmin
    || role === 'projects_manager'
    || role === 'project_accountant'
    || prAccess.edit;
  const canCreate = prAccess.create !== false || isAdmin;

  /** Avoid open→executed flash: ERP remounts per viewId; shell menu sets pending view. */
  const [tab, setTab] = useState<TabId>(() => {
    const pending = peekPendingShellView('purchase_requests');
    if (pending === 'create' || pending === 'open' || pending === 'executed') return pending;
    if (activeViewId === 'create' || activeViewId === 'open' || activeViewId === 'executed') {
      return activeViewId;
    }
    return 'open';
  });
  const [rows, setRows] = useState<PurchaseRequestRow[]>([]);
  const [loading, setLoading] = useState(() => tab !== 'create');
  const [saving, setSaving] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const loadSeqRef = useRef(0);

  const [projects, setProjects] = useState<MetaProject[]>([]);
  const [contracts, setContracts] = useState<MetaContract[]>([]);
  const [materials, setMaterials] = useState<MaterialOpt[]>([]);
  const [boqItems, setBoqItems] = useState<BoqOpt[]>([]);

  const [materialMode, setMaterialMode] = useState<'coded' | 'uncoded'>('coded');
  const [materialCategoryId, setMaterialCategoryId] = useState('');
  const [uncodedDescription, setUncodedDescription] = useState('');
  const [uncodedUnit, setUncodedUnit] = useState('');
  const [quantity, setQuantity] = useState('');
  const [projectId, setProjectId] = useState('');
  const [contractId, setContractId] = useState('');
  const [boqItemId, setBoqItemId] = useState('');
  const [neededPreset, setNeededPreset] = useState<'today' | 'tomorrow' | 'calendar'>('today');
  const [neededByDate, setNeededByDate] = useState(todayYmd());
  const [priority, setPriority] = useState<PurchaseRequestPriority>('medium');

  useEffect(() => {
    if (!isErpShell) return;
    if (activeViewId === 'create' || activeViewId === 'executed' || activeViewId === 'open') {
      setTab(activeViewId);
    }
  }, [isErpShell, activeViewId]);

  const goToTab = useCallback(
    (next: TabId) => {
      setTab(next);
      if (isErpShell && erp) {
        erp.navigateTo('purchase_requests', next);
      }
    },
    [isErpShell, erp],
  );

  const projectsMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const contractsMap = useMemo(() => new Map(contracts.map((c) => [c.id, c])), [contracts]);

  const contractsForProject = useMemo(() => {
    if (!projectId) return [];
    return contracts.filter((c) => c.projectId === projectId);
  }, [contracts, projectId]);

  const loadMeta = useCallback(async () => {
    try {
      const [meta, mats] = await Promise.all([
        purchaseRequestsApi.meta(),
        purchaseRequestsApi.materialsLookup(),
      ]);
      setProjects(meta.projects ?? []);
      setContracts(meta.contracts ?? []);
      setMaterials(mats ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('pr_load_failed'));
    }
  }, [t]);

  const loadRows = useCallback(async (opts?: { soft?: boolean }) => {
    if (tab === 'create') return;
    const seq = ++loadSeqRef.current;
    const scope = tab === 'open' ? 'open' : 'executed';
    // Soft refresh keeps the table mounted (no spinner flash) while re-fetching.
    if (!opts?.soft) setLoading(true);
    try {
      const data = await purchaseRequestsApi.list(scope);
      if (seq !== loadSeqRef.current) return;
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      toast.error(e instanceof Error ? e.message : t('pr_load_failed'));
      setRows([]);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [tab, t]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (tab === 'create') {
      loadSeqRef.current += 1;
      setRows([]);
      setLoading(false);
      return;
    }
    void loadRows();
  }, [tab, loadRows]);

  /** Deep-link from notification bell / openWindow(viewId) → active list + highlight. */
  useEffect(() => {
    const pendingView = consumePendingShellView('purchase_requests');
    const pendingId = consumePendingPurchaseRequestId();
    if (pendingView === 'create' || pendingView === 'open' || pendingView === 'executed') {
      setTab(pendingView);
    }
    if (pendingId) {
      setTab('open');
      setHighlightId(pendingId);
    }
  }, []);

  /** ERP: when workspace view becomes `open` (e.g. notification), apply pending highlight. */
  useEffect(() => {
    if (!isErpShell || activeViewId !== 'open') return;
    const pendingId = consumePendingPurchaseRequestId();
    if (pendingId) {
      setTab('open');
      setHighlightId(pendingId);
    }
  }, [isErpShell, activeViewId]);

  useEffect(() => {
    if (!contractId) {
      setBoqItems([]);
      setBoqItemId('');
      return;
    }
    let cancelled = false;
    void purchaseRequestsApi.boqPicker(contractId).then((items) => {
      if (!cancelled) setBoqItems(items ?? []);
    }).catch(() => {
      if (!cancelled) setBoqItems([]);
    });
    return () => {
      cancelled = true;
    };
  }, [contractId]);

  useEffect(() => {
    setContractId('');
    setBoqItemId('');
  }, [projectId]);

  useEffect(() => {
    if (neededPreset === 'today') setNeededByDate(todayYmd());
    else if (neededPreset === 'tomorrow') setNeededByDate(addDaysYmd(todayYmd(), 1));
  }, [neededPreset]);

  const resetForm = useCallback(() => {
    setMaterialMode('coded');
    setMaterialCategoryId('');
    setUncodedDescription('');
    setUncodedUnit('');
    setQuantity('');
    setProjectId('');
    setContractId('');
    setBoqItemId('');
    setNeededPreset('today');
    setNeededByDate(todayYmd());
    setPriority('medium');
  }, []);

  useEffect(() => {
    if (tab === 'create') resetForm();
  }, [tab, resetForm]);

  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      open: t('pr_status_open'),
      contacted: t('pr_status_contacted'),
      postponed: t('pr_status_postponed'),
      unavailable: t('pr_status_unavailable'),
      executed: t('pr_status_executed'),
      cancelled: t('pr_status_cancelled'),
    };
    return map[s] ?? s;
  };

  const priorityLabel = (p: string) => {
    const map: Record<string, string> = {
      low: t('pr_priority_low'),
      medium: t('pr_priority_medium'),
      high: t('pr_priority_high'),
      urgent: t('pr_priority_urgent'),
    };
    return map[p] ?? p;
  };

  const projectLabel = (id: string) => {
    const p = projectsMap.get(id);
    if (!p) return id;
    const name = isAr ? p.projectName : (p.projectNameEn?.trim() || p.projectName);
    return `${p.projectCode} — ${name}`;
  };

  const contractLabel = (id: string) => {
    const c = contractsMap.get(id);
    if (!c) return id;
    const name = isAr ? c.contractName : (c.contractNameEn?.trim() || c.contractName);
    return `${c.contractNumber} — ${name}`;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        materialMode,
        quantity: Number(quantity),
        projectId,
        contractId,
        priority,
        neededByDate,
        neededPreset: neededPreset === 'calendar' ? undefined : neededPreset,
        ...(boqItemId ? { boqItemId } : {}),
      };
      if (materialMode === 'coded') {
        body.materialCategoryId = Number(materialCategoryId);
      } else {
        body.description = uncodedDescription.trim();
        body.unit = uncodedUnit.trim() || undefined;
      }
      await purchaseRequestsApi.create(body);
      toast.success(t('pr_created'));
      window.dispatchEvent(new CustomEvent('notifications:refresh'));
      resetForm();
      goToTab('open');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('pr_save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (id: string, status: PurchaseRequestStatus) => {
    try {
      await purchaseRequestsApi.updateStatus(id, status);
      toast.success(t('pr_status_updated'));
      window.dispatchEvent(new CustomEvent('notifications:refresh'));
      // Closed statuses leave the open list — refresh current tab (row disappears from open).
      await loadRows();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('pr_save_failed'));
    }
  };

  const handleWhatsApp = async (id: string) => {
    try {
      await purchaseRequestsApi.notifyWhatsApp(id);
      toast.success(t('pr_whatsapp_queued'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('pr_whatsapp_failed'));
    }
  };

  const handleExport = () => {
    const exportRows = rows.map((r) => {
      const stampSrc =
        tab === 'executed' ? (r.statusUpdatedAt || r.requestedAt) : r.requestedAt;
      const stamp = new Date(stampSrc);
      const dateStr = Number.isNaN(stamp.getTime())
        ? String(stampSrc).slice(0, 10)
        : stamp.toLocaleDateString(isAr ? 'ar-EG' : 'en-GB');
      const timeStr = Number.isNaN(stamp.getTime())
        ? ''
        : stamp.toLocaleTimeString(isAr ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
      return {
        requestNumber: r.requestNumber,
        materialLabel: materialLabel(r),
        quantity: formatQuantity(Number(r.quantity), language),
        unit: r.unit,
        neededByDate: r.neededByDate,
        priority: priorityLabel(r.priority),
        projectLabel: projectLabel(r.projectId),
        contractLabel: contractLabel(r.contractId),
        requestedDate: dateStr,
        requestedTime: timeStr,
        status: statusLabel(r.status),
      };
    });
    exportPurchaseRequestsExcel(exportRows, isAr ? 'ar' : 'en', tab === 'executed');
  };

  const inputBase = cn(
    'border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500',
    theme === 'dark' ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900',
  );
  /** Full-width inputs (e.g. status select in table). */
  const inputCls = cn(inputBase, 'w-full');
  /**
   * Form fields sit in a 2-col grid inside a 75%-wide form card,
   * so each control is ~half the previous full-width size.
   */
  const formInputCls = cn(inputBase, 'w-full');
  const cardCls = cn(
    'rounded-xl border shadow-sm',
    theme === 'dark' ? 'bg-[#151619] border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200',
  );

  const openCountBadge = tab === 'open' ? rows.length : null;

  return (
    <div
      className={cn(
        'min-h-full p-4 md:p-6 space-y-4',
        theme === 'dark' ? 'bg-[#0a0a0a] text-gray-100' : theme === 'soft' ? 'bg-[#eceff1] text-[#37474f]' : 'bg-gray-50 text-gray-900',
      )}
      dir={dir}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShoppingCart size={22} className="text-orange-500" />
            {t('purchase_requests')}
          </h2>
          <p className="text-sm text-gray-500 mt-1">{t('pr_module_desc')}</p>
        </div>
        {tab !== 'create' && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
            onClick={() => void loadRows({ soft: true })}
            className="px-3 py-2 rounded-lg text-sm font-bold border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-1"
          >
            <RefreshCw size={14} />
            {t('pr_refresh')}
          </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={rows.length === 0}
              className="px-3 py-2 rounded-lg text-sm font-bold border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-1 disabled:opacity-50"
            >
              <Download size={14} />
              {t('pr_export_excel')}
            </button>
          </div>
        )}
      </header>

      {!isErpShell && (
        <div className="flex gap-2 border-b border-gray-200 dark:border-gray-800">
          {([
            ...(canCreate ? (['create'] as const) : []),
            'open',
            'executed',
          ] as TabId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => goToTab(id)}
              className={cn(
                'px-3 py-2 text-sm font-bold border-b-2 -mb-px',
                tab === id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500',
              )}
            >
              {id === 'create' ? t('pr_menu_create') : id === 'open' ? t('pr_menu_open') : t('pr_menu_executed')}
              {id === 'open' && openCountBadge != null && openCountBadge > 0 && (
                <span className="ms-2 inline-flex min-w-[1.25rem] justify-center rounded-full bg-orange-500 text-white text-[10px] px-1.5 py-0.5">
                  {openCountBadge}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {tab === 'create' && canCreate && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className={cn(cardCls, 'p-4 space-y-3 w-[75%] max-w-full')}
        >
          <h3 className="font-bold text-lg">{t('pr_menu_create')}</h3>

          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={materialMode === 'coded'}
                onChange={() => setMaterialMode('coded')}
              />
              {t('pr_material_coded')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={materialMode === 'uncoded'}
                onChange={() => setMaterialMode('uncoded')}
              />
              {t('pr_material_uncoded')}
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            {materialMode === 'coded' ? (
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">{t('pr_material')}</label>
                <select
                  className={formInputCls}
                  required
                  value={materialCategoryId}
                  onChange={(e) => setMaterialCategoryId(e.target.value)}
                >
                  <option value="">{t('pr_select_material')}</option>
                  {materials.map((m) => (
                    <option key={m.id} value={String(m.id)}>
                      {m.code} — {m.name} ({m.unit})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">{t('pr_description')}</label>
                  <input
                    className={formInputCls}
                    required
                    value={uncodedDescription}
                    onChange={(e) => setUncodedDescription(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">{t('pr_unit')}</label>
                  <input
                    className={formInputCls}
                    value={uncodedUnit}
                    onChange={(e) => setUncodedUnit(e.target.value)}
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">{t('pr_quantity')}</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                className={formInputCls}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">{t('pr_project')}</label>
              <select
                className={formInputCls}
                required
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">{t('pr_select_project')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.projectCode} — {isAr ? p.projectName : (p.projectNameEn || p.projectName)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">{t('pr_contract')}</label>
              <select
                className={formInputCls}
                required
                disabled={!projectId}
                value={contractId}
                onChange={(e) => setContractId(e.target.value)}
              >
                <option value="">{t('pr_select_contract')}</option>
                {contractsForProject.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.contractNumber} — {isAr ? c.contractName : (c.contractNameEn || c.contractName)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">{t('pr_boq_item')}</label>
              <select
                className={formInputCls}
                disabled={!contractId}
                value={boqItemId}
                onChange={(e) => setBoqItemId(e.target.value)}
              >
                <option value="">{t('pr_boq_optional')}</option>
                {boqItems.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.itemCode}{b.description ? ` — ${b.description}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">{t('pr_needed_by')}</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {(['today', 'tomorrow', 'calendar'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setNeededPreset(p)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-bold border',
                      neededPreset === p
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 dark:border-gray-700',
                    )}
                  >
                    {p === 'today' ? t('pr_needed_today') : p === 'tomorrow' ? t('pr_needed_tomorrow') : t('pr_needed_calendar')}
                  </button>
                ))}
              </div>
              <input
                type="date"
                required
                className={formInputCls}
                value={neededByDate}
                onChange={(e) => {
                  setNeededPreset('calendar');
                  setNeededByDate(e.target.value);
                }}
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">{t('pr_priority')}</label>
              <select
                className={cn(formInputCls, priorityToneClass(priority))}
                value={priority}
                onChange={(e) => setPriority(e.target.value as PurchaseRequestPriority)}
              >
                <option value="low">{t('pr_priority_low')}</option>
                <option value="medium">{t('pr_priority_medium')}</option>
                <option value="high">{t('pr_priority_high')}</option>
                <option value="urgent">{t('pr_priority_urgent')}</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => goToTab('open')}
              className="px-4 py-2 rounded-lg text-sm font-bold border border-gray-300 dark:border-gray-700"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {t('pr_submit')}
            </button>
          </div>
        </form>
      )}

      {tab !== 'create' && (
      <div className={cn(cardCls, 'overflow-hidden')}>
        {loading ? (
          <div className="p-12 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
            <Loader2 className="animate-spin" size={16} />
            {t('pr_loading')}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-500">{t('pr_empty')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right border-collapse">
              <thead>
                <tr className={cn(theme === 'dark' ? 'bg-gray-900/50 text-gray-400' : 'bg-gray-50 text-gray-600')}>
                  <th className="px-3 py-3 text-xs font-black">{t('pr_col_number')}</th>
                  <th className="px-3 py-3 text-xs font-black">{t('pr_col_material')}</th>
                  <th className="px-3 py-3 text-xs font-black">{t('pr_col_qty')}</th>
                  <th className="px-3 py-3 text-xs font-black">{t('pr_col_needed')}</th>
                  <th className="px-3 py-3 text-xs font-black">{t('pr_col_priority')}</th>
                  <th className="px-3 py-3 text-xs font-black">{t('pr_col_project')}</th>
                  <th className="px-3 py-3 text-xs font-black">{t('pr_col_contract')}</th>
                  <th className="px-3 py-3 text-xs font-black">
                    {tab === 'executed' ? t('pr_col_responded') : t('pr_col_requested')}
                  </th>
                  <th className="px-3 py-3 text-xs font-black">{t('pr_col_status')}</th>
                  <th className="px-3 py-3 text-xs font-black">{t('pr_col_actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {rows.map((r, idx) => {
                  const overdue = isOverdue(r);
                  const timeLabel =
                    tab === 'executed'
                      ? formatDateTimeLabel(r.statusUpdatedAt || r.requestedAt, isAr)
                      : formatDateTimeLabel(r.requestedAt, isAr);
                  return (
                    <tr
                      key={listKey(r.id, idx, 'pr')}
                      className={cn(
                        highlightId === r.id && 'bg-amber-50 dark:bg-amber-900/20',
                        overdue && 'bg-red-50/60 dark:bg-red-950/20',
                        r.status === 'cancelled' && 'opacity-80',
                      )}
                    >
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          {overdue && <AlertTriangle size={14} className="text-red-500 shrink-0" />}
                          {r.requestNumber}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-bold">{materialLabel(r)}</div>
                        {(r.boqItemCode || r.boqDescription) && (
                          <div className="text-[11px] text-gray-500">
                            {r.boqItemCode}
                            {r.boqDescription ? ` — ${r.boqDescription}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono whitespace-nowrap" dir="ltr">
                        {formatQuantity(Number(r.quantity), language)}
                        {r.unit ? ` ${r.unit}` : ''}
                      </td>
                      <td className={cn('px-3 py-2 font-mono whitespace-nowrap', overdue && 'text-red-600 font-bold')}>
                        {r.neededByDate}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-md text-xs',
                            priorityToneClass(r.priority),
                          )}
                        >
                          {priorityLabel(r.priority)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">{projectLabel(r.projectId)}</td>
                      <td className="px-3 py-2 text-xs">{contractLabel(r.contractId)}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">{timeLabel}</td>
                      <td className={cn(
                        'px-3 py-2 whitespace-nowrap font-bold',
                        r.status === 'executed' && 'text-emerald-600',
                        r.status === 'cancelled' && 'text-red-600',
                      )}
                      >
                        {statusLabel(r.status)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-1 min-w-[9rem]">
                          {tab === 'open' && canEditStatus && (
                            <select
                              className={cn(inputCls, 'py-1 text-xs')}
                              value={r.status}
                              onChange={(e) => void handleStatus(r.id, e.target.value as PurchaseRequestStatus)}
                            >
                              <option value="open">{t('pr_status_open')}</option>
                              <option value="contacted">{t('pr_status_contacted')}</option>
                              <option value="postponed">{t('pr_status_postponed')}</option>
                              <option value="unavailable">{t('pr_status_unavailable')}</option>
                              <option value="executed">{t('pr_status_executed')}</option>
                              <option value="cancelled">{t('pr_status_cancelled')}</option>
                            </select>
                          )}
                          {tab === 'open' && (
                            <button
                              type="button"
                              onClick={() => void handleWhatsApp(r.id)}
                              className="px-2 py-1 rounded text-xs font-bold bg-emerald-600 text-white flex items-center justify-center gap-1"
                            >
                              <MessageCircle size={12} />
                              {t('pr_send_whatsapp')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

export default PurchaseRequests;
