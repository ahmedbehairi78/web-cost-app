import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, listKey } from '../../lib/utils';
import { useLanguage } from '../../context/LanguageContext';
import { usePermissions } from '../../context/PermissionsContext';
import { useChartOfAccountsRef } from '../../hooks/useChartOfAccountsRef';
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
  const canApprove =
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
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [supplierInvoiceRef, setSupplierInvoiceRef] = useState('');
  const [notes, setNotes] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([
    { key: '1', materialCategoryId: '', quantity: '' },
  ]);

  const [approveSupplierCode, setApproveSupplierCode] = useState('');
  const [approveCosts, setApproveCosts] = useState<Record<number, string>>({});

  const { accounts: coaAccounts } = useChartOfAccountsRef({ leafOnly: true });

  const supplierOptions = useMemo(
    () =>
      coaAccounts
        .filter((a) => String(a.accountCode || '').startsWith('21101') && String(a.accountCode).length === 8)
        .map((a) => ({
          value: String(a.accountCode),
          label: `${a.accountCode} — ${language === 'ar' ? a.accountName : (a.accountNameEn || a.accountName)}`,
        })),
    [coaAccounts, language],
  );

  const materialOptions = useMemo(
    () =>
      materials.map((m) => ({
        value: String(m.id),
        label: `${m.code} — ${m.name} (${m.unit})`,
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

  useEffect(() => {
    if (!selected || selected.status !== 'pending_approval') {
      setApproveCosts({});
      setApproveSupplierCode('');
      return;
    }
    const next: Record<number, string> = {};
    for (const line of selected.lines) {
      if (line.id != null) next[line.id] = line.unitCost != null ? String(line.unitCost) : '';
    }
    setApproveCosts(next);
  }, [selected]);

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      draft: ar ? 'مسودة' : 'Draft',
      pending_approval: ar ? 'بانتظار الاعتماد' : 'Pending approval',
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

  const handleApprove = async () => {
    if (!selected) return;
    if (!approveSupplierCode.trim()) {
      toast.error(t('wr_toast_supplier_required'));
      return;
    }
    const lines = selected.lines
      .filter((l) => l.id != null)
      .map((l) => ({
        id: Number(l.id),
        unitCost: Number(approveCosts[Number(l.id)] ?? NaN),
      }));
    if (lines.some((l) => !Number.isFinite(l.unitCost) || l.unitCost < 0)) {
      toast.error(t('wr_toast_unit_cost_required'));
      return;
    }
    const supplier = coaAccounts.find((a) => String(a.accountCode) === approveSupplierCode);
    setSaving(true);
    try {
      await warehouseReceiptsApi.approve(selected.id, {
        supplierAccountCode: approveSupplierCode,
        supplierAccountName: supplier?.accountName,
        lines,
      });
      toast.success(t('wr_toast_approved'));
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

  return (
    <div className="flex flex-col gap-4 h-full" dir={dir}>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className={cn(inputCls, 'w-auto')}
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
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm"
          >
            <Plus className="w-4 h-4" />
            {t('wr_new_receipt')}
          </button>
        )}
      </div>

      <div className={cn('flex flex-1 min-h-0 gap-3', dir === 'rtl' ? 'flex-row-reverse' : 'flex-row')}>
        <div
          className={cn(
            'w-72 shrink-0 border rounded-xl overflow-y-auto',
            theme === 'dark' ? 'border-gray-700' : 'border-gray-200',
          )}
        >
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : receipts.length === 0 ? (
            <p className={cn('p-4 text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
              {t('wr_empty')}
            </p>
          ) : (
            <ul>
              {receipts.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={cn(
                      'w-full text-start px-3 py-2.5 border-b text-sm transition-colors',
                      theme === 'dark' ? 'border-gray-700' : 'border-gray-100',
                      selectedId === r.id
                        ? 'bg-blue-600 text-white'
                        : theme === 'dark'
                          ? 'hover:bg-gray-800'
                          : 'hover:bg-gray-50',
                    )}
                  >
                    <div className="font-medium">{r.receiptNumber}</div>
                    <div className={cn('text-xs mt-0.5', selectedId === r.id ? 'text-blue-100' : 'opacity-70')}>
                      {r.projectName || r.projectId} · {r.supplierInvoiceRef}
                    </div>
                    <div className="mt-1">{statusBadge(r.status)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          className={cn(
            'flex-1 border rounded-xl p-4 overflow-y-auto',
            theme === 'dark' ? 'border-gray-700' : 'border-gray-200',
          )}
        >
          {!selected ? (
            <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
              {t('wr_select_hint')}
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{selected.receiptNumber}</h3>
                  <p className="text-sm opacity-70">
                    {selected.projectName} · {selected.receiptDate} · {selected.supplierInvoiceRef}
                  </p>
                </div>
                {statusBadge(selected.status)}
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className={theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}>
                    <th className="text-start py-1">{t('wr_col_material')}</th>
                    <th className="text-end py-1">{t('wr_col_qty')}</th>
                    {canApprove && selected.status === 'pending_approval' && (
                      <th className="text-end py-1">{t('wr_col_unit_cost')}</th>
                    )}
                    {(selected.status === 'approved' || selected.lines.some((l) => l.unitCost != null)) && (
                      <th className="text-end py-1">{t('wr_col_unit_cost')}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((line, idx) => (
                    <tr key={listKey(String(line.id ?? ''), idx, 'wrl')} className="border-t border-opacity-20">
                      <td className="py-2">
                        {line.materialCode} — {line.materialName}
                        <span className="opacity-60 text-xs ms-1">({line.materialUnit})</span>
                      </td>
                      <td className="py-2 text-end">{formatQuantity(Number(line.quantity), language)}</td>
                      {canApprove && selected.status === 'pending_approval' && line.id != null ? (
                        <td className="py-2 text-end">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={approveCosts[line.id] ?? ''}
                            onChange={(e) =>
                              setApproveCosts((prev) => ({ ...prev, [line.id!]: e.target.value }))
                            }
                            className={cn(inputCls, 'w-28 ms-auto')}
                          />
                        </td>
                      ) : (
                        (selected.status === 'approved' || line.unitCost != null) && (
                          <td className="py-2 text-end">
                            {line.unitCost != null ? Number(line.unitCost).toFixed(2) : '—'}
                          </td>
                        )
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              {canApprove && selected.status === 'pending_approval' && (
                <div className="space-y-3 border-t pt-3">
                  <label className="block text-sm font-medium">{t('wr_supplier_account')}</label>
                  <SearchableSelect
                    value={approveSupplierCode}
                    onChange={setApproveSupplierCode}
                    options={supplierOptions}
                    placeholder={t('wr_supplier_placeholder')}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleApprove()}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      {t('wr_approve')}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleReject()}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                      {t('wr_reject')}
                    </button>
                  </div>
                </div>
              )}

              {selected.status === 'approved' && selected.supplierAccountCode && (
                <p className="text-sm opacity-70">
                  {t('wr_credited')}: {selected.supplierAccountCode} — {selected.supplierAccountName}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className={cn(
              'rounded-xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto',
              theme === 'dark' ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900',
            )}
            dir={dir}
          >
            <h3 className="text-lg font-bold mb-4">{t('wr_new_receipt')}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">{t('wr_project')}</label>
                <SearchableSelect
                  value={projectId}
                  onChange={setProjectId}
                  options={projectOptions}
                  placeholder={t('wr_project_placeholder')}
                />
              </div>
              <div>
                <label className="text-sm font-medium">{t('wr_date')}</label>
                <input
                  type="date"
                  value={receiptDate}
                  onChange={(e) => setReceiptDate(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-sm font-medium">{t('wr_supplier_invoice')}</label>
                <input
                  type="text"
                  value={supplierInvoiceRef}
                  onChange={(e) => setSupplierInvoiceRef(e.target.value)}
                  className={inputCls}
                  placeholder={t('wr_supplier_invoice_placeholder')}
                />
              </div>
              <div>
                <label className="text-sm font-medium">{t('wr_notes')}</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={inputCls}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">{t('wr_lines')}</label>
                  <button
                    type="button"
                    onClick={() =>
                      setDraftLines((prev) => [
                        ...prev,
                        { key: String(Date.now()), materialCategoryId: '', quantity: '' },
                      ])
                    }
                    className="text-xs text-blue-600 inline-flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    {t('wr_add_line')}
                  </button>
                </div>
                {draftLines.map((line, idx) => (
                  <div key={line.key} className="flex gap-2 items-start">
                    <div className="flex-1">
                      <SearchableSelect
                        value={line.materialCategoryId}
                        onChange={(v) =>
                          setDraftLines((prev) =>
                            prev.map((l) =>
                              l.key === line.key ? { ...l, materialCategoryId: v } : l,
                            ),
                          )
                        }
                        options={materialOptions}
                        placeholder={t('wr_material_placeholder')}
                      />
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.quantity}
                      onChange={(e) =>
                        setDraftLines((prev) =>
                          prev.map((l) =>
                            l.key === line.key ? { ...l, quantity: e.target.value } : l,
                          ),
                        )
                      }
                      className={cn(inputCls, 'w-24')}
                      placeholder={t('wr_col_qty')}
                    />
                    {draftLines.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setDraftLines((prev) => prev.filter((l) => l.key !== line.key))
                        }
                        className="p-2 text-red-500"
                        aria-label={t('wr_remove_line')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    <span className="sr-only">{idx + 1}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className={cn(
                  'px-4 py-2 rounded-lg border text-sm',
                  theme === 'dark' ? 'border-gray-600' : 'border-gray-300',
                )}
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleCreate()}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50 inline-flex items-center gap-2"
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
