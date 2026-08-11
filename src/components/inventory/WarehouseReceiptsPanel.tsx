import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, listKey } from '../../lib/utils';
import { businessTodayYmd } from '../../lib/businessCalendar';
import { useLanguage } from '../../context/LanguageContext';
import { usePermissions } from '../../context/PermissionsContext';
import { materialsApi, projectsApi, warehouseReceiptsApi } from '../../services/local/modulesApi';
import { SearchableSelect } from '../ui/SearchableSelect';
import { formatQuantity } from '../../lib/formatQuantity';

type ProjectOption = { id: string; projectName: string; projectCode?: string };

type MaterialOption = {
  id: number;
  code: string;
  name: string;
  unit: string;
};

type ReceiptLine = {
  materialCategoryId: number;
  quantity: number;
  materialCode?: string;
  materialName?: string;
  materialUnit?: string;
  unitCost?: number | null;
  totalCost?: number | null;
  id?: number;
};

type WarehouseReceipt = {
  id: string;
  receiptNumber: string;
  projectId: string;
  projectName?: string;
  receiptDate: string;
  supplierInvoiceRef: string;
  notes?: string | null;
  status: string;
  lines: ReceiptLine[];
  supplierAccountCode?: string | null;
  supplierAccountName?: string | null;
};

type DraftLine = {
  key: string;
  materialCategoryId: string;
  quantity: string;
};

