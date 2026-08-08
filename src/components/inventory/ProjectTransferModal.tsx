import React, { useState, useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { cn, listKey } from '../../lib/utils';
import { useLanguage } from '../../context/LanguageContext';
import {
  inventoryApi,
  projectInventoryTransfersApi,
  projectsApi,
} from '../../services/local/modulesApi';
import { ManualHelpButton } from '../help/ManualHelpButton';
import { formatQuantity } from '../../lib/formatQuantity';
import { ApiError } from '../../lib/apiClient';
import toast from 'react-hot-toast';
import {
  type Contract,
  type ProjectInventoryItem,
  type ProjectRow,
  accessibleProjectIdsFromContracts,
  asProjectInventoryItems,
  inputCls,
  modalCard,
  modalOverlay,
  projectInventoryItemLabel,
  projectMatchesScope,
  tableTh,
  today,
} from './inventoryUiShared';

async function ensureLocalProjectExists(
  projectId: string,
  hint?: ProjectRow,
): Promise<void> {
  if (!projectId) return;
  try {
    await projectsApi.get(projectId);
    return;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }

  const projectName = hint?.projectName || projectId;
  const projectCode = hint?.projectCode || `PRJ-${projectId.slice(0, 8)}`;
  const clientName = projectName;

  try {
    await projectsApi.create({
      id: projectId,
      projectCode,
      projectName,
      clientName,
      status: 'active',
      budget: 0,
      isDeleted: false,
    } as Parameters<typeof projectsApi.create>[0] & { budget: number });
  } catch (error) {
    const msg = error instanceof ApiError ? error.message : '';
    if (error instanceof ApiError && (error.status === 409 || msg.includes('UNIQUE'))) return;
    throw error;
  }
}

export function ProjectTransferModal({
  projects,
  contracts,
  myContractIds,
  onClose,
  onSaved,
}: {
  projects: ProjectRow[];
  contracts: Contract[];
  myContractIds: string[] | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { language, theme, t } = useLanguage();
  const ar = language === 'ar';
  const [fromProjectId, setFromProjectId] = useState('');
  const [toProjectId, setToProjectId] = useState('');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [sourceInventory, setSourceInventory] = useState<ProjectInventoryItem[]>([]);
  const [selectedLines, setSelectedLines] = useState<{ itemId: number; qty: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingInv, setLoadingInv] = useState(false);

  const accessibleIds = useMemo(
    () => accessibleProjectIdsFromContracts(contracts, myContractIds, projects),
    [contracts, myContractIds, projects],
  );

  const sourceProjects = useMemo(() => {
    if (accessibleIds === null) return projects;
    return projects.filter((p) => projectMatchesScope(p, accessibleIds));
  }, [projects, accessibleIds]);

  const destProjects = useMemo(
    () => projects.filter((p) => p.id !== fromProjectId),
    [projects, fromProjectId],
  );

  useEffect(() => {
    if (!fromProjectId) {
      setSourceInventory([]);
      return;
    }
    setLoadingInv(true);
    inventoryApi
      .projectSummary(fromProjectId)
      .then((d) => {
        const items = asProjectInventoryItems(d);
        setSourceInventory(items.filter((i) => Number(i.quantityAvailable ?? i.quantityBalance) > 0));
      })
      .catch(() => toast.error(ar ? 'فشل تحميل مخزن المشروع' : 'Failed to load project warehouse'))
      .finally(() => setLoadingInv(false));
  }, [fromProjectId, ar]);

  const toggleLine = (itemId: number) =>
    setSelectedLines((prev) =>
      prev.find((l) => l.itemId === itemId)
        ? prev.filter((l) => l.itemId !== itemId)
        : [...prev, { itemId, qty: '' }],
    );

  const updateQty = (itemId: number, qty: string) =>
    setSelectedLines((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, qty } : l)));

  const handleSave = async () => {
    if (!fromProjectId || !toProjectId) {
      toast.error(ar ? 'اختر مشروع المصدر والوجهة' : 'Select source and destination projects');
      return;
    }
    const validLines = selectedLines.filter((l) => Number(l.qty) > 0);
    if (!validLines.length) {
      toast.error(ar ? 'أضف صنفاً واحداً على الأقل بكمية' : 'Add at least one item with quantity');
      return;
    }
    for (const line of validLines) {
      const inv = sourceInventory.find((i) => i.id === line.itemId);
      const avail = Number(inv?.quantityAvailable ?? inv?.quantityBalance ?? 0);
      if (inv && Number(line.qty) > avail) {
        toast.error(
          ar
            ? `${projectInventoryItemLabel(inv, true)}: الكمية تتجاوز المتاح (${formatQuantity(avail, language)})`
            : `${projectInventoryItemLabel(inv, false)}: qty exceeds available (${formatQuantity(avail, language)})`,
        );
        return;
      }
    }
    setLoading(true);
    try {
      const fromRow = sourceProjects.find((p) => p.id === fromProjectId);
      const toRow = projects.find((p) => p.id === toProjectId);
      await ensureLocalProjectExists(fromProjectId, fromRow);
      await ensureLocalProjectExists(toProjectId, toRow);

      await projectInventoryTransfersApi.create({
        fromProjectId,
        toProjectId,
        transferDate: date,
        notes: notes || undefined,
        fromProjectCode: fromRow?.projectCode,
        fromProjectName: fromRow?.projectName,
        toProjectCode: toRow?.projectCode,
        toProjectName: toRow?.projectName,
        lines: validLines.map((l) => ({
          projectInventoryId: l.itemId,
          quantity: Number(l.qty),
        })),
      });
      toast.success(ar ? 'تم إنشاء طلب التحويل بنجاح' : 'Transfer request created');
      window.dispatchEvent(new CustomEvent('notifications:refresh'));
      onSaved();
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : ar ? 'حدث خطأ' : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={modalOverlay()}>
      <div className={cn(modalCard(theme), 'max-w-2xl max-h-[90vh] overflow-y-auto')}>
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          {ar ? 'تحويل خامات بين مخازن المشاريع' : 'Transfer Between Project Warehouses'}
          <ManualHelpButton topicId="inventory.transfer.project" size={16} />
        </h3>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-sm font-medium mb-1">{ar ? 'من مشروع' : 'From Project'}</label>
            <select
              value={fromProjectId}
              onChange={(e) => {
                setFromProjectId(e.target.value);
                setSelectedLines([]);
              }}
              title={ar ? 'من مشروع' : 'From Project'}
              aria-label={ar ? 'من مشروع' : 'From Project'}
              className={inputCls(theme)}
            >
              <option value="">{ar ? '— اختر —' : '— Select —'}</option>
              {sourceProjects.map((p, pi) => (
                <option key={listKey(p.id, pi, `xfer-src-${p.projectCode}`)} value={p.id}>
                  {p.projectCode ? `${p.projectCode} — ` : ''}{p.projectName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{ar ? 'إلى مشروع' : 'To Project'}</label>
            <select
              value={toProjectId}
              onChange={(e) => setToProjectId(e.target.value)}
              title={ar ? 'إلى مشروع' : 'To Project'}
              aria-label={ar ? 'إلى مشروع' : 'To Project'}
              className={inputCls(theme)}
            >
              <option value="">{ar ? '— اختر —' : '— Select —'}</option>
              {destProjects.map((p, pi) => (
                <option key={listKey(p.id, pi, `xfer-dst-${p.projectCode}`)} value={p.id}>
                  {p.projectCode ? `${p.projectCode} — ` : ''}{p.projectName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{ar ? 'تاريخ التحويل' : 'Transfer Date'}</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              title={ar ? 'تاريخ التحويل' : 'Transfer Date'}
              aria-label={ar ? 'تاريخ التحويل' : 'Transfer Date'}
              className={inputCls(theme)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{ar ? 'ملاحظات' : 'Notes'}</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              title={ar ? 'ملاحظات' : 'Notes'}
              aria-label={ar ? 'ملاحظات' : 'Notes'}
              placeholder={ar ? 'اختياري' : 'Optional'}
              className={inputCls(theme)}
            />
          </div>
        </div>

        {fromProjectId && (
          <div className="mt-2">
            <p className="text-sm font-medium mb-2">{ar ? 'أصناف مخزن المشروع المتاحة:' : 'Available warehouse items:'}</p>
            <p className={cn('text-xs mb-2', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
              {t('inventory_transfer_multi_hint')}
            </p>
            {loadingInv ? (
              <div className={cn('flex items-center gap-2 text-sm py-4', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
                <Loader2 className="w-4 h-4 animate-spin" />
                {ar ? 'جاري التحميل...' : 'Loading...'}
              </div>
            ) : sourceInventory.length === 0 ? (
              <p className={cn('text-sm py-4', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
                {ar ? 'لا يوجد رصيد متاح في مخزن هذا المشروع' : 'No available stock in this project warehouse'}
              </p>
            ) : (
              <div className={cn('border rounded-lg overflow-hidden', theme === 'dark' ? 'border-gray-700' : 'border-gray-200')}>
                <table className="w-full text-sm">
                  <thead className={tableTh(theme)}>
                    <tr>
                      <th className="p-2 w-8" />
                      <th className={cn('p-2', ar ? 'text-right' : 'text-left')}>{ar ? 'الصنف' : 'Item'}</th>
                      <th className="p-2 text-center">{ar ? 'الوحدة' : 'Unit'}</th>
                      <th className="p-2 text-center">{ar ? 'المتاح' : 'Available'}</th>
                      <th className="p-2 text-center">{ar ? 'الكمية' : 'Qty'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceInventory.map((inv) => {
                      const sel = selectedLines.find((l) => l.itemId === inv.id);
                      const avail = Number(inv.quantityAvailable ?? inv.quantityBalance ?? 0);
                      return (
                        <tr
                          key={inv.id}
                          className={cn(
                            'border-t transition-colors',
                            theme === 'dark' ? 'border-gray-700' : 'border-gray-100',
                            sel ? (theme === 'dark' ? 'bg-blue-900/20' : 'bg-blue-50') : '',
                          )}
                        >
                          <td className="p-2 text-center">
                            <input
                              type="checkbox"
                              checked={!!sel}
                              onChange={() => toggleLine(inv.id)}
                              title={projectInventoryItemLabel(inv, ar)}
                              aria-label={projectInventoryItemLabel(inv, ar)}
                            />
                          </td>
                          <td className="p-2">{projectInventoryItemLabel(inv, ar)}</td>
                          <td className="p-2 text-center">{inv.unit}</td>
                          <td className="p-2 text-center font-mono text-green-600">
                            {formatQuantity(avail, language)}
                          </td>
                          <td className="p-2 text-center">
                            {sel && (
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={sel.qty}
                                onChange={(e) => updateQty(inv.id, e.target.value)}
                                className={cn(inputCls(theme), 'w-28 text-center')}
                                placeholder="0"
                              />
                            )}
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

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'px-4 py-2 rounded-lg border text-sm transition-colors',
              theme === 'dark' ? 'border-gray-600 hover:bg-gray-700' : 'border-gray-300 hover:bg-gray-50',
            )}
          >
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-60 flex items-center gap-2 transition-colors"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {ar ? 'إرسال طلب التحويل' : 'Submit Transfer'}
          </button>
        </div>
      </div>
    </div>
  );
}
