import React, { useEffect, useMemo, useState } from 'react';
import { ManualHelpButton } from '../help/ManualHelpButton';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { cn, listKey } from '../../lib/utils';
import { useLanguage } from '../../context/LanguageContext';
import { useChartOfAccountsRef } from '../../hooks/useChartOfAccountsRef';
import {
  boqMaterialsApi,
  consumptionOrdersApi,
  inventoryApi,
  boqApi,
} from '../../services/local/modulesApi';
import { AccountCodes } from '../../services/accountingService';
import { ApiError } from '../../lib/apiClient';
import { formatQuantity } from '../../lib/formatQuantity';
import {
  validateAllocationLines,
  type AllocationLineInput,
} from '../../lib/consumptionAllocation';
import { SearchableSelect } from '../ui/SearchableSelect';
import {
  ConsumptionAllocationModal,
  type AllocationLineResult,
  type BoqAllocationRow,
} from './ConsumptionAllocationModal';
import { QuickLinkMaterialModal } from './QuickLinkMaterialModal';
import toast from 'react-hot-toast';
import { useUserAccessScope } from '../../hooks/useUserAccessScope';
import type { AppTheme } from '../../lib/shellTheme';

export type ProjectInventoryItemForConsume = {
  id: number;
  projectId: string;
  materialCategoryId?: number;
  materialCode?: string;
  materialName?: string;
  itemDescription: string;
  unit: string;
  quantityAvailable: number;
};

type WarehouseMaterialOption = {
  materialCategoryId: number;
  code: string;
  name: string;
  unit: string;
  quantityAvailable: number;
};

type CartMaterialLine = {
  materialCategoryId: number;
  code: string;
  name: string;
  unit: string;
  quantityAvailable: number;
  totalQuantity: number;
  allocationLines: AllocationLineInput[];
};

type Theme = AppTheme;
type ExpenseAccountPreferenceMap = Record<string, string>;

const today = () => new Date().toISOString().slice(0, 10);
const EXPENSE_PREFS_STORAGE_KEY = 'consumptionExpenseAccountByGroup_v1';

function normalizeAccountCode(code: unknown): string {
  return String(code ?? '').trim();
}

function itemLabel(item: Pick<ProjectInventoryItemForConsume, 'materialName' | 'materialCode' | 'itemDescription'>) {
  return item.materialName || item.materialCode || item.itemDescription;
}

function guessExpenseAccountCode(material?: WarehouseMaterialOption | CartMaterialLine): string {
  const haystack = `${material?.code ?? ''} ${material?.name ?? ''}`.toLowerCase();
  if (/subcontract|sub-contractor|مقاول|باطن/.test(haystack)) return AccountCodes.EXPENSE_SUBCONTRACTOR;
  if (/labou?r|عمال|اجور|أجور/.test(haystack)) return AccountCodes.EXPENSE_LABOUR;
  if (/equip|machine|machinery|معدات|آلات|الات/.test(haystack)) return AccountCodes.EXPENSE_EQUIPMENT;
  return AccountCodes.EXPENSE_MATERIALS;
}

function normalizeGroupKey(material?: WarehouseMaterialOption | CartMaterialLine): string {
  return String(material?.code || material?.name || '').trim().toLowerCase();
}

function loadExpenseAccountPrefs(): ExpenseAccountPreferenceMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(EXPENSE_PREFS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as ExpenseAccountPreferenceMap;
  } catch {
    return {};
  }
}

function persistExpenseAccountPrefs(map: ExpenseAccountPreferenceMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(EXPENSE_PREFS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage errors.
  }
}

function inputCls(theme: Theme) {
  return cn(
    'w-full border rounded-lg px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-blue-500',
    theme === 'dark'
      ? 'bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500'
      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400',
  );
}

function normalizeBoqAllocationRows(rows: unknown): BoqAllocationRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      const boqItemId = String(r.boqItemId ?? r.boq_item_id ?? r.id ?? '').trim();
      if (!boqItemId) return null;
      return {
        boqItemId,
        itemCode: String(r.itemCode ?? r.item_code ?? ''),
        description: String(r.description ?? ''),
        sectionName: r.sectionName ? String(r.sectionName) : r.section_name ? String(r.section_name) : undefined,
        unit: String(r.unit ?? ''),
        tenderQty: Number(r.tenderQty ?? r.tender_qty ?? 0),
        tenderAmount: Number(r.tenderAmount ?? r.tender_amount ?? 0),
        unitRateTotal: Number(r.unitRateTotal ?? r.unit_rate_total ?? 0),
      };
    })
    .filter((row): row is BoqAllocationRow => row != null);
}