export function WarehouseReceiptsPanel({
  onRefreshNeeded,
}: {
  onRefreshNeeded?: () => void;
}) {
  const { language, theme, dir, t } = useLanguage();
  const ar = language === 'ar';
  const { isAdmin, role, can } = usePermissions();
  const canCreate = can('inventory').create;
  const canReject =
    isAdmin || role === 'projects_manager' || can('costs').edit === true;

  const [receipts, setReceipts] = useState<WarehouseReceipt[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending_approval' | 'approved' | 'rejected' | 'draft'>('pending_approval');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const [projectId, setProjectId] = useState('');
  const [receiptDate, setReceiptDate] = useState(() => businessTodayYmd());
  const [supplierInvoiceRef, setSupplierInvoiceRef] = useState('');
  const [notes, setNotes] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([
    { key: '1', materialCategoryId: '', quantity: '' },
  ]);

  const materialsById = useMemo(() => {
    const map = new Map<number, MaterialOption>();
    for (const m of materials) map.set(m.id, m);
    return map;
  }, [materials]);

  const materialOptions = useMemo(
    () =>
      materials.map((m) => ({
        value: String(m.id),
        label: m.name,
        secondary: m.code,
      })),
    [materials],
  );

  const projectOptions = useMemo(
    () =>
      projects.map((p) => ({
        value: p.id,
        label: p.projectCode ? `${p.projectCode} — ${p.projectName}` : p.projectName,
      })),
    [projects],
  );

  const draftLineCount = useMemo(
    () =>
      draftLines.filter(
        (l) => l.materialCategoryId && Number(l.quantity) > 0,
      ).length,
    [draftLines],
  );

  const updateDraftLine = useCallback((key: string, patch: Partial<DraftLine>) => {
    setDraftLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);

  const addDraftLine = useCallback(() => {
    setDraftLines((prev) => [
      ...prev,
      { key: String(Date.now()), materialCategoryId: '', quantity: '' },
    ]);
  }, []);

  const removeDraftLine = useCallback((key: string) => {
    setDraftLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [receiptData, projectData, cats] = await Promise.all([
        warehouseReceiptsApi.list(
          statusFilter === 'all' ? undefined : { status: statusFilter },
        ),
        projectsApi.list(),
        materialsApi.lookupCategories(),
      ]);
      setReceipts(Array.isArray(receiptData) ? (receiptData as WarehouseReceipt[]) : []);
      setProjects(
        Array.isArray(projectData)
          ? (projectData as ProjectOption[]).map((p) => ({
              id: p.id,
              projectName: p.projectName,
              projectCode: p.projectCode,
            }))
          : [],
      );
      setMaterials(
        Array.isArray(cats)
          ? (cats as MaterialOption[]).map((c) => ({
              id: Number(c.id),
              code: c.code,
              name: c.name,
              unit: c.unit,
            }))
          : [],
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('toast_boq_import_error'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => receipts.find((r) => r.id === selectedId) ?? null,
    [receipts, selectedId],
  );

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      draft: ar ? 'مسودة' : 'Draft',
      pending_approval: t('wr_filter_pending'),
      approved: ar ? 'معتمد' : 'Approved',
      rejected: ar ? 'مرفوض' : 'Rejected',
    };
    const colors: Record<string, string> = {
      draft: 'bg-gray-500',
      pending_approval: 'bg-amber-600',
      approved: 'bg-emerald-600',
      rejected: 'bg-red-600',
    };
    return (
      <span className={cn('text-[10px] px-1.5 py-0.5 rounded text-white', colors[status] || 'bg-gray-500')}>
        {map[status] || status}
      </span>
    );
  };

  const handleCreate = async () => {
    if (!projectId || !supplierInvoiceRef.trim()) {
      toast.error(t('wr_toast_required'));
      return;
    }
    const lines = draftLines
      .map((l) => ({
        materialCategoryId: Number(l.materialCategoryId),
        quantity: Number(l.quantity),
      }))
      .filter((l) => Number.isFinite(l.materialCategoryId) && l.materialCategoryId > 0 && l.quantity > 0);
    if (lines.length === 0) {
      toast.error(t('wr_toast_lines_required'));
      return;
    }
    setSaving(true);
    try {
      await warehouseReceiptsApi.create({
        projectId,
        receiptDate,
        supplierInvoiceRef: supplierInvoiceRef.trim(),
        notes: notes.trim() || undefined,
        submit: true,
        lines,
      });
      toast.success(t('wr_toast_submitted'));
      setShowCreate(false);
      setSupplierInvoiceRef('');
      setNotes('');
      setDraftLines([{ key: String(Date.now()), materialCategoryId: '', quantity: '' }]);
      onRefreshNeeded?.();
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('toast_boq_import_error'));
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await warehouseReceiptsApi.reject(selected.id);
      toast.success(t('wr_toast_rejected'));
      onRefreshNeeded?.();
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('toast_boq_import_error'));
    } finally {
      setSaving(false);
    }
  };

  const inputCls = cn(
    'w-full rounded-lg border px-3 py-2 text-sm',
    theme === 'dark' ? 'bg-gray-800 border-gray-600 text-gray-100' : 'bg-white border-gray-300',
  );

  const showUnitCostCol =
    selected != null &&
    (selected.status === 'approved' || selected.lines.some((l) => l.unitCost != null));

  const tableHeadCls = cn(
    'text-xs font-semibold uppercase tracking-wide',
    theme === 'dark' ? 'text-gray-400' : 'text-gray-500',
  );
  const tableBorder = theme === 'dark' ? 'border-gray-700' : 'border-gray-200';
  const mutedText = theme === 'dark' ? 'text-gray-400' : 'text-gray-500';

  return (
    <div className="flex flex-col gap-4 h-full min-h-0" dir={dir}>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className={cn(inputCls, 'w-auto min-w-[12rem]')}
        >
          <option value="pending_approval">{t('wr_filter_pending')}</option>
          <option value="approved">{t('wr_filter_approved')}</option>
          <option value="rejected">{t('wr_filter_rejected')}</option>
          <option value="draft">{t('wr_filter_draft')}</option>
          <option value="all">{t('wr_filter_all')}</option>
        </select>
        {canCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            {t('wr_new_receipt')}
          </button>
        )}
      </div>

      <div className={cn('flex flex-1 min-h-0 gap-3', dir === 'rtl' ? 'flex-row-reverse' : 'flex-row')}>
        <div
          className={cn(
            'w-80 shrink-0 border rounded-xl overflow-y-auto',
            theme === 'dark' ? 'border-gray-700' : 'border-gray-200',
          )}
        >
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : receipts.length === 0 ? (
            <p className={cn('p-4 text-sm', mutedText)}>{t('wr_empty')}</p>
          ) : (
            <ul>
              {receipts.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={cn(
                      'w-full text-start px-3 py-3 border-b text-sm transition-colors',
                      theme === 'dark' ? 'border-gray-700' : 'border-gray-100',
                      selectedId === r.id
                        ? 'bg-blue-600 text-white'
                        : theme === 'dark'
                          ? 'hover:bg-gray-800'
                          : 'hover:bg-gray-50',
                    )}
                  >
                    <div className="font-medium">{r.receiptNumber}</div>
                    <div className={cn('text-xs mt-0.5 truncate', selectedId === r.id ? 'text-blue-100' : 'opacity-70')}>
                      {r.projectName || r.projectId} · {r.supplierInvoiceRef}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      {statusBadge(r.status)}
                      <span className={cn('text-[10px]', selectedId === r.id ? 'text-blue-100' : mutedText)}>
                        {r.lines?.length ?? 0} {t('wr_lines')}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          className={cn(
            'flex-1 min-w-0 border rounded-xl overflow-hidden flex flex-col',
            theme === 'dark' ? 'border-gray-700' : 'border-gray-200',
          )}
        >
          {!selected ? (
            <p className={cn('p-6 text-sm', mutedText)}>{t('wr_select_hint')}</p>
          ) : (
            <>
              <div
                className={cn(
                  'shrink-0 px-4 py-3 border-b flex flex-wrap items-start gap-3 justify-between',
                  tableBorder,
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold">{selected.receiptNumber}</h3>
                    {statusBadge(selected.status)}
                  </div>
                  <p className={cn('text-sm mt-1', mutedText)}>
                    {selected.projectName} · {selected.receiptDate} · {selected.supplierInvoiceRef}
                  </p>
                  {selected.notes ? (
                    <p className={cn('text-xs mt-1', mutedText)}>{selected.notes}</p>
                  ) : null}
                </div>
                {canReject && selected.status === 'pending_approval' && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleReject()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm disabled:opacity-50 shrink-0"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                    {t('wr_reject')}
                  </button>
                )}
              </div>

              {selected.status === 'pending_approval' && (
                <p
                  className={cn(
                    'shrink-0 text-sm px-4 py-2 border-b',
                    tableBorder,
                    theme === 'dark' ? 'bg-amber-900/40 text-amber-100' : 'bg-amber-50 text-amber-900',
                  )}
                >
                  {t('wr_pending_invoice_hint')}
                </p>
              )}

              <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-full text-sm border-collapse">
                  <thead className={cn('sticky top-0 z-10', theme === 'dark' ? 'bg-gray-900' : 'bg-gray-50')}>
                    <tr className={cn('border-b', tableBorder)}>
                      <th className={cn('text-start px-4 py-2.5 w-12', tableHeadCls)}>{t('wr_col_line')}</th>
                      <th className={cn('text-start px-3 py-2.5', tableHeadCls)}>{t('wr_col_material')}</th>
                      <th className={cn('text-start px-3 py-2.5 w-24', tableHeadCls)}>{t('unit')}</th>
                      <th className={cn('text-end px-4 py-2.5 w-28', tableHeadCls)}>{t('wr_col_qty')}</th>
                      {showUnitCostCol && (
                        <th className={cn('text-end px-4 py-2.5 w-32', tableHeadCls)}>{t('wr_col_unit_cost')}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map((line, idx) => (
                      <tr
                        key={listKey(String(line.id ?? ''), idx, 'wrl')}
                        className={cn(
                          'border-b',
                          tableBorder,
                          theme === 'dark' ? 'hover:bg-gray-800/60' : 'hover:bg-gray-50',
                        )}
                      >
                        <td className={cn('px-4 py-2.5 tabular-nums', mutedText)}>{idx + 1}</td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium">
                            {line.materialCode ? (
                              <>
                                <span className={cn('font-mono text-xs me-1.5', mutedText)}>{line.materialCode}</span>
                                {line.materialName}
                              </>
                            ) : (
                              line.materialName || '—'
                            )}
                          </div>
                        </td>
                        <td className={cn('px-3 py-2.5', mutedText)}>{line.materialUnit || '—'}</td>
                        <td className="px-4 py-2.5 text-end tabular-nums font-medium">
                          {formatQuantity(Number(line.quantity), language)}
                        </td>
                        {showUnitCostCol && (
                          <td className="px-4 py-2.5 text-end tabular-nums">
                            {line.unitCost != null ? Number(line.unitCost).toFixed(2) : '—'}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selected.status === 'approved' && selected.supplierAccountCode && (
                <p className={cn('shrink-0 text-sm px-4 py-2.5 border-t', tableBorder, mutedText)}>
                  {t('wr_credited')}: {selected.supplierAccountCode} — {selected.supplierAccountName}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6">
          <div
            className={cn(
              'rounded-xl shadow-2xl w-full max-w-5xl h-[min(92vh,880px)] overflow-hidden flex flex-col',
              theme === 'dark' ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900',
            )}
            dir={dir}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wr-create-title"
          >
            <div className={cn('shrink-0 px-5 py-4 border-b flex items-center justify-between gap-3', tableBorder)}>
              <div>
                <h3 id="wr-create-title" className="text-lg font-bold">
                  {t('wr_new_receipt')}
                </h3>
                <p className={cn('text-xs mt-0.5', mutedText)}>{t('wr_lines_hint')}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className={cn(
                  'p-2 rounded-lg shrink-0',
                  theme === 'dark' ? 'hover:bg-gray-800' : 'hover:bg-gray-100',
                )}
                aria-label={t('cancel')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="shrink-0 px-5 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="sm:col-span-2 lg:col-span-1">
                <label className="text-xs font-semibold mb-1 block">{t('wr_project')}</label>
                <SearchableSelect
                  theme={theme}
                  dir={dir}
                  value={projectId}
                  onChange={setProjectId}
                  options={projectOptions}
                  placeholder={t('wr_project_placeholder')}
                />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block">{t('wr_date')}</label>
                <input
                  type="date"
                  value={receiptDate}
                  onChange={(e) => setReceiptDate(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block">{t('wr_supplier_invoice')}</label>
                <input
                  type="text"
                  value={supplierInvoiceRef}
                  onChange={(e) => setSupplierInvoiceRef(e.target.value)}
                  className={inputCls}
                  placeholder={t('wr_supplier_invoice_placeholder')}
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <label className="text-xs font-semibold mb-1 block">{t('wr_notes')}</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={inputCls}
                  rows={2}
                />
              </div>
            </div>

            <div className={cn('shrink-0 px-5 py-2.5 border-y flex flex-wrap items-center justify-between gap-2', tableBorder, theme === 'dark' ? 'bg-gray-800/40' : 'bg-gray-50')}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{t('wr_lines')}</span>
                <span
                  className={cn(
                    'text-[11px] px-2 py-0.5 rounded-full',
                    draftLineCount > 0
                      ? 'bg-blue-600 text-white'
                      : theme === 'dark'
                        ? 'bg-gray-700 text-gray-300'
                        : 'bg-gray-200 text-gray-600',
                  )}
                >
                  {t('wr_lines_ready').replace('{n}', String(draftLineCount))}
                </span>
              </div>
              <button
                type="button"
                onClick={addDraftLine}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('wr_add_line')}
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto pb-40">
              <table className="w-full text-sm border-collapse min-w-[640px]">
                <thead className={cn('sticky top-0 z-10', theme === 'dark' ? 'bg-gray-900' : 'bg-white')}>
                  <tr className={cn('border-b', tableBorder)}>
                    <th className={cn('text-start px-4 py-2.5 w-12', tableHeadCls)}>{t('wr_col_line')}</th>
                    <th className={cn('text-start px-3 py-2.5', tableHeadCls)}>{t('wr_col_material')}</th>
                    <th className={cn('text-start px-3 py-2.5 w-24', tableHeadCls)}>{t('unit')}</th>
                    <th className={cn('text-end px-3 py-2.5 w-36', tableHeadCls)}>{t('wr_col_qty')}</th>
                    <th className="w-12 px-2 py-2.5" aria-hidden />
                  </tr>
                </thead>
                <tbody>
                  {draftLines.map((line, idx) => {
                    const mat = line.materialCategoryId
                      ? materialsById.get(Number(line.materialCategoryId))
                      : undefined;
                    return (
                      <tr
                        key={line.key}
                        className={cn(
                          'border-b align-middle',
                          tableBorder,
                          theme === 'dark' ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50/80',
                        )}
                      >
                        <td className={cn('px-4 py-2.5 tabular-nums', mutedText)}>{idx + 1}</td>
                        <td className="px-3 py-2 min-w-[16rem] relative z-20">
                          <SearchableSelect
                            theme={theme}
                            dir={dir}
                            value={line.materialCategoryId}
                            onChange={(v) => updateDraftLine(line.key, { materialCategoryId: v })}
                            options={materialOptions}
                            placeholder={t('wr_material_placeholder')}
                          />
                        </td>
                        <td className={cn('px-3 py-2.5 whitespace-nowrap', mutedText)}>
                          {mat?.unit || '—'}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.quantity}
                            onChange={(e) => updateDraftLine(line.key, { quantity: e.target.value })}
                            className={cn(inputCls, 'text-end tabular-nums')}
                            placeholder="0"
                          />
                        </td>
                        <td className="px-2 py-2 text-center">
                          {draftLines.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => removeDraftLine(line.key)}
                              className="p-2 rounded-lg text-red-500 hover:bg-red-500/10"
                              aria-label={t('wr_remove_line')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          ) : (
                            <span className="inline-block w-8" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className={cn('shrink-0 px-5 py-3 border-t flex justify-end gap-2', tableBorder)}>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className={cn(
                  'px-4 py-2 rounded-lg border text-sm',
                  theme === 'dark' ? 'border-gray-600 hover:bg-gray-800' : 'border-gray-300 hover:bg-gray-50',
                )}
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleCreate()}
                className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('wr_submit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