function asWarehouseMaterials(data: unknown): WarehouseMaterialOption[] {
  const items = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && 'items' in data && Array.isArray((data as { items: unknown }).items)
      ? (data as { items: unknown[] }).items
      : [];

  return items
    .map((raw) => {
      const row = raw as Record<string, unknown>;
      const materialCategoryId = Number(row.materialCategoryId);
      const quantityAvailable = Number(row.quantityAvailable ?? row.quantityBalance ?? 0);
      if (!materialCategoryId || !(quantityAvailable > 0)) return null;
      return {
        materialCategoryId,
        code: String(row.materialCode ?? row.code ?? ''),
        name: String(row.materialName ?? row.name ?? row.itemDescription ?? ''),
        unit: String(row.unit ?? ''),
        quantityAvailable,
      };
    })
    .filter((row): row is WarehouseMaterialOption => row != null);
}

export function ConsumptionOrderModal({
  projectId,
  contractId,
  contractLabel,
  projectLabel,
  preselectedItem,
  onClose,
  onSaved,
}: {
  projectId: string;
  contractId: string;
  contractLabel?: string;
  projectLabel?: string;
  preselectedItem?: ProjectInventoryItemForConsume | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { language, theme, t, dir } = useLanguage();
  const ar = language === 'ar';
  const { role, isAdmin } = useUserAccessScope();
  const canQuickLink =
    isAdmin ||
    role === 'projects_manager' ||
    role === 'project_accountant';

  const [warehouseMaterials, setWarehouseMaterials] = useState<WarehouseMaterialOption[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(true);
  const [cart, setCart] = useState<CartMaterialLine[]>([]);
  const [draftMaterialId, setDraftMaterialId] = useState<number | ''>(
    preselectedItem?.materialCategoryId ?? '',
  );
  const [draftQuantity, setDraftQuantity] = useState('');
  const [allocationOpen, setAllocationOpen] = useState(false);
  const [boqRows, setBoqRows] = useState<BoqAllocationRow[]>([]);
  const [loadingBoqRows, setLoadingBoqRows] = useState(false);
  const [quickLinkOpen, setQuickLinkOpen] = useState(false);
  const [allBoqItemsForLink, setAllBoqItemsForLink] = useState<
    Array<{ id: string; itemCode: string; description: string; unit: string }>
  >([]);
  const [orderDate, setOrderDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [expenseAccountCode, setExpenseAccountCode] = useState<string>(AccountCodes.EXPENSE_MATERIALS);
  const [expenseAccountTouched, setExpenseAccountTouched] = useState(false);
  const [expenseAccountPrefs, setExpenseAccountPrefs] = useState<ExpenseAccountPreferenceMap>(() =>
    loadExpenseAccountPrefs(),
  );

  const { accounts } = useChartOfAccountsRef({ leafOnly: true });

  const draftMaterial = warehouseMaterials.find((m) => m.materialCategoryId === draftMaterialId);
  const draftMaterialGroupKey = useMemo(() => normalizeGroupKey(draftMaterial), [draftMaterial]);
  const draftMaxAvailable =
    draftMaterial?.quantityAvailable ??
    (preselectedItem?.materialCategoryId === draftMaterialId ? preselectedItem.quantityAvailable : null);
  const draftUnit = draftMaterial?.unit || preselectedItem?.unit || '';
  const draftQty = Number(String(draftQuantity).replace(/,/g, '')) || 0;

  const materialsAvailableToAdd = useMemo(
    () => warehouseMaterials.filter((m) => !cart.some((c) => c.materialCategoryId === m.materialCategoryId)),
    [warehouseMaterials, cart],
  );

  const expenseAccounts = useMemo(
    () =>
      accounts
        .filter((acc) => {
          const code = String(acc.accountCode || '').trim();
          return code.startsWith('5') && code.length === 8 && !acc.isGroup && acc.status !== 'disabled';
        })
        .sort((a, b) => String(a.accountCode).localeCompare(String(b.accountCode))),
    [accounts],
  );

  const selectedExpenseAccount = useMemo(
    () =>
      expenseAccounts.find(
        (acc) => normalizeAccountCode(acc.accountCode) === normalizeAccountCode(expenseAccountCode),
      ),
    [expenseAccounts, expenseAccountCode],
  );

  useEffect(() => {
    setLoadingMaterials(true);
    inventoryApi
      .projectSummary(projectId)
      .then((summary) => setWarehouseMaterials(asWarehouseMaterials(summary)))
      .catch(() => {
        setWarehouseMaterials([]);
        toast.error(t('consume_alloc_no_boq'));
      })
      .finally(() => setLoadingMaterials(false));
  }, [projectId, t]);

  useEffect(() => {
    if (!draftMaterialId) {
      setBoqRows([]);
      return;
    }
    setLoadingBoqRows(true);
    boqMaterialsApi
      .byMaterial(Number(draftMaterialId), contractId)
      .then((rows) => setBoqRows(normalizeBoqAllocationRows(rows)))
      .catch((err: unknown) => {
        setBoqRows([]);
        if (err instanceof ApiError && err.status === 404) {
          toast.error(t('consume_alloc_api_restart'));
          return;
        }
        toast.error(t('consume_alloc_no_boq'));
      })
      .finally(() => setLoadingBoqRows(false));
  }, [draftMaterialId, contractId, t]);

  useEffect(() => {
    if (!canQuickLink || !projectId) return;
    boqApi
      .list(`?projectId=${encodeURIComponent(projectId)}`)
      .then((items) =>
        setAllBoqItemsForLink(
          items
            .filter((item) => item.isDeleted !== true)
            .map((item) => ({
              id: item.id,
              itemCode: item.itemCode,
              description: item.description,
              unit: item.unit,
            })),
        ),
      )
      .catch(() => setAllBoqItemsForLink([]));
  }, [canQuickLink, projectId]);

  useEffect(() => {
    if (expenseAccountTouched) return;
    const hintMaterial = cart[0] ?? draftMaterial;
    const groupKey = normalizeGroupKey(hintMaterial);
    const preferred = groupKey ? expenseAccountPrefs[groupKey] : '';
    if (preferred && expenseAccounts.some((acc) => normalizeAccountCode(acc.accountCode) === preferred)) {
      setExpenseAccountCode(preferred);
      return;
    }
    const guessed = guessExpenseAccountCode(hintMaterial);
    if (expenseAccounts.some((acc) => normalizeAccountCode(acc.accountCode) === guessed)) {
      setExpenseAccountCode(guessed);
      return;
    }
    if (expenseAccounts.some((acc) => normalizeAccountCode(acc.accountCode) === AccountCodes.EXPENSE_MATERIALS)) {
      setExpenseAccountCode(AccountCodes.EXPENSE_MATERIALS);
      return;
    }
    const first = expenseAccounts[0]?.accountCode;
    if (first) setExpenseAccountCode(normalizeAccountCode(first));
  }, [expenseAccountTouched, expenseAccounts, draftMaterial, cart, expenseAccountPrefs]);

  const openAllocation = () => {
    if (!draftMaterialId || !draftMaterial) {
      toast.error(t('consume_order_select_material'));
      return;
    }
    if (!(draftQty > 0)) {
      toast.error(t('consume_order_total_qty'));
      return;
    }
    if (draftMaxAvailable != null && draftQty > draftMaxAvailable + 0.01) {
      toast.error(t('consume_alloc_exceeds'));
      return;
    }
    setAllocationOpen(true);
  };

  const handleApplyAllocation = (lines: AllocationLineResult[]) => {
    if (!draftMaterialId || !draftMaterial) return;
    const check = validateAllocationLines({
      totalIssued: draftQty,
      lines,
      maxAvailable: draftMaxAvailable ?? draftQty,
    });
    if (!check.ok) {
      toast.error(t('consume_alloc_mismatch'));
      return;
    }
    setCart((prev) => {
      const without = prev.filter((c) => c.materialCategoryId !== draftMaterial.materialCategoryId);
      return [
        ...without,
        {
          materialCategoryId: draftMaterial.materialCategoryId,
          code: draftMaterial.code,
          name: draftMaterial.name,
          unit: draftMaterial.unit,
          quantityAvailable: draftMaterial.quantityAvailable,
          totalQuantity: draftQty,
          allocationLines: lines,
        },
      ];
    });
    setDraftMaterialId('');
    setDraftQuantity('');
    setBoqRows([]);
    toast.success(t('consume_order_cart_added'));
  };

  const removeFromCart = (materialCategoryId: number) => {
    setCart((prev) => prev.filter((c) => c.materialCategoryId !== materialCategoryId));
  };

  const handleSave = async () => {
    if (cart.length === 0) {
      toast.error(t('consume_order_cart_empty'));
      return;
    }
    for (const item of cart) {
      const check = validateAllocationLines({
        totalIssued: item.totalQuantity,
        lines: item.allocationLines,
        maxAvailable: item.quantityAvailable,
      });
      if (!check.ok) {
        toast.error(
          `${item.code || item.name}: ${
            check.error === 'exceeds_available' ? t('consume_alloc_exceeds') : t('consume_alloc_mismatch')
          }`,
        );
        return;
      }
    }
    if (!selectedExpenseAccount) {
      toast.error(t('toast_pick_expense_account'));
      return;
    }

    const expenseCode = normalizeAccountCode(selectedExpenseAccount.accountCode);
    const expenseName =
      language === 'ar'
        ? selectedExpenseAccount.accountName
        : selectedExpenseAccount.accountNameEn || selectedExpenseAccount.accountName;

    const flatLines = cart.flatMap((item) =>
      item.allocationLines.map((line) => ({
        boqItemId: line.boqItemId,
        materialCategoryId: item.materialCategoryId,
        quantity: line.quantity,
      })),
    );

    setSaving(true);
    try {
      const created = (await consumptionOrdersApi.create({
        contractId,
        projectId,
        orderDate,
        notes: notes.trim() || undefined,
        expenseAccountCode: expenseCode,
        expenseAccountName: expenseName,
        lines: flatLines,
      })) as { ok?: boolean; order?: { id: number } };

      const orderId = created?.order?.id;
      if (!orderId) throw new Error(t('consume_order_allocation_required'));

      await consumptionOrdersApi.confirm(orderId);
      toast.success(t('toast_consume_confirmed'));
      onSaved();
      onClose();
    } catch (e: unknown) {
      const rawMessage = e instanceof Error ? e.message : '';
      if (/insufficient project warehouse balance/i.test(rawMessage)) {
        const availableMatch = rawMessage.match(/available:\s*([0-9.]+)/i);
        const available = Number(availableMatch?.[1] ?? NaN);
        if (Number.isFinite(available)) {
          toast.error(`${t('consume_alloc_exceeds')} (${formatQuantity(available, language)})`);
          return;
        }
      }
      toast.error(rawMessage || t('toast_boq_import_error'));
    } finally {
      setSaving(false);
    }
  };

  const modalCard = cn(
    'rounded-xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto',
    theme === 'dark' ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900',
  );

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className={modalCard}>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-bold">{t('consume_order_title')}</h3>
            <ManualHelpButton topicId="inventory.consumption.issue" size={16} />
          </div>
          {(projectLabel || contractLabel) && (
            <p className={cn('text-xs mb-4', theme === 'dark' ? 'text-gray-500' : 'text-gray-500')}>
              {[projectLabel, contractLabel].filter(Boolean).join(' · ')}
            </p>
          )}
          <p className={cn('text-xs mb-3', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
            {t('consume_order_multi_hint')}
          </p>

          {preselectedItem && cart.length === 0 && !draftMaterialId && (
            <p className={cn('text-sm mb-4 rounded-lg px-3 py-2', theme === 'dark' ? 'bg-gray-800' : 'bg-gray-50')}>
              <span className="font-semibold">{itemLabel(preselectedItem)}</span>
              {' — '}
              {formatQuantity(preselectedItem.quantityAvailable, language)} {preselectedItem.unit}
            </p>
          )}

          <div className="space-y-3">
            <div className={cn('rounded-lg border p-3 space-y-3', theme === 'dark' ? 'border-gray-700' : 'border-gray-200')}>
              <p className="text-sm font-semibold">{t('consume_order_add_material')}</p>
              <div>
                <label className="block text-sm font-medium mb-1">{t('consume_order_material')}</label>
                {loadingMaterials ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                ) : (
                  <select
                    aria-label={t('consume_order_material')}
                    value={draftMaterialId}
                    onChange={(e) => setDraftMaterialId(e.target.value ? Number(e.target.value) : '')}
                    className={inputCls(theme)}
                  >
                    <option value="">{t('consume_order_select_material')}</option>
                    {materialsAvailableToAdd.map((material) => (
                      <option key={material.materialCategoryId} value={material.materialCategoryId}>
                        {material.code} — {material.name} ({formatQuantity(material.quantityAvailable, language)}{' '}
                        {material.unit})
                      </option>
                    ))}
                  </select>
                )}
                {draftMaterialId && draftMaxAvailable != null && (
                  <p className="text-xs mt-1 text-green-600">
                    {formatQuantity(draftMaxAvailable, language)} {draftUnit}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{t('consume_order_total_qty')}</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draftQuantity}
                  onChange={(e) => setDraftQuantity(e.target.value)}
                  className={inputCls(theme)}
                  placeholder={
                    draftMaxAvailable != null
                      ? `${formatQuantity(draftMaxAvailable, language)} ${draftUnit}`
                      : undefined
                  }
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <ManualHelpButton topicId="inventory.consumption.multi_boq" size={14} />
                <button
                  type="button"
                  onClick={openAllocation}
                  disabled={!draftMaterialId || !(draftQty > 0) || loadingBoqRows}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm border-blue-500 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  {t('consume_order_allocate_add')}
                </button>
                {canQuickLink && boqRows.length === 0 && draftMaterialId && (
                  <button
                    type="button"
                    onClick={() => setQuickLinkOpen(true)}
                    className="px-3 py-2 rounded-lg border text-sm border-emerald-500 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                  >
                    {t('consume_order_quick_link')}
                  </button>
                )}
              </div>
            </div>

            {cart.length > 0 && (
              <div className={cn('rounded-lg border overflow-hidden', theme === 'dark' ? 'border-gray-700' : 'border-gray-200')}>
                <div className={cn('px-3 py-2 text-sm font-semibold', theme === 'dark' ? 'bg-gray-800' : 'bg-gray-50')}>
                  {t('consume_order_cart_title').replace('{count}', String(cart.length))}
                </div>
                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                  {cart.map((item, idx) => (
                    <li
                      key={listKey(String(item.materialCategoryId), idx, 'cart')}
                      className="px-3 py-2 flex items-start justify-between gap-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          {item.code ? `${item.code} — ` : ''}
                          {item.name}
                        </p>
                        <p className={cn('text-xs', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
                          {formatQuantity(item.totalQuantity, language)} {item.unit}
                          {' · '}
                          {t('consume_order_allocation_summary').replace(
                            '{count}',
                            String(item.allocationLines.length),
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFromCart(item.materialCategoryId)}
                        className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                        title={t('delete')}
                        aria-label={t('delete')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">{t('toast_pick_expense_account')}</label>
              {expenseAccounts.length === 0 ? (
                <p className="text-xs text-amber-600">{t('toast_pick_expense_account')}</p>
              ) : (
                <SearchableSelect
                  value={expenseAccountCode}
                  onChange={(code) => {
                    const normalized = normalizeAccountCode(code);
                    setExpenseAccountTouched(true);
                    setExpenseAccountCode(normalized);
                    if (draftMaterialGroupKey || cart[0]) {
                      const key = draftMaterialGroupKey || normalizeGroupKey(cart[0]);
                      if (key) {
                        setExpenseAccountPrefs((prev) => {
                          const next = { ...prev, [key]: normalized };
                          persistExpenseAccountPrefs(next);
                          return next;
                        });
                      }
                    }
                  }}
                  theme={theme}
                  dir={dir}
                  placeholder={t('toast_pick_expense_account')}
                  options={expenseAccounts.map((acc, idx) => ({
                    value: normalizeAccountCode(acc.accountCode) || `acc-${idx}`,
                    secondary: normalizeAccountCode(acc.accountCode),
                    label:
                      language === 'ar'
                        ? acc.accountName
                        : acc.accountNameEn || acc.accountName,
                  }))}
                />
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">{t('consume_order_date')}</label>
              <input
                type="date"
                aria-label={t('consume_order_date')}
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className={inputCls(theme)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">{t('consume_order_notes')}</label>
              <input
                type="text"
                aria-label={t('consume_order_notes')}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={inputCls(theme)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={onClose}
              className={cn(
                'px-4 py-2 rounded-lg border text-sm transition-colors',
                theme === 'dark' ? 'border-gray-600 hover:bg-gray-700' : 'border-gray-300 hover:bg-gray-50',
              )}
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || cart.length === 0}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm disabled:opacity-60 flex items-center gap-2 transition-colors"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('consume_order_confirm')}
            </button>
          </div>
        </div>
      </div>

      <ConsumptionAllocationModal
        open={allocationOpen}
        contractId={contractId}
        materialCategoryId={draftMaterialId}
        totalIssueQty={draftQty}
        unit={draftUnit}
        rows={boqRows}
        loading={loadingBoqRows}
        theme={theme}
        onClose={() => setAllocationOpen(false)}
        onApply={handleApplyAllocation}
      />

      {quickLinkOpen && draftMaterialId && draftMaterial && (
        <QuickLinkMaterialModal
          materialCategoryId={draftMaterialId}
          materialName={draftMaterial.name}
          contractId={contractId}
          allBoqItems={allBoqItemsForLink}
          onLinked={() => {
            setQuickLinkOpen(false);
            setLoadingBoqRows(true);
            boqMaterialsApi
              .byMaterial(Number(draftMaterialId), contractId)
              .then((rows) => setBoqRows(normalizeBoqAllocationRows(rows)))
              .catch(() => setBoqRows([]))
              .finally(() => setLoadingBoqRows(false));
          }}
          onClose={() => setQuickLinkOpen(false)}
        />
      )}
    </>
  );
}
