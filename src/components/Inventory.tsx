import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useErpModuleDraft, useErpModuleView } from '../hooks/useErpModuleView';
import { ManualHelpButton } from './help/ManualHelpButton';
import {
  Package, ArrowLeftRight, History, Plus, CheckCircle2, XCircle,
  Loader2, ChevronDown, ChevronUp, RefreshCw, Printer, AlertTriangle,
  Upload, FileSpreadsheet,
} from 'lucide-react';
import { cn, listKey, compositeListKey } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';
import { useUserAccessScope } from '../hooks/useUserAccessScope';
import { usePermissions } from '../context/PermissionsContext';
import { useApiQuery } from '../hooks/useApiQuery';
import { auth } from '../firebase';
import {
  inventoryApi,
  inventoryTransfersApi,
  projectInventoryTransfersApi,
  contractsApi,
  consumptionOrdersApi,
  returnOrdersApi,
  projectsApi,
  chartOfAccountsApi,
  settingsApi,
  type ProjectInventoryMovement,
} from '../services/local/modulesApi';
import { useReportDocumentPreview } from '../hooks/useReportDocumentPreview';
import { buildConsumptionOrderSections } from '../lib/reportDocument';
import type { CompanyPrintInfo } from '../lib/ipcPrintData';
import type { InventoryPrintRow } from '../lib/inventoryPrintData';
import { ConsumptionOrderModal, type ProjectInventoryItemForConsume } from './inventory/ConsumptionOrderModal';
import { ReturnOrderModal, type ReturnOrderLineContext } from './inventory/ReturnOrderModal';
import { UnlinkedMaterialsReport } from './inventory/UnlinkedMaterialsReport';
import { MaterialsTree } from './MaterialsTree';
import { isLocalBackend } from '../lib/dataBackend';
import { formatQuantity } from '../lib/formatQuantity';
import { formatMoney as formatMoneyLib } from '../lib/money';
import {
  findDisabledProjectWarehouseAccount,
  findWarehouseAccountRowForProject,
} from '../lib/projectWarehouse';
import {
  exportOpeningInventoryTemplate,
  parseOpeningInventoryFile,
} from '../lib/inventoryOpeningExcel';
import toast from 'react-hot-toast';
import { consumePendingShellView, peekPendingShellView } from '../lib/shellNavigation';
import { ApiError } from '../lib/apiClient';
import { accountingService } from '../services/accountingService';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectInventoryItem {
  id: number;
  projectId: string;
  projectName?: string;
  projectCode?: string;
  materialCategoryId?: number;
  materialCode?: string;
  materialName?: string;
  itemDescription: string;
  unit: string;
  quantityIn: number;
  quantityIssued: number;
  quantityReturned: number;
  quantityBalance: number;
  quantityReserved: number;
  quantityAvailable: number;
  unitCost: number;
  avgUnitCost?: number;
  updatedAt?: string;
}

/** @deprecated legacy contract_inventory — hidden from balance tab */
interface InventoryItem {
  id: number;
  contractId: string;
  contractName?: string;
  contractNumber?: string;
  projectName?: string;
  materialCategoryId?: number;
  materialCode?: string;
  materialName?: string;
  itemDescription: string;
  unit: string;
  quantityIn: number;
  quantityConsumed: number;
  quantityTransferredOut: number;
  quantityTransferredIn: number;
  quantityBalance: number;
  quantityReserved: number;
  quantityAvailable: number;
  unitCost: number;
  avgUnitCost?: number;
  updatedAt: string;
}

interface ConsumptionOrderLine {
  id: number;
  boqItemId: string;
  materialCategoryId: number;
  materialCode?: string;
  materialName?: string;
  materialUnit?: string;
  boqItemCode?: string;
  boqDescription?: string;
  sectionName?: string;
  chapterName?: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

interface ConsumptionOrder {
  id: number;
  orderNumber: string;
  contractId: string;
  projectId?: string;
  contractName?: string;
  contractNumber?: string;
  projectName?: string;
  orderDate: string;
  status: 'draft' | 'confirmed';
  notes?: string;
  expenseAccountCode?: string;
  expenseAccountName?: string;
  lines: ConsumptionOrderLine[];
}

interface ReturnOrderLine {
  id: number;
  consumptionOrderLineId: number;
  materialCode?: string;
  materialName?: string;
  materialUnit?: string;
  boqItemCode?: string;
  boqDescription?: string;
  consumptionOrderNumber?: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

interface ReturnOrder {
  id: number;
  returnNumber: string;
  contractId: string;
  projectId?: string;
  contractName?: string;
  projectName?: string;
  returnDate: string;
  status: 'draft' | 'confirmed';
  lines: ReturnOrderLine[];
}

type ConsumptionHistoryRow =
  | {
      kind: 'consumption';
      key: string;
      orderId: number;
      lineId: number;
      projectId: string;
      contractId: string;
      orderNumber: string;
      orderDate: string;
      status: string;
      boqItemCode?: string;
      boqDescription?: string;
      materialName: string;
      unit: string;
      quantity: number;
      unitCost: number;
      totalCost: number;
      contractName?: string;
      projectName?: string;
      showGroupCells: boolean;
      groupRowSpan: number;
      linesInOrder: number;
    }
  | {
      kind: 'return';
      key: string;
      returnOrderId: number;
      consumptionOrderLineId: number;
      projectId: string;
      contractId: string;
      returnNumber: string;
      consumptionOrderNumber?: string;
      returnDate: string;
      status: string;
      boqItemCode?: string;
      boqDescription?: string;
      materialName: string;
      unit: string;
      quantity: number;
      unitCost: number;
      totalCost: number;
      contractName?: string;
      projectName?: string;
    };

function projectInventoryLabel(item: ProjectInventoryItem): string {
  return item.materialName || item.materialCode || item.itemDescription;
}

function projectInventoryUnitCost(item: ProjectInventoryItem): number {
  return Number(item.avgUnitCost ?? item.unitCost ?? 0);
}

function asProjectInventoryItems(data: unknown): ProjectInventoryItem[] {
  if (Array.isArray(data)) return data as ProjectInventoryItem[];
  if (data && typeof data === 'object' && 'items' in data && Array.isArray((data as { items: unknown }).items))
    return (data as { items: ProjectInventoryItem[] }).items;
  return [];
}

function inventoryItemLabel(item: InventoryItem): string {
  return item.materialName || item.materialCode || item.itemDescription;
}

function inventoryUnitCost(item: InventoryItem): number {
  return Number(item.avgUnitCost ?? item.unitCost ?? 0);
}

function isWarehouseAccountRow(account: WarehouseAccountRow): boolean {
  const code = String(account.accountCode || '').trim();
  return code.startsWith('127') && code.length === 8 && account.status !== 'disabled';
}

function warehouseAccountForProject(
  accounts: WarehouseAccountRow[],
  projectId: string,
  projectRow?: Pick<ProjectRow, 'inventoryAccountCode' | 'projectName'>,
): WarehouseAccountRow | undefined {
  return findWarehouseAccountRowForProject(projectId, accounts, {
    id: projectId,
    projectName: projectRow?.projectName,
    inventoryAccountCode: projectRow?.inventoryAccountCode,
  });
}

function transferProjectHint(
  row: ProjectRow | undefined,
  transfer: Pick<ProjectInventoryTransfer, 'fromProjectName' | 'toProjectName'>,
  side: 'from' | 'to',
): Pick<ProjectRow, 'projectName' | 'inventoryAccountCode'> | undefined {
  if (row) return row;
  const name = side === 'from' ? transfer.fromProjectName : transfer.toProjectName;
  return name ? { projectName: name } : undefined;
}

async function resolveWarehouseAccountsForTransfer(
  projectId: string,
  accounts: WarehouseAccountRow[],
  hint?: Pick<ProjectRow, 'projectName' | 'inventoryAccountCode'>,
): Promise<WarehouseAccountRow | undefined> {
  let list = accounts;
  if (list.length === 0) {
    try {
      list = await fetchWarehouseAccountRows();
    } catch {
      return undefined;
    }
  }
  return warehouseAccountForProject(list, projectId, hint);
}

function findDisabledLinkedWarehouse(
  projectId: string,
  accounts: WarehouseAccountRow[],
  hint?: Pick<ProjectRow, 'inventoryAccountCode'>,
): WarehouseAccountRow | undefined {
  return findDisabledProjectWarehouseAccount(projectId, accounts, {
    id: projectId,
    inventoryAccountCode: hint?.inventoryAccountCode,
  });
}

/** Firestore→SQLite sync can mark linked warehouse rows disabled; reactivate before transfer approval. */
async function ensureLinkedWarehouseActiveForProject(
  projectId: string,
  hint?: Pick<ProjectRow, 'inventoryAccountCode'>,
): Promise<void> {
  if (!isLocalBackend) return;
  const invCode = String(hint?.inventoryAccountCode || '').trim();
  if (!invCode) return;
  try {
    const rows = (await chartOfAccountsApi.list()) as Record<string, unknown>[];
    const acc = rows.find((r) => String(r.accountCode || '').trim() === invCode);
    if (!acc?.id || String(acc.status || '') !== 'disabled') return;
    await chartOfAccountsApi.update(String(acc.id), { status: 'active', projectId });
  } catch {
    // Server reactivates linked accounts during journal post if client update fails.
  }
}

function transferTotalCost(t: ProjectInventoryTransfer): number {
  return (t.lines ?? []).reduce(
    (sum, line) => sum + Number(line.totalCost ?? Number(line.quantity) * Number(line.unitCost)),
    0,
  );
}

function nextWarehouseAccountCode(accounts: WarehouseAccountRow[]): string {
  const nums = accounts
    .filter(isWarehouseAccountRow)
    .map((a) => Number.parseInt(String(a.accountCode), 10))
    .filter(Number.isFinite);
  const next = nums.length ? Math.max(...nums) + 1 : 12701001;
  return String(next).padStart(8, '0');
}

function mapCoaRowToWarehouseAccount(raw: Record<string, unknown>): WarehouseAccountRow {
  const accountCode = String(raw.accountCode ?? raw.account_code ?? '').trim();
  const id = String(raw.id ?? accountCode).trim();
  return {
    id: id || accountCode,
    accountCode,
    accountName: String(raw.accountName ?? raw.account_name ?? ''),
    accountNameEn: raw.accountNameEn ? String(raw.accountNameEn) : raw.account_name_en ? String(raw.account_name_en) : undefined,
    projectId: raw.projectId ? String(raw.projectId) : raw.project_id ? String(raw.project_id) : undefined,
    status: raw.status ? String(raw.status) : undefined,
  };
}

/** Postgres/API only — Inventory module runs in local backend mode. */
async function fetchWarehouseAccountRows(options?: {
  includeDisabled?: boolean;
}): Promise<WarehouseAccountRow[]> {
  const includeDisabled = options?.includeDisabled === true;
  const is127Leaf = (account: WarehouseAccountRow) => {
    const code = String(account.accountCode || '').trim();
    return code.startsWith('127') && code.length === 8;
  };
  const sortRows = (rows: WarehouseAccountRow[]) =>
    rows
      .filter((a) => (includeDisabled ? is127Leaf(a) : isWarehouseAccountRow(a)))
      .sort((a, b) =>
        String(a.accountCode).localeCompare(String(b.accountCode), undefined, { numeric: true }),
      );

  const rows = await chartOfAccountsApi.list();
  return sortRows(
    (rows as Record<string, unknown>[]).map(mapCoaRowToWarehouseAccount),
  );
}

async function loadProjectRowsForInventory(): Promise<ProjectRow[]> {
  const localRows = await projectsApi.list();
  const byId = new Map<string, ProjectRow>();
  if (Array.isArray(localRows)) {
    for (const raw of localRows) {
      const row = normalizeProjectRow(raw as ProjectRow & { isDeleted?: boolean });
      if (row) byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) =>
    String(a.projectCode || '').localeCompare(String(b.projectCode || ''), undefined, { numeric: true }),
  );
}

function normalizeProjectRow(raw: ProjectRow & { isDeleted?: boolean }): ProjectRow | null {
  if (raw.isDeleted === true || !raw.id) return null;
  return {
    id: raw.id,
    projectName: String(raw.projectName || ''),
    projectCode: raw.projectCode ? String(raw.projectCode) : undefined,
    inventoryAccountCode: raw.inventoryAccountCode ? String(raw.inventoryAccountCode) : undefined,
  };
}

function normalizeContractRow(raw: Contract & { isDeleted?: boolean }): Contract | null {
  if (raw.isDeleted === true || !raw.id) return null;
  const projectId = String(raw.projectId || '').trim();
  if (!projectId) return null;
  return {
    id: raw.id,
    contractName: String(raw.contractName || ''),
    contractNumber: String(raw.contractNumber || ''),
    projectId,
  };
}

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

/** Postgres/API only — contracts for inventory pickers. */
async function loadContractRowsForInventory(): Promise<Contract[]> {
  const localRows = await contractsApi.list();
  const byId = new Map<string, Contract>();
  if (Array.isArray(localRows)) {
    for (const raw of localRows) {
      const row = normalizeContractRow(raw as Contract & { isDeleted?: boolean });
      if (row) byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) =>
    String(a.contractNumber || '').localeCompare(String(b.contractNumber || ''), undefined, { numeric: true }),
  );
}

interface TransferLine {
  id: number;
  inventoryItemId: number;
  itemDescription: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

interface InventoryTransfer {
  id: number;
  transferNumber: string;
  transferDate: string;
  fromContractId: string;
  fromContractName?: string;
  fromContractNumber?: string;
  fromProjectName?: string;
  toContractId: string;
  toContractName?: string;
  toContractNumber?: string;
  toProjectName?: string;
  status: 'pending_b' | 'rejected_b' | 'pending_projects' | 'rejected_projects' | 'approved' | 'cancelled';
  createdBy: string;
  notes?: string;
  createdAt: string;
  lines: TransferLine[];
}

interface ProjectTransferLine {
  id: number;
  projectInventoryId: number;
  materialCategoryId: number;
  itemDescription?: string;
  materialName?: string;
  materialCode?: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

interface ProjectInventoryTransfer {
  id: number;
  transferNumber: string;
  transferDate: string;
  fromProjectId: string;
  fromProjectName?: string;
  fromProjectCode?: string;
  toProjectId: string;
  toProjectName?: string;
  toProjectCode?: string;
  status: InventoryTransfer['status'];
  createdBy: string;
  notes?: string;
  createdAt: string;
  lines: ProjectTransferLine[];
}

interface Contract {
  id: string;
  contractName: string;
  contractNumber: string;
  projectId: string;
}

interface ProjectRow {
  id: string;
  projectName: string;
  projectCode?: string;
  inventoryAccountCode?: string;
}

interface WarehouseAccountRow {
  id: string;
  accountCode: string;
  accountName: string;
  accountNameEn?: string;
  projectId?: string;
  status?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);

/** Projects reachable via at least one assigned contract; null = unrestricted (admin / PM). */
function accessibleProjectIdsFromContracts(
  contracts: Contract[],
  myContractIds: string[] | null,
  projects: ProjectRow[] = [],
): Set<string> | null {
  if (myContractIds === null) return null;
  const codeToId = new Map(
    projects
      .map((p) => [String(p.projectCode || '').trim(), p.id] as const)
      .filter(([code]) => code.length > 0),
  );
  const idToCode = new Map(
    projects.map((p) => [p.id, String(p.projectCode || '').trim()] as const),
  );
  const ids = new Set<string>();
  for (const c of contracts) {
    if (!myContractIds.includes(c.id)) continue;
    const pid = String(c.projectId || '').trim();
    if (!pid) continue;
    ids.add(pid);
    const resolvedId = codeToId.get(pid);
    if (resolvedId) ids.add(resolvedId);
    const codeForId = idToCode.get(pid);
    if (codeForId) ids.add(codeForId);
  }
  return ids;
}

function projectMatchesScope(project: ProjectRow, scopedIds: Set<string>): boolean {
  if (scopedIds.has(project.id)) return true;
  const code = String(project.projectCode || '').trim();
  return code.length > 0 && scopedIds.has(code);
}

function contractsForAccessibleProjects(
  contracts: Contract[],
  accessibleProjectIds: Set<string> | null,
  projects: ProjectRow[] = [],
): Contract[] {
  if (accessibleProjectIds === null) return contracts;
  return contracts.filter((c) => {
    const pid = String(c.projectId || '').trim();
    if (accessibleProjectIds.has(pid)) return true;
    const project = projects.find((p) => p.id === pid || String(p.projectCode || '').trim() === pid);
    if (!project) return false;
    return projectMatchesScope(project, accessibleProjectIds);
  });
}

function fmtMoney(n: number) {
  return formatMoneyLib(n);
}

/** Coerce any API response to InventoryItem[]. */
function asInventoryItems(data: unknown): InventoryItem[] {
  if (Array.isArray(data)) return data as InventoryItem[];
  if (data && typeof data === 'object' && 'items' in data && Array.isArray((data as { items: unknown }).items))
    return (data as { items: InventoryItem[] }).items;
  return [];
}

/** Coerce any API response to InventoryTransfer[]. */
function asInventoryTransfers(data: unknown): InventoryTransfer[] {
  if (Array.isArray(data)) return data as InventoryTransfer[];
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    for (const k of ['items', 'transfers', 'data']) {
      if (Array.isArray(o[k])) return o[k] as InventoryTransfer[];
    }
  }
  return [];
}

function asProjectInventoryTransfers(data: unknown): ProjectInventoryTransfer[] {
  if (Array.isArray(data)) return data as ProjectInventoryTransfer[];
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    for (const k of ['items', 'transfers', 'data']) {
      if (Array.isArray(o[k])) return o[k] as ProjectInventoryTransfer[];
    }
  }
  return [];
}

function projectInventoryItemLabel(item: ProjectInventoryItem, ar: boolean): string {
  const code = item.materialCode ? `${item.materialCode} — ` : '';
  const name = item.materialName || item.itemDescription || (ar ? 'صنف' : 'Item');
  return `${code}${name}`;
}

// ─── Theme helpers ────────────────────────────────────────────────────────────

import type { AppTheme } from '../lib/shellTheme';
type Theme = AppTheme;

function pageBg(theme: Theme) {
  return theme === 'dark' ? 'bg-gray-950 text-gray-100'
    : theme === 'soft' ? 'bg-[#dde3e8] text-gray-900'
    : 'bg-gray-50 text-gray-900';
}
function cardBg(theme: Theme) {
  return theme === 'dark' ? 'bg-gray-900 border-gray-700'
    : theme === 'soft' ? 'bg-white/80 border-gray-200'
    : 'bg-white border-gray-200';
}
function headerBg(theme: Theme) {
  return theme === 'dark' ? 'bg-gray-900 border-gray-700'
    : theme === 'soft' ? 'bg-white/70 border-gray-200'
    : 'bg-white border-gray-200';
}
function tableTh(theme: Theme) {
  return theme === 'dark' ? 'bg-gray-800 text-gray-300'
    : theme === 'soft' ? 'bg-gray-100 text-gray-600'
    : 'bg-gray-50 text-gray-600';
}
function tableRowHover(theme: Theme) {
  return theme === 'dark' ? 'hover:bg-gray-800/60' : 'hover:bg-gray-50';
}
function inputCls(theme: Theme) {
  return cn(
    'w-full border rounded-lg px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-blue-500',
    theme === 'dark'
      ? 'bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500'
      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400',
  );
}
function btnGhost(theme: Theme) {
  return cn(
    'p-2 rounded-lg border transition-colors',
    theme === 'dark'
      ? 'border-gray-600 hover:bg-gray-700 text-gray-300'
      : 'border-gray-300 hover:bg-gray-100 text-gray-600',
  );
}
function splitSidebarCls(theme: Theme) {
  return cn(
    'rounded-xl border p-4 w-full md:flex-[2] md:min-w-[17rem] md:max-w-[24rem] shrink-0 space-y-4 md:sticky md:top-4 order-1 md:order-none',
    cardBg(theme),
  );
}
function splitMainCls() {
  return 'flex-1 min-w-0 md:flex-[3] space-y-4 order-2 md:order-none';
}
function splitRowCls(dir: string) {
  return cn('flex flex-col md:flex-row md:items-start gap-4', dir === 'rtl' ? 'md:flex-row-reverse' : '');
}
function splitSelectCls(theme: Theme) {
  return cn(
    'w-full rounded-lg border px-3 py-2 text-sm font-bold outline-none focus:border-blue-500 transition-colors',
    theme === 'dark' ? 'bg-gray-900 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-900',
  );
}
function splitLabelCls(theme: Theme) {
  return cn('block text-xs font-bold mb-1.5', theme === 'dark' ? 'text-gray-400' : 'text-gray-500');
}
function splitSectionTitleCls() {
  return 'text-xs font-bold uppercase tracking-wide text-gray-500';
}
function splitActiveListBtn(active: boolean, theme: Theme) {
  return cn(
    'w-full text-start px-2.5 py-1 rounded-lg text-sm border transition-colors',
    active
      ? 'bg-blue-600 text-white border-blue-600'
      : theme === 'dark'
        ? 'text-gray-300 border-gray-800 hover:bg-gray-800'
        : 'text-gray-700 border-gray-200 hover:bg-gray-50',
  );
}
function splitEmptyPaneCls(theme: Theme) {
  return cn('border rounded-xl p-12 text-center', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white');
}
function modalOverlay() { return 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'; }
function modalCard(theme: Theme) {
  return cn(
    'rounded-xl shadow-2xl w-full p-6',
    theme === 'dark' ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900',
  );
}

// ─── Status labels ────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { ar: string; en: string; color: string }> = {
  pending_b:        { ar: 'بانتظار الوجهة',    en: 'Awaiting Destination', color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/30' },
  rejected_b:       { ar: 'مرفوض من الوجهة',   en: 'Rejected by Dest.',    color: 'text-red-600 bg-red-50 dark:bg-red-900/30' },
  pending_projects: { ar: 'بانتظار المشاريع',  en: 'Awaiting PM',          color: 'text-orange-600 bg-orange-50 dark:bg-orange-900/30' },
  rejected_projects:{ ar: 'مرفوض من المشاريع', en: 'Rejected by PM',       color: 'text-red-700 bg-red-50 dark:bg-red-900/30' },
  approved:         { ar: 'معتمد',              en: 'Approved',             color: 'text-green-600 bg-green-50 dark:bg-green-900/30' },
  cancelled:        { ar: 'ملغى',               en: 'Cancelled',            color: 'text-gray-500 bg-gray-100 dark:bg-gray-700' },
};

// ─── Consume Modal ────────────────────────────────────────────────────────────

function ConsumeModal({ item, contractId, contractLabel, projectLabel, onClose, onSaved }: {
  item: ProjectInventoryItem;
  contractId: string;
  contractLabel: string;
  projectLabel?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const preselected: ProjectInventoryItemForConsume = {
    id: item.id,
    projectId: item.projectId,
    materialCategoryId: item.materialCategoryId,
    materialCode: item.materialCode,
    materialName: item.materialName,
    itemDescription: item.itemDescription,
    unit: item.unit,
    quantityAvailable: item.quantityAvailable,
  };
  return (
    <ConsumptionOrderModal
      projectId={item.projectId}
      contractId={contractId}
      contractLabel={contractLabel}
      projectLabel={projectLabel}
      preselectedItem={preselected}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

// ─── Project transfer modal ───────────────────────────────────────────────────

function ProjectTransferModal({
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

// ─── Tab 1: مخزن المشروع ──────────────────────────────────────────────────────

function InventoryBalance({ contracts, contractsLoading, myContractIds, onRefreshNeeded }: {
  contracts: Contract[]; contractsLoading: boolean; myContractIds: string[] | null; onRefreshNeeded: () => void;
}) {
  const { language, theme, t, dir } = useLanguage();
  const ar = language === 'ar';
  const { isAdmin, role, can } = usePermissions();
  const canImportOpening =
    isLocalBackend && (isAdmin || role === 'projects_manager' || can('inventory').create);
  const moneyLocale = 'en-US';
  const formatMoneyPrint = (value: number) => formatMoneyLib(value, moneyLocale);
  const [companyInfo, setCompanyInfo] = useState<CompanyPrintInfo>({
    companyName: '',
    companyNameEn: '',
    headerLogo: '',
  });
  const { openDocPreview, ReportPreviewHost } = useReportDocumentPreview({
    language,
    t,
    formatMoney: formatMoneyPrint,
    companyInfo,
  });
  const [selectedForPrint, setSelectedForPrint] = useState<Set<number>>(new Set());
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [items, setItems] = useState<ProjectInventoryItem[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedContract, setSelectedContract] = useState('');
  const [loading, setLoading] = useState(false);
  const [warehouseAccounts, setWarehouseAccounts] = useState<WarehouseAccountRow[]>([]);
  const [warehouseActionLoading, setWarehouseActionLoading] = useState(false);
  const [selectedWarehouseAccountId, setSelectedWarehouseAccountId] = useState('');
  const [consumeTarget, setConsumeTarget] = useState<ProjectInventoryItem | null>(null);
  const [orderTarget, setOrderTarget] = useState<{
    projectId: string;
    projectLabel: string;
    contractId: string;
    contractLabel: string;
  } | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState<number | null>(null);
  const [showUnlinkedReport, setShowUnlinkedReport] = useState(false);
  const [openingImportDate, setOpeningImportDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [openingImportLoading, setOpeningImportLoading] = useState(false);
  const openingImportInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSelectedMaterialId(null);
  }, [selectedProject, selectedContract]);

  const accessibleProjectIds = useMemo(
    () => accessibleProjectIdsFromContracts(contracts, myContractIds, projects),
    [contracts, myContractIds, projects],
  );

  const scopedProjectIds = useMemo(
    () => accessibleProjectIds ?? new Set(contracts.map((c) => c.projectId)),
    [accessibleProjectIds, contracts],
  );

  const filteredProjects = useMemo(() => {
    if (accessibleProjectIds === null) return projects;
    if (contractsLoading) return [];
    return projects.filter((p) => projectMatchesScope(p, scopedProjectIds));
  }, [projects, scopedProjectIds, accessibleProjectIds, contractsLoading]);

  const projectsLoadBlocked = myContractIds !== null && contractsLoading;

  /** Any contract in the selected project (consumption may post to all project contracts). */
  const contractsForProject = useMemo(() => {
    if (!selectedProject) return [];
    const projectCode = String(
      filteredProjects.find((p) => p.id === selectedProject)?.projectCode || ''
    ).trim();
    return contracts.filter((c) => {
      const pid = String(c.projectId || '').trim();
      return pid === selectedProject || (!!projectCode && pid === projectCode);
    });
  }, [contracts, selectedProject, filteredProjects]);

  useEffect(() => {
    void loadProjectRowsForInventory()
      .then(setProjects)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : '';
        toast.error(
          ar
            ? `فشل تحميل المشاريع${msg ? `: ${msg}` : ''}`
            : `Failed to load projects${msg ? `: ${msg}` : ''}`,
        );
      });
  }, [ar]);

  const loadWarehouseAccounts = useCallback(async () => {
    setWarehouseAccounts(await fetchWarehouseAccountRows());
  }, []);

  useEffect(() => {
    void loadWarehouseAccounts().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : '';
      toast.error(
        ar
          ? `فشل تحميل حسابات المخازن${msg ? `: ${msg}` : ''}`
          : `Failed to load warehouse accounts${msg ? `: ${msg}` : ''}`,
      );
    });
  }, [loadWarehouseAccounts, ar]);

  const loadInventory = useCallback(async () => {
    if (!selectedProject) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const data = await inventoryApi.projectSummary(selectedProject);
      setItems(asProjectInventoryItems(data));
    } catch {
      toast.error(ar ? 'فشل تحميل مخزن المشروع' : 'Failed to load project warehouse');
    } finally { setLoading(false); }
  }, [selectedProject, ar]);

  useEffect(() => { void loadInventory(); }, [loadInventory]);

  useEffect(() => {
    setSelectedContract('');
    setSelectedForPrint(new Set());
  }, [selectedProject]);

  useEffect(() => {
    void settingsApi.getCompanyInfo()
      .then((res) => {
        if (res.value) setCompanyInfo((prev) => ({ ...prev, ...res.value }));
      })
      .catch(() => undefined);
  }, []);

  const inventoryRows = items;
  const totalValue = useMemo(
    () => inventoryRows.reduce((s, i) => s + Number(i.quantityBalance ?? 0) * projectInventoryUnitCost(i), 0),
    [inventoryRows]
  );

  const selectedItem = useMemo(
    () => inventoryRows.find((row) => row.id === selectedMaterialId) ?? null,
    [inventoryRows, selectedMaterialId],
  );

  const selectedProjectLabel = filteredProjects.find((p) => p.id === selectedProject)?.projectName || selectedProject;
  const selectedProjectRow = filteredProjects.find((p) => p.id === selectedProject);
  const selectedContractRow = contractsForProject.find((c) => c.id === selectedContract);
  const linkedWarehouseAccount = useMemo(() => {
    if (!selectedProject) return undefined;
    return warehouseAccountForProject(warehouseAccounts, selectedProject, selectedProjectRow);
  }, [selectedProject, selectedProjectRow, warehouseAccounts]);
  const selectableWarehouseAccounts = useMemo(
    () =>
      warehouseAccounts.filter((a) => {
        const linkedProjectId = String(a.projectId || '').trim();
        return !linkedProjectId || linkedProjectId === selectedProject;
      }),
    [warehouseAccounts, selectedProject]
  );

  useEffect(() => {
    setSelectedWarehouseAccountId(linkedWarehouseAccount?.id || '');
  }, [linkedWarehouseAccount?.id]);

  const refreshProjects = useCallback(async () => {
    const data = await loadProjectRowsForInventory();
    setProjects(data);
  }, []);

  const handleCreateAndLinkWarehouse = async () => {
    if (!selectedProject || !selectedProjectRow) {
      toast.error(ar ? 'اختر المشروع أولاً' : 'Select a project first');
      return;
    }
    if (linkedWarehouseAccount) {
      toast.error(ar ? 'المشروع مرتبط بالفعل بمخزن — احذف الربط أولاً' : 'Project already has a warehouse — remove it first');
      return;
    }

    setWarehouseActionLoading(true);
    try {
      const accountCode = nextWarehouseAccountCode(warehouseAccounts);
      const accountName = `مخزون مشروع - ${selectedProjectRow.projectName}`;
      const accountPayload = {
        accountCode,
        accountName,
        accountNameEn: `Project Inventory - ${selectedProjectRow.projectName}`,
        parentCode: '127',
        type: 'asset',
        isGroup: false,
        status: 'active' as const,
        statementType: 'balance_sheet',
        projectId: selectedProject,
      };

      const created = await chartOfAccountsApi.create(accountPayload) as Record<string, unknown>;
      await projectsApi.update(selectedProject, {
        inventoryAccountCode: accountCode,
      });
      setWarehouseAccounts((prev) =>
        [...prev, mapCoaRowToWarehouseAccount({ ...created, id: created.id ?? created.accountCode })]
          .sort((a, b) => String(a.accountCode).localeCompare(String(b.accountCode), undefined, { numeric: true }))
      );
      setSelectedWarehouseAccountId(String(created.id ?? accountCode));

      await refreshProjects().catch(() => undefined);
      toast.success(ar ? 'تم إنشاء وربط مخزن المشروع' : 'Project warehouse created and linked');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : ar ? 'فشل إنشاء مخزن المشروع' : 'Failed to create project warehouse');
    } finally {
      setWarehouseActionLoading(false);
    }
  };

  const handleLinkExistingWarehouse = async () => {
    if (!selectedProject || !selectedWarehouseAccountId) {
      toast.error(ar ? 'اختر المشروع وحساب المخزن' : 'Select project and warehouse account');
      return;
    }
    const account = warehouseAccounts.find((a) => a.id === selectedWarehouseAccountId);
    if (!account) return;

    setWarehouseActionLoading(true);
    try {
      if (linkedWarehouseAccount && linkedWarehouseAccount.id !== account.id) {
        await chartOfAccountsApi.update(linkedWarehouseAccount.id, { projectId: '' });
      }
      await chartOfAccountsApi.update(account.id, {
        projectId: selectedProject,
        status: 'active',
      });
      await projectsApi.update(selectedProject, { inventoryAccountCode: account.accountCode });
      setWarehouseAccounts((prev) =>
        prev.map((a) => {
          if (linkedWarehouseAccount && a.id === linkedWarehouseAccount.id) return { ...a, projectId: '' };
          if (a.id === account.id) return { ...a, projectId: selectedProject, status: 'active' };
          return a;
        })
      );
      setSelectedWarehouseAccountId(account.id);
      await refreshProjects().catch(() => undefined);
      toast.success(ar ? 'تم ربط المخزن بالمشروع' : 'Warehouse linked to project');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : ar ? 'فشل ربط المخزن' : 'Failed to link warehouse');
    } finally {
      setWarehouseActionLoading(false);
    }
  };

  const togglePrintSelection = (id: number) => {
    setSelectedForPrint((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePrintWarehouse = () => {
    if (!selectedProject || inventoryRows.length === 0) return;
    const rowsToPrint = selectedForPrint.size > 0
      ? inventoryRows.filter((row) => selectedForPrint.has(row.id))
      : inventoryRows;
    const printRows: InventoryPrintRow[] = rowsToPrint.map((item) => {
      const unitCost = projectInventoryUnitCost(item);
      const balance = Number(item.quantityBalance ?? 0);
      return {
        id: item.id,
        label: projectInventoryLabel(item),
        unit: item.unit,
        quantityIn: Number(item.quantityIn ?? 0),
        quantityIssued: Number(item.quantityIssued ?? 0),
        quantityReturned: Number(item.quantityReturned ?? 0),
        quantityBalance: balance,
        quantityReserved: Number(item.quantityReserved ?? 0),
        quantityAvailable: Number(item.quantityAvailable ?? 0),
        unitCost,
        totalValue: balance * unitCost,
      };
    });
    const totalPrintValue = printRows.reduce((sum, row) => sum + row.totalValue, 0);
    const warehouseLabel = linkedWarehouseAccount
      ? `${linkedWarehouseAccount.accountCode} — ${
          ar
            ? linkedWarehouseAccount.accountName
            : linkedWarehouseAccount.accountNameEn || linkedWarehouseAccount.accountName
        }`
      : undefined;
    const fq = (value: number) => formatQuantity(value, language);
    const scopeParts = [
      ar ? `مشروع: ${selectedProjectRow?.projectName || selectedProjectLabel}` : `Project: ${selectedProjectRow?.projectName || selectedProjectLabel}`,
      warehouseLabel ? (ar ? `مخزن: ${warehouseLabel}` : `Warehouse: ${warehouseLabel}`) : '',
      selectedForPrint.size > 0 ? (ar ? `${printRows.length} صنف` : `${printRows.length} items`) : '',
    ].filter(Boolean);
    openDocPreview({
      reportId: 'inventory_warehouse',
      title: ar ? 'تقرير مخزن المشروع' : 'Project Warehouse Report',
      scopeLabel: scopeParts.join(' · '),
      dateLabel: new Date().toLocaleDateString(moneyLocale),
      columns: [
        { key: 'label', header: ar ? 'الصنف' : 'Material', width: 22 },
        { key: 'unit', header: ar ? 'الوحدة' : 'Unit', width: 7, align: 'center' },
        { key: 'quantityIn', header: ar ? 'وارد' : 'In', width: 9, numeric: true },
        { key: 'quantityIssued', header: ar ? 'منصرف' : 'Issued', width: 9, numeric: true },
        { key: 'quantityReturned', header: ar ? 'مرتجع' : 'Returned', width: 9, numeric: true },
        { key: 'quantityBalance', header: ar ? 'الرصيد' : 'Balance', width: 9, numeric: true },
        { key: 'quantityAvailable', header: ar ? 'متاح' : 'Available', width: 9, numeric: true },
        { key: 'unitCost', header: ar ? 'متوسط التكلفة' : 'Avg cost', width: 12, money: true },
        { key: 'totalValue', header: ar ? 'قيمة الرصيد' : 'Balance value', width: 14, money: true },
      ],
      rows: printRows.map((row) => ({
        label: row.label,
        unit: row.unit,
        quantityIn: fq(row.quantityIn),
        quantityIssued: fq(row.quantityIssued),
        quantityReturned: fq(row.quantityReturned),
        quantityBalance: fq(row.quantityBalance),
        quantityAvailable: fq(row.quantityAvailable),
        unitCost: row.unitCost,
        totalValue: row.totalValue,
      })),
      totals: { totalValue: totalPrintValue },
      totalsLabel: ar ? 'إجمالي قيمة المخزون' : 'Total inventory value',
      filename: `warehouse-${selectedProjectRow?.projectCode || selectedProject}`,
    });
  };

  const handleDeleteLinkedWarehouse = async () => {
    if (!selectedProject || !linkedWarehouseAccount) {
      toast.error(ar ? 'لا يوجد مخزن مربوط لحذفه' : 'No linked warehouse to delete');
      return;
    }
    const ok = window.confirm(
      ar
        ? 'سيتم فك ربط حساب المخزن من المشروع فقط (الحساب يبقى نشطاً في شجرة الحسابات). لن يتم حذف حركات أو أرصدة المخزون. هل تريد المتابعة؟'
        : 'This will unlink the warehouse account from the project (the account stays active in the chart). Inventory balances and movements will not be deleted. Continue?'
    );
    if (!ok) return;

    setWarehouseActionLoading(true);
    try {
      await chartOfAccountsApi.update(linkedWarehouseAccount.id, {
        projectId: '',
      });
      await projectsApi.update(selectedProject, { inventoryAccountCode: '' });
      setWarehouseAccounts((prev) =>
        prev.map((a) =>
          a.id === linkedWarehouseAccount.id ? { ...a, projectId: '' } : a,
        ),
      );
      setSelectedWarehouseAccountId('');
      await refreshProjects().catch(() => undefined);
      toast.success(ar ? 'تم فك ربط مخزن المشروع' : 'Project warehouse unlinked');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : ar ? 'فشل حذف المخزن' : 'Failed to delete warehouse');
    } finally {
      setWarehouseActionLoading(false);
    }
  };

  const handleOpeningTemplate = () => {
    exportOpeningInventoryTemplate(language === 'ar' ? 'ar' : 'en');
  };

  const handleOpeningImportFile = async (file: File | null) => {
    if (!file) return;
    if (!selectedProject) {
      toast.error(t('inventory_opening_need_project'));
      return;
    }
    if (!linkedWarehouseAccount) {
      toast.error(t('inventory_opening_need_warehouse'));
      return;
    }
    setOpeningImportLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseOpeningInventoryFile(buffer);
      if (parsed.length === 0) {
        toast.error(t('inventory_opening_empty_file'));
        return;
      }
      const result = await inventoryApi.importOpeningBalances(selectedProject, {
        date: openingImportDate,
        rows: parsed.map((r) => ({
          materialCategoryCode: r.materialCategoryCode,
          quantity: r.quantity,
          avgUnitCost: r.avgUnitCost,
        })),
      });
      await loadInventory();
      onRefreshNeeded();
      const summary = t('inventory_opening_result')
        .replace('{imported}', String(result.imported))
        .replace('{skipped}', String(result.skipped));
      if (result.imported > 0) {
        toast.success(
          result.reference
            ? `${t('inventory_opening_success')} — ${summary} — ${t('inventory_opening_gl_ref').replace('{reference}', result.reference)}`
            : `${t('inventory_opening_success')} — ${summary}`,
        );
      } else {
        toast(summary || t('inventory_opening_none'), { icon: 'ℹ️' });
      }
      if (result.errors.length > 0) {
        toast.error(
          `${t('inventory_opening_errors').replace('{count}', String(result.errors.length))}: ${result.errors.slice(0, 3).join(' · ')}`,
        );
      }
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : ar
              ? 'فشل استيراد الأرصدة'
              : 'Failed to import opening balances';
      toast.error(msg);
    } finally {
      setOpeningImportLoading(false);
      if (openingImportInputRef.current) openingImportInputRef.current.value = '';
    }
  };

  return (
    <>
    <div className={splitRowCls(dir)}>
      <div className={splitMainCls()}>
        {loading ? (
          <div className={cn('flex items-center justify-center py-16 gap-2', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
            <Loader2 className="w-6 h-6 animate-spin" />{ar ? 'جاري التحميل...' : 'Loading...'}
          </div>
        ) : !selectedProject ? (
          <div className={splitEmptyPaneCls(theme)}>
            <Package className="w-14 h-14 mx-auto mb-3 opacity-25" />
            <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>
              {ar ? 'اختر مشروعاً من القائمة لعرض مخزنه' : 'Select a project from the list to view its warehouse'}
            </p>
          </div>
        ) : inventoryRows.length === 0 ? (
          <div>
            <InventorySetupGuide theme={theme} />
            <div className={splitEmptyPaneCls(theme)}>
              <Package className="w-14 h-14 mx-auto mb-3 opacity-25" />
              <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>
                {ar
                  ? 'لا يوجد مخزون مشروع بعد — سجّل فاتورة مشتريات أو استورد أرصدة افتتاحية'
                  : 'No project warehouse stock yet — post a purchase invoice or import opening balances'}
              </p>
            </div>
          </div>
        ) : !selectedItem ? (
          <div className={splitEmptyPaneCls(theme)}>
            <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{t('inventory_filter_select_record')}</p>
          </div>
        ) : (
          <>
            <div
              className={cn(
                'rounded-xl border p-4 flex flex-col gap-3',
                theme === 'dark' ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-white'
              )}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <div>
                    <p className={cn('text-sm font-bold', theme === 'dark' ? 'text-gray-100' : 'text-gray-800')}>
                      {ar ? 'حساب مخزن المشروع' : 'Project Warehouse Account'}
                    </p>
                    <p className={cn('text-xs mt-1', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
                      {linkedWarehouseAccount
                        ? `${linkedWarehouseAccount.accountCode} — ${
                            ar
                              ? linkedWarehouseAccount.accountName
                              : linkedWarehouseAccount.accountNameEn || linkedWarehouseAccount.accountName
                          }`
                        : ar
                          ? 'لا يوجد حساب مخزن مربوط بهذا المشروع بعد.'
                          : 'No warehouse account is linked to this project yet.'}
                    </p>
                  </div>
                  <ManualHelpButton topicId="inventory.receipt.purchase" size={14} />
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={selectedWarehouseAccountId}
                  onChange={(e) => setSelectedWarehouseAccountId(e.target.value)}
                  title={ar ? 'اختيار حساب المخزن من شجرة الحسابات' : 'Select warehouse account from chart of accounts'}
                  aria-label={ar ? 'اختيار حساب المخزن من شجرة الحسابات' : 'Select warehouse account from chart of accounts'}
                  className={cn(inputCls(theme), 'min-w-72')}
                >
                  <option value="">
                    {ar ? '— اختر حساب مخزن من شجرة الحسابات —' : '— Select warehouse account from COA —'}
                  </option>
                  {selectableWarehouseAccounts.map((a, ai) => (
                    <option key={compositeListKey(a.accountCode, a.id, ai, 'wh-coa')} value={a.id || a.accountCode}>
                      {a.accountCode} — {ar ? a.accountName : a.accountNameEn || a.accountName}
                      {String(a.projectId || '').trim() === selectedProject ? (ar ? ' (مربوط حالياً)' : ' (linked)') : ''}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleCreateAndLinkWarehouse}
                  disabled={warehouseActionLoading || !!linkedWarehouseAccount}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {warehouseActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {ar ? 'إضافة مخزن' : 'Add Warehouse'}
                </button>

                <button
                  type="button"
                  onClick={handleLinkExistingWarehouse}
                  disabled={warehouseActionLoading || !selectedWarehouseAccountId}
                  className={cn(
                    'px-3 py-2 rounded-lg text-sm border transition-colors disabled:opacity-50',
                    theme === 'dark'
                      ? 'border-gray-600 text-gray-200 hover:bg-gray-800'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  )}
                >
                  {ar ? 'ربط الحساب المختار' : 'Link Selected Account'}
                </button>

                <button
                  type="button"
                  onClick={handleDeleteLinkedWarehouse}
                  disabled={warehouseActionLoading || !linkedWarehouseAccount}
                  className="px-3 py-2 rounded-lg text-sm border border-red-400 text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  {ar ? 'حذف المخزن' : 'Delete Warehouse'}
                </button>
              </div>

              {selectableWarehouseAccounts.length === 0 && (
                <p className="text-[11px] text-amber-500">
                  {ar
                    ? 'لا توجد حسابات مخزن متاحة تحت 127 بكود 8 أرقام. استخدم زر إضافة مخزن لإنشاء حساب جديد.'
                    : 'No available 8-digit warehouse accounts under 127. Use Add Warehouse to create one.'}
                </p>
              )}
            </div>

            <div className={cn('border rounded-xl overflow-hidden', theme === 'dark' ? 'border-gray-700' : 'border-gray-200')}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={cn('text-xs uppercase tracking-wide', tableTh(theme))}>
                    <tr>
                      <th className="p-3 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={selectedForPrint.has(selectedItem.id)}
                          onChange={() => togglePrintSelection(selectedItem.id)}
                          title={ar ? 'تضمين في الطباعة' : 'Include in print'}
                          aria-label={ar ? 'تضمين في الطباعة' : 'Include in print'}
                          className="rounded border-gray-400"
                        />
                      </th>
                      <th className={cn('p-3 font-semibold', ar ? 'text-right' : 'text-left')}>{ar ? 'الصنف' : 'Item'}</th>
                      <th className="p-3 text-center">{ar ? 'الوحدة' : 'Unit'}</th>
                      <th className="p-3 text-center">{ar ? 'وارد' : 'In'}</th>
                      <th className="p-3 text-center text-red-500">{ar ? 'مصروف' : 'Issued'}</th>
                      <th className="p-3 text-center text-blue-500">{ar ? 'مرتجع' : 'Returned'}</th>
                      <th className="p-3 text-center font-bold">{ar ? 'الرصيد' : 'Balance'}</th>
                      <th className="p-3 text-center text-yellow-500">{ar ? 'محجوز' : 'Reserved'}</th>
                      <th className="p-3 text-center text-green-600 font-bold">{ar ? 'متاح' : 'Available'}</th>
                      <th className="p-3 text-center">{ar ? 'سعر الوحدة' : 'Unit Cost'}</th>
                      <th className="p-3 text-center">{ar ? 'القيمة' : 'Value'}</th>
                      <th className="p-3 w-20"></th>
                    </tr>
                  </thead>
                  <tbody className={cn('divide-y', theme === 'dark' ? 'divide-gray-700' : 'divide-gray-100')}>
                    <tr className={cn('transition-colors', tableRowHover(theme))}>
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={selectedForPrint.has(selectedItem.id)}
                          onChange={() => togglePrintSelection(selectedItem.id)}
                          title={ar ? 'تضمين في الطباعة' : 'Include in print'}
                          aria-label={ar ? 'تضمين في الطباعة' : 'Include in print'}
                          className="rounded border-gray-400"
                        />
                      </td>
                      <td className="p-3">
                        <div className="font-medium">{projectInventoryLabel(selectedItem)}</div>
                        {selectedItem.projectName && (
                          <div className={cn('text-xs mt-0.5', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
                            {selectedItem.projectName}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-center">{selectedItem.unit}</td>
                      <td className="p-3 text-center font-mono">{formatQuantity(selectedItem.quantityIn, language)}</td>
                      <td className="p-3 text-center font-mono text-red-500">{formatQuantity(selectedItem.quantityIssued, language)}</td>
                      <td className="p-3 text-center font-mono text-blue-500">{formatQuantity(selectedItem.quantityReturned, language)}</td>
                      <td className="p-3 text-center font-mono font-bold">{formatQuantity(selectedItem.quantityBalance, language)}</td>
                      <td className="p-3 text-center font-mono text-yellow-500">{formatQuantity(selectedItem.quantityReserved, language)}</td>
                      <td className="p-3 text-center font-mono font-bold text-green-600">{formatQuantity(selectedItem.quantityAvailable, language)}</td>
                      <td className="p-3 text-center font-mono">{fmtMoney(projectInventoryUnitCost(selectedItem))}</td>
                      <td className="p-3 text-center font-mono">{fmtMoney(selectedItem.quantityBalance * projectInventoryUnitCost(selectedItem))}</td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => {
                            if (!selectedContract) {
                              toast.error(ar ? 'اختر عقد التحميل أولاً' : 'Select loading contract first');
                              return;
                            }
                            setConsumeTarget(selectedItem);
                          }}
                          disabled={selectedItem.quantityAvailable <= 0 || !selectedContract}
                          title={ar ? 'تسجيل صرف' : 'Record consumption'}
                          className={cn(
                            'px-2 py-1 rounded text-xs font-medium transition-colors disabled:opacity-40',
                            theme === 'dark'
                              ? 'bg-red-900/40 text-red-400 hover:bg-red-900/60'
                              : 'bg-red-50 text-red-700 hover:bg-red-100',
                          )}
                        >
                          {ar ? 'صرف' : 'Issue'}
                        </button>
                      </td>
                    </tr>
                    <tr className={theme === 'dark' ? 'bg-gray-800/40' : 'bg-gray-50/80'}>
                      <td colSpan={12} className={cn('px-6 py-2.5 text-xs', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
                        <span className="font-medium">{ar ? 'معادلة الرصيد:' : 'Balance formula:'}</span>
                        {' '}
                        {formatQuantity(selectedItem.quantityIn, language)} + {formatQuantity(selectedItem.quantityReturned, language)} − {formatQuantity(selectedItem.quantityIssued, language)} − {formatQuantity(selectedItem.quantityReserved, language)} = {formatQuantity(selectedItem.quantityBalance, language)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {selectedProject && (
          <ProjectWarehouseMovements projectId={selectedProject} refreshKey={selectedProject} />
        )}
      </div>

      <aside className={splitSidebarCls(theme)}>
        <div>
          <h3 className="font-bold text-sm">{t('inventory_filter_title')}</h3>
        </div>
        <div className="space-y-3">
          <div>
            <label className={splitLabelCls(theme)}>{t('project')}</label>
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              disabled={projectsLoadBlocked}
              className={splitSelectCls(theme)}
            >
              <option value="">
                {projectsLoadBlocked
                  ? (ar ? '— جاري تحميل العقود —' : '— Loading contracts —')
                  : (ar ? '— اختر المشروع —' : '— Select project —')}
              </option>
              {filteredProjects.map((p, pi) => (
                <option key={listKey(p.id, pi, `inv-proj-${p.projectCode}`)} value={p.id}>
                  {p.projectCode ? `${p.projectCode} — ` : ''}{p.projectName}
                </option>
              ))}
            </select>
            {!projectsLoadBlocked && projects.length > 0 && filteredProjects.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">
                {ar
                  ? 'لا توجد مشاريع ضمن عقودك المسندة.'
                  : 'No projects match your assigned contracts.'}
              </p>
            )}
          </div>
          <div>
            <label className={splitLabelCls(theme)}>{ar ? 'عقد الصرف' : 'Issue-to contract'}</label>
            <select
              value={selectedContract}
              onChange={(e) => setSelectedContract(e.target.value)}
              disabled={!selectedProject}
              className={splitSelectCls(theme)}
            >
              <option value="">{ar ? '— عقد الصرف (BOQ) —' : '— Issue-to contract —'}</option>
              {contractsForProject.map((c, ci) => (
                <option key={listKey(c.id, ci, `inv-contract-${c.contractNumber}`)} value={c.id}>
                  {c.contractNumber} — {c.contractName}
                </option>
              ))}
            </select>
          </div>
          {selectedProject && (
            <p className={cn('text-xs', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
              {t('project_warehouse_account')} · {ar ? 'إجمالي:' : 'Total:'}{' '}
              <span className="font-bold text-blue-600">{fmtMoney(totalValue)} {ar ? 'ج.م' : 'EGP'}</span>
            </p>
          )}
        </div>
        <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
          <div className="flex items-center justify-between gap-2">
            <p className={splitSectionTitleCls()}>{t('inventory_filter_list')}</p>
            <button
              onClick={loadInventory}
              title={ar ? 'تحديث' : 'Refresh'}
              aria-label={ar ? 'تحديث' : 'Refresh'}
              className={btnGhost(theme)}
            >
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
          </div>
          {!selectedProject ? (
            <p className="text-xs text-gray-500">{ar ? 'اختر مشروعاً' : 'Select a project'}</p>
          ) : loading ? (
            <Loader2 className="animate-spin mx-auto" size={18} />
          ) : inventoryRows.length === 0 ? (
            <p className="text-xs text-gray-500">{t('inventory_filter_empty')}</p>
          ) : (
            <ul className="space-y-1 max-h-64 overflow-auto">
              {inventoryRows.map((item, invIdx) => (
                <li key={item.id || `inv-${item.materialCategoryId ?? invIdx}-${invIdx}`}>
                  <button
                    type="button"
                    onClick={() => setSelectedMaterialId(item.id)}
                    className={splitActiveListBtn(selectedMaterialId === item.id, theme)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold truncate">{projectInventoryLabel(item)}</span>
                      <span className="text-xs opacity-80 shrink-0">{formatQuantity(item.quantityAvailable, language)}</span>
                    </div>
                    <p className="text-[10px] opacity-75 mt-0.5">{item.unit}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
          {canImportOpening && selectedProject && (
            <div className="space-y-2">
              <label className={cn('block text-[10px] font-bold', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
                {t('inventory_opening_date')}
              </label>
              <input
                type="date"
                value={openingImportDate}
                onChange={(e) => setOpeningImportDate(e.target.value)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-500',
                  theme === 'dark' ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900',
                )}
              />
              <p className={cn('text-[10px] leading-snug', theme === 'dark' ? 'text-gray-500' : 'text-gray-500')}>
                {t('inventory_opening_hint')}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleOpeningTemplate}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium border transition-colors',
                    theme === 'dark'
                      ? 'border-gray-600 text-gray-200 hover:bg-gray-800'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50',
                  )}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  {t('inventory_opening_template')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!linkedWarehouseAccount) {
                      toast.error(t('inventory_opening_need_warehouse'));
                      return;
                    }
                    openingImportInputRef.current?.click();
                  }}
                  disabled={openingImportLoading || !linkedWarehouseAccount}
                  className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-colors"
                >
                  {openingImportLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {t('inventory_opening_import')}
                </button>
              </div>
              <input
                ref={openingImportInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => void handleOpeningImportFile(e.target.files?.[0] ?? null)}
              />
            </div>
          )}
          {selectedProject && inventoryRows.length > 0 && (
            <button
              type="button"
              onClick={handlePrintWarehouse}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm transition-colors"
            >
              <Printer className="w-4 h-4" />
              {ar ? 'معاينة وطباعة' : 'Preview & Print'}
              {selectedForPrint.size > 0 ? ` (${selectedForPrint.size})` : ''}
            </button>
          )}
          {selectedProject && selectedContract && (
            <button
              type="button"
              onClick={() => {
                const c = selectedContractRow;
                setOrderTarget({
                  projectId: selectedProject,
                  projectLabel: selectedProjectLabel,
                  contractId: selectedContract,
                  contractLabel: c ? `${c.contractNumber} — ${c.contractName}` : selectedContract,
                });
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              {ar ? 'أمر صرف جديد' : 'New consumption order'}
            </button>
          )}
          {selectedProject && selectedContract && (
            <button
              type="button"
              onClick={() => setShowUnlinkedReport(true)}
              className={cn(
                'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors border mt-2',
                theme === 'dark'
                  ? 'border-amber-500/30 text-amber-400 hover:bg-amber-500/10'
                  : 'border-amber-500 text-amber-700 hover:bg-amber-50'
              )}
            >
              <AlertTriangle className="w-4 h-4" />
              {ar ? 'تقرير الربط' : 'Linking report'}
            </button>
          )}
          <div className="flex items-center gap-2">
            {selectedProject && <ManualHelpButton topicId="inventory.boq.link" size={14} />}
            {selectedProject && selectedContract && (
              <ManualHelpButton topicId="inventory.consumption.issue" size={16} />
            )}
          </div>
        </div>
      </aside>
    </div>

      {consumeTarget && selectedContract && (
        <ConsumeModal
          item={consumeTarget}
          contractId={selectedContract}
          contractLabel={selectedContractRow ? `${selectedContractRow.contractNumber} — ${selectedContractRow.contractName}` : selectedContract}
          projectLabel={selectedProjectLabel}
          onClose={() => setConsumeTarget(null)}
          onSaved={() => { void loadInventory(); onRefreshNeeded(); }}
        />
      )}

      {orderTarget && (
        <ConsumptionOrderModal
          projectId={orderTarget.projectId}
          contractId={orderTarget.contractId}
          projectLabel={orderTarget.projectLabel}
          contractLabel={orderTarget.contractLabel}
          onClose={() => setOrderTarget(null)}
          onSaved={() => {
            void loadInventory();
            onRefreshNeeded();
            setOrderTarget(null);
          }}
        />
      )}

      {showUnlinkedReport && selectedContract && (
        <UnlinkedMaterialsReport
          contractId={selectedContract}
          contractLabel={selectedContractRow ? `${selectedContractRow.contractNumber} — ${selectedContractRow.contractName}` : selectedContract}
          onClose={() => setShowUnlinkedReport(false)}
        />
      )}
      {ReportPreviewHost}
    </>
  );
}

const MOVEMENT_TYPE_LABELS: Record<
  ProjectInventoryMovement['movementType'],
  { ar: string; en: string }
> = {
  receipt: { ar: 'وارد', en: 'Receipt' },
  issue: { ar: 'صرف', en: 'Issue' },
  return: { ar: 'مرتجع', en: 'Return' },
  reserve: { ar: 'حجز', en: 'Reserve' },
  release: { ar: 'إلغاء حجز', en: 'Release' },
};

function ProjectWarehouseMovements({ projectId, refreshKey }: { projectId: string; refreshKey: string }) {
  const { language, theme } = useLanguage();
  const ar = language === 'ar';
  const [movements, setMovements] = useState<ProjectInventoryMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await inventoryApi.projectMovements(projectId);
      setMovements(data.movements ?? []);
    } catch {
      toast.error(ar ? 'فشل تحميل حركات المخزن' : 'Failed to load warehouse movements');
    } finally {
      setLoading(false);
    }
  }, [projectId, ar]);

  useEffect(() => {
    if (expanded) void load();
  }, [expanded, load, refreshKey]);

  return (
    <div className={cn('mt-6 border rounded-xl overflow-hidden', theme === 'dark' ? 'border-gray-700' : 'border-gray-200')}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'w-full flex items-center justify-between px-4 py-3 text-sm font-semibold transition-colors',
          theme === 'dark' ? 'bg-gray-800 hover:bg-gray-750' : 'bg-gray-50 hover:bg-gray-100',
        )}
      >
        <span>{ar ? 'تقرير حركة مخزن المشروع' : 'Project warehouse movement report'}</span>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {expanded && (
        <div className="p-4">
          <div className="flex justify-end mb-2">
            <button type="button" onClick={() => void load()} className={btnGhost(theme)} title={ar ? 'تحديث' : 'Refresh'} aria-label={ar ? 'تحديث' : 'Refresh'}>
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
          </div>
          {loading ? (
            <div className={cn('flex items-center gap-2 py-6 text-sm', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
              <Loader2 className="w-4 h-4 animate-spin" />
              {ar ? 'جاري التحميل...' : 'Loading...'}
            </div>
          ) : movements.length === 0 ? (
            <p className={cn('text-sm py-4 text-center', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
              {ar ? 'لا توجد حركات مسجّلة بعد' : 'No movements recorded yet'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className={tableTh(theme)}>
                  <tr>
                    <th className="p-2">{ar ? 'التاريخ' : 'Date'}</th>
                    <th className={cn('p-2', ar ? 'text-right' : 'text-left')}>{ar ? 'الصنف' : 'Item'}</th>
                    <th className="p-2 text-center">{ar ? 'النوع' : 'Type'}</th>
                    <th className="p-2 text-center">{ar ? 'الكمية' : 'Qty'}</th>
                    <th className="p-2 text-center">{ar ? 'التكلفة' : 'Unit cost'}</th>
                    <th className="p-2">{ar ? 'المرجع' : 'Reference'}</th>
                  </tr>
                </thead>
                <tbody className={cn('divide-y', theme === 'dark' ? 'divide-gray-700' : 'divide-gray-100')}>
                  {movements.map((m) => {
                    const typeLabel = MOVEMENT_TYPE_LABELS[m.movementType] ?? { ar: m.movementType, en: m.movementType };
                    return (
                      <tr key={m.id}>
                        <td className="p-2 font-mono whitespace-nowrap">{m.createdAt?.slice(0, 16) ?? '—'}</td>
                        <td className="p-2">{m.materialName || m.materialCode || '—'}</td>
                        <td className="p-2 text-center">{ar ? typeLabel.ar : typeLabel.en}</td>
                        <td className="p-2 text-center font-mono">{formatQuantity(m.quantity, language)}</td>
                        <td className="p-2 text-center font-mono">{m.unitCost != null ? fmtMoney(m.unitCost) : '—'}</td>
                        <td className="p-2 text-gray-500">
                          {[m.referenceType, m.referenceId].filter(Boolean).join(' · ') || '—'}
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

// ─── Tab: تحويلات بين مخازن المشاريع ─────────────────────────────────────────

function InventoryTransfers({
  contracts,
  myContractIds,
  userRole,
  userId,
  allowCreate,
}: {
  contracts: Contract[];
  myContractIds: string[] | null;
  userRole: string;
  userId: string;
  allowCreate: boolean;
}) {
  const { language, theme, t, dir } = useLanguage();
  const ar = language === 'ar';
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [transfers, setTransfers] = useState<ProjectInventoryTransfer[]>([]);
  const [legacyTransfers, setLegacyTransfers] = useState<InventoryTransfer[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);
  const [warehouseAccounts, setWarehouseAccounts] = useState<WarehouseAccountRow[]>([]);
  const [selectedTransferId, setSelectedTransferId] = useState<number | null>(null);

  const isManager = userRole === 'admin' || userRole === 'projects_manager';

  useEffect(() => {
    void loadProjectRowsForInventory()
      .then(setProjects)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void fetchWarehouseAccountRows()
      .then(setWarehouseAccounts)
      .catch(() => undefined);
  }, []);

  const loadTransfers = useCallback(async () => {
    setLoading(true);
    let projectFailed = false;
    try {
      const [projResult, legResult] = await Promise.allSettled([
        projectInventoryTransfersApi.list(),
        inventoryTransfersApi.list(),
      ]);

      if (projResult.status === 'fulfilled') {
        setTransfers(asProjectInventoryTransfers(projResult.value));
      } else {
        projectFailed = true;
        const err = projResult.reason;
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : '';
        const is404 = err instanceof ApiError && err.status === 404;
        toast.error(
          ar
            ? `فشل تحميل تحويلات المشاريع${msg ? `: ${msg}` : ''}${
                is404
                  ? ' — أعد تشغيل الخادم المحلي: npm run local:api من web-cost-app (وليس web-cost-app-local)'
                  : ''
              }`
            : `Failed to load project transfers${msg ? `: ${msg}` : ''}${
                is404 ? ' — restart local API: npm run local:api in web-cost-app' : ''
              }`,
        );
        setTransfers([]);
      }

      if (legResult.status === 'fulfilled') {
        const legacy = asInventoryTransfers(legResult.value).filter((t) =>
          ['pending_b', 'pending_projects'].includes(t.status),
        );
        setLegacyTransfers(legacy);
        if (legacy.length > 0) setShowLegacy(true);
      } else {
        setLegacyTransfers([]);
        if (!projectFailed) {
          console.warn('Legacy contract transfers list skipped:', legResult.reason);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [ar]);

  useEffect(() => {
    void loadTransfers();
  }, [loadTransfers]);

  const transferRows = useMemo(() => asProjectInventoryTransfers(transfers), [transfers]);

  const selectedTransfer = useMemo(
    () => transferRows.find((row) => row.id === selectedTransferId) ?? null,
    [transferRows, selectedTransferId],
  );

  const canApproveDestination = (t: ProjectInventoryTransfer) => {
    if (t.status !== 'pending_b') return false;
    if (userRole === 'admin' || userRole === 'projects_manager') return true;
    if (myContractIds === null) return true;
    return contracts.some((c) => c.projectId === t.toProjectId && myContractIds.includes(c.id));
  };

  const canApproveProjects = (t: ProjectInventoryTransfer) =>
    t.status === 'pending_projects' && isManager;

  const canCancel = (t: ProjectInventoryTransfer) =>
    ['pending_b', 'pending_projects'].includes(t.status) &&
    (userRole === 'admin' || t.createdBy === userId);

  const handleProjectAction = async (
    id: number,
    action: 'approve-b' | 'reject-b' | 'approve-projects' | 'reject-projects' | 'cancel',
  ) => {
    setActionLoading(id);
    try {
      switch (action) {
        case 'approve-b':
          await projectInventoryTransfersApi.approveB(id);
          break;
        case 'reject-b':
          await projectInventoryTransfersApi.rejectB(id);
          break;
        case 'approve-projects': {
          const t = transferRows.find((row) => row.id === id);
          if (!t) throw new Error(ar ? 'طلب التحويل غير موجود' : 'Transfer not found');
          const fromRow = projects.find((p) => p.id === t.fromProjectId);
          const toRow = projects.find((p) => p.id === t.toProjectId);
          const fromHint = transferProjectHint(fromRow, t, 'from');
          const toHint = transferProjectHint(toRow, t, 'to');
          await ensureLinkedWarehouseActiveForProject(t.fromProjectId, fromRow ?? fromHint);
          await ensureLinkedWarehouseActiveForProject(t.toProjectId, toRow ?? toHint);
          let accounts = await fetchWarehouseAccountRows();
          setWarehouseAccounts(accounts);
          const fromWh = await resolveWarehouseAccountsForTransfer(
            t.fromProjectId,
            accounts,
            fromHint,
          );
          const toWh = await resolveWarehouseAccountsForTransfer(
            t.toProjectId,
            accounts,
            toHint,
          );
          if (!fromWh || !toWh) {
            const all127 = await fetchWarehouseAccountRows({ includeDisabled: true });
            const disabledFrom = !fromWh
              ? findDisabledLinkedWarehouse(t.fromProjectId, all127, fromHint)
              : undefined;
            const disabledTo = !toWh
              ? findDisabledLinkedWarehouse(t.toProjectId, all127, toHint)
              : undefined;
            if (disabledFrom || disabledTo) {
              const codes = [disabledFrom, disabledTo]
                .filter(Boolean)
                .map((a) => a!.accountCode)
                .join('، ');
              toast.error(
                ar
                  ? `حساب المخزن (${codes}) معطّل. فعّله من شجرة الحسابات أو أعد ربطه من تبويب «رصيد المخزن».`
                  : `Warehouse account (${codes}) is disabled. Enable it in the chart of accounts or re-link from the Balance tab.`,
              );
            } else {
              toast.error(
                ar
                  ? 'اربط حساب مخزن (127…) لكل مشروع من تبويب «رصيد المخزن» قبل اعتماد التحويل'
                  : 'Link a 127… warehouse account for each project (Balance tab) before final approval',
              );
            }
            return;
          }
          const totalCost = transferTotalCost(t);
          await projectInventoryTransfersApi.approveProjects(id, {
            fromWarehouseAccountCode: fromWh.accountCode,
            fromWarehouseAccountName: fromWh.accountName,
            toWarehouseAccountCode: toWh.accountCode,
            toWarehouseAccountName: toWh.accountName,
          });
          if (totalCost > 0) {
            const fromLabel = t.fromProjectName || fromRow?.projectName || t.fromProjectId;
            const toLabel = t.toProjectName || toRow?.projectName || t.toProjectId;
            await accountingService.recordProjectWarehouseTransfer({
              totalCost,
              fromInventoryAccountCode: fromWh.accountCode,
              fromInventoryAccountName: fromWh.accountName,
              toInventoryAccountCode: toWh.accountCode,
              toInventoryAccountName: toWh.accountName,
              fromProjectName: fromLabel,
              toProjectName: toLabel,
              description: ar
                ? `تحويل مخزن — ${fromLabel} → ${toLabel} (${t.transferNumber})`
                : `Warehouse transfer — ${fromLabel} → ${toLabel} (${t.transferNumber})`,
              fromProjectId: t.fromProjectId,
              date: t.transferDate,
              reference: t.transferNumber,
            });
          }
          break;
        }
        case 'reject-projects':
          await projectInventoryTransfersApi.rejectProjects(id);
          break;
        case 'cancel':
          await projectInventoryTransfersApi.cancel(id);
          break;
      }
      toast.success(ar ? 'تم بنجاح' : 'Done');
      window.dispatchEvent(new CustomEvent('notifications:refresh'));
      void loadTransfers();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : ar ? 'حدث خطأ' : 'An error occurred');
    } finally {
      setActionLoading(null);
    }
  };

  const handleLegacyAction = async (
    id: number,
    action: 'approve-b' | 'reject-b' | 'approve-projects' | 'reject-projects' | 'cancel',
  ) => {
    setActionLoading(id);
    try {
      switch (action) {
        case 'approve-b':
          await inventoryTransfersApi.approveB(id);
          break;
        case 'reject-b':
          await inventoryTransfersApi.rejectB(id);
          break;
        case 'approve-projects':
          await inventoryTransfersApi.approveProjects(id);
          break;
        case 'reject-projects':
          await inventoryTransfersApi.rejectProjects(id);
          break;
        case 'cancel':
          await inventoryTransfersApi.cancel(id);
          break;
      }
      toast.success(ar ? 'تم بنجاح' : 'Done');
      void loadTransfers();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : ar ? 'حدث خطأ' : 'An error occurred');
    } finally {
      setActionLoading(null);
    }
  };

  const renderTransferCard = (
    t: ProjectInventoryTransfer,
    onAction: typeof handleProjectAction,
  ) => {
    const meta = STATUS_META[t.status];
    return (
      <div key={t.id} className={cn('border rounded-xl p-4 shadow-sm', cardBg(theme))}>
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('font-mono font-bold', theme === 'dark' ? 'text-gray-200' : 'text-gray-700')}>
              {t.transferNumber}
            </span>
            <span className={cn('text-xs', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
              {t.transferDate}
            </span>
            <span
              className={cn(
                'px-2 py-0.5 rounded-full text-xs font-medium',
                meta?.color ?? 'text-gray-500 bg-gray-100',
              )}
            >
              {ar ? (meta?.ar ?? t.status) : (meta?.en ?? t.status)}
            </span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {canApproveDestination(t) && (
              <>
                <button
                  type="button"
                  onClick={() => void onAction(t.id, 'approve-b')}
                  disabled={actionLoading === t.id}
                  className="flex items-center gap-1 px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs disabled:opacity-60 transition-colors"
                >
                  {actionLoading === t.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3 h-3" />
                  )}
                  {ar ? 'قبول (مشروع الوجهة)' : 'Accept (dest.)'}
                </button>
                <button
                  type="button"
                  onClick={() => void onAction(t.id, 'reject-b')}
                  disabled={actionLoading === t.id}
                  className="flex items-center gap-1 px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs disabled:opacity-60 transition-colors"
                >
                  <XCircle className="w-3 h-3" />
                  {ar ? 'رفض' : 'Reject'}
                </button>
              </>
            )}
            {canApproveProjects(t) && (
              <>
                <button
                  type="button"
                  onClick={() => void onAction(t.id, 'approve-projects')}
                  disabled={actionLoading === t.id}
                  className="flex items-center gap-1 px-3 py-1 bg-green-700 hover:bg-green-800 text-white rounded-lg text-xs disabled:opacity-60 transition-colors"
                >
                  {actionLoading === t.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3 h-3" />
                  )}
                  {ar ? 'اعتماد نهائي' : 'Final approve'}
                </button>
                <button
                  type="button"
                  onClick={() => void onAction(t.id, 'reject-projects')}
                  disabled={actionLoading === t.id}
                  className="flex items-center gap-1 px-3 py-1 bg-red-700 hover:bg-red-800 text-white rounded-lg text-xs disabled:opacity-60 transition-colors"
                >
                  <XCircle className="w-3 h-3" />
                  {ar ? 'رفض' : 'Reject'}
                </button>
              </>
            )}
            {canCancel(t) && (
              <button
                type="button"
                onClick={() => void onAction(t.id, 'cancel')}
                disabled={actionLoading === t.id}
                className={cn(
                  'flex items-center gap-1 px-3 py-1 rounded-lg text-xs border disabled:opacity-60 transition-colors',
                  theme === 'dark'
                    ? 'border-gray-600 text-gray-300 hover:bg-gray-700'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50',
                )}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
            )}
          </div>
        </div>

        <div
          className={cn(
            'mt-2 text-sm flex flex-wrap items-center gap-2',
            theme === 'dark' ? 'text-gray-400' : 'text-gray-600',
          )}
        >
          <span>
            {ar ? 'من:' : 'From:'}{' '}
            <strong>
              {t.fromProjectName || t.fromProjectId}
              {t.fromProjectCode ? ` (${t.fromProjectCode})` : ''}
            </strong>
          </span>
          <ArrowLeftRight className="w-3 h-3 opacity-50" />
          <span>
            {ar ? 'إلى:' : 'To:'}{' '}
            <strong>
              {t.toProjectName || t.toProjectId}
              {t.toProjectCode ? ` (${t.toProjectCode})` : ''}
            </strong>
          </span>
        </div>

        {t.notes && (
          <p className={cn('mt-1 text-xs', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>{t.notes}</p>
        )}

        {t.lines?.length > 0 && (
          <div className={cn('mt-3 border-t pt-2', theme === 'dark' ? 'border-gray-700' : 'border-gray-100')}>
            <table className="w-full text-xs">
              <thead>
                <tr
                  className={cn(
                    'text-xs uppercase tracking-wide',
                    theme === 'dark' ? 'text-gray-500' : 'text-gray-400',
                  )}
                >
                  <th className={ar ? 'text-right pb-1' : 'text-left pb-1'}>{ar ? 'الصنف' : 'Item'}</th>
                  <th className="text-center pb-1">{ar ? 'الوحدة' : 'Unit'}</th>
                  <th className="text-center pb-1">{ar ? 'الكمية' : 'Qty'}</th>
                  <th className="text-center pb-1">{ar ? 'التكلفة' : 'Unit cost'}</th>
                  <th className="text-center pb-1">{ar ? 'الإجمالي' : 'Total'}</th>
                </tr>
              </thead>
              <tbody
                className={cn('divide-y', theme === 'dark' ? 'divide-gray-700' : 'divide-dashed divide-gray-100')}
              >
                {t.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="py-1">
                      {line.materialName || line.itemDescription || line.materialCode}
                    </td>
                    <td className="py-1 text-center">{line.unit}</td>
                    <td className="py-1 text-center font-mono">{formatQuantity(line.quantity, language)}</td>
                    <td className="py-1 text-center font-mono">{fmtMoney(line.unitCost)}</td>
                    <td className="py-1 text-center font-mono">{fmtMoney(line.totalCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={splitRowCls(dir)}>
      <div className={splitMainCls()}>
        <div
          className={cn(
            'rounded-xl border p-4 text-sm',
            theme === 'dark' ? 'border-blue-800/40 bg-blue-950/20 text-blue-100' : 'border-blue-200 bg-blue-50 text-blue-900',
          )}
        >
          {ar
            ? 'تحويل خامات بين مخازن المشاريع: إنشاء من مشروع المصدر → قبول مشروع الوجهة → اعتماد مسؤول المشاريع. يُحجز الرصيد عند الإنشاء ويُنفَّذ النقل عند الاعتماد النهائي بسعر التكلفة الأصلي.'
            : 'Inter-project warehouse transfers: create from source → destination acceptance → projects manager final approval. Stock is reserved on create; movement posts on final approval at original unit cost.'}
        </div>

        {loading ? (
          <div
            className={cn(
              'flex items-center justify-center py-16 gap-2',
              theme === 'dark' ? 'text-gray-500' : 'text-gray-400',
            )}
          >
            <Loader2 className="w-6 h-6 animate-spin" />
            {ar ? 'جاري التحميل...' : 'Loading...'}
          </div>
        ) : transferRows.length === 0 ? (
          <div className={splitEmptyPaneCls(theme)}>
            <ArrowLeftRight className="w-14 h-14 mx-auto mb-3 opacity-25" />
            <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{t('inventory_filter_empty')}</p>
          </div>
        ) : !selectedTransfer ? (
          <div className={splitEmptyPaneCls(theme)}>
            <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{t('inventory_filter_select_record')}</p>
          </div>
        ) : (
          renderTransferCard(selectedTransfer, handleProjectAction)
        )}

        {legacyTransfers.length > 0 && (
          <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowLegacy((v) => !v)}
            className={cn(
              'text-sm font-medium mb-3 flex items-center gap-2',
              theme === 'dark' ? 'text-amber-400' : 'text-amber-800',
            )}
          >
            {showLegacy ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {ar
              ? `تحويلات العقود القديمة المعلّقة (${legacyTransfers.length})`
              : `Pending legacy contract transfers (${legacyTransfers.length})`}
          </button>
          {showLegacy && (
            <div className="space-y-3 opacity-90">
              {legacyTransfers.map((t) => {
                const meta = STATUS_META[t.status];
                const canLegacyB =
                  t.status === 'pending_b' &&
                  (userRole === 'admin' ||
                    (myContractIds !== null && myContractIds.includes(t.toContractId)));
                const canLegacyPm = t.status === 'pending_projects' && isManager;
                const canLegacyCancel =
                  ['pending_b', 'pending_projects'].includes(t.status) &&
                  (userRole === 'admin' || t.createdBy === userId);
                return (
                  <div key={`leg-${t.id}`} className={cn('border rounded-xl p-4', cardBg(theme))}>
                    <div className="flex justify-between flex-wrap gap-2">
                      <span className="font-mono text-sm">{t.transferNumber}</span>
                      <span className={cn('text-xs px-2 py-0.5 rounded-full', meta?.color)}>
                        {ar ? meta?.ar : meta?.en}
                      </span>
                    </div>
                    <p className="text-xs mt-2 opacity-70">
                      {t.fromContractNumber} → {t.toContractNumber}
                    </p>
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {canLegacyB && (
                        <>
                          <button
                            type="button"
                            className="text-xs px-2 py-1 bg-green-600 text-white rounded"
                            onClick={() => void handleLegacyAction(t.id, 'approve-b')}
                          >
                            {ar ? 'قبول B' : 'Accept B'}
                          </button>
                          <button
                            type="button"
                            className="text-xs px-2 py-1 bg-red-600 text-white rounded"
                            onClick={() => void handleLegacyAction(t.id, 'reject-b')}
                          >
                            {ar ? 'رفض' : 'Reject'}
                          </button>
                        </>
                      )}
                      {canLegacyPm && (
                        <>
                          <button
                            type="button"
                            className="text-xs px-2 py-1 bg-green-700 text-white rounded"
                            onClick={() => void handleLegacyAction(t.id, 'approve-projects')}
                          >
                            {ar ? 'اعتماد' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            className="text-xs px-2 py-1 bg-red-700 text-white rounded"
                            onClick={() => void handleLegacyAction(t.id, 'reject-projects')}
                          >
                            {ar ? 'رفض' : 'Reject'}
                          </button>
                        </>
                      )}
                      {canLegacyCancel && (
                        <button
                          type="button"
                          className="text-xs px-2 py-1 border rounded"
                          onClick={() => void handleLegacyAction(t.id, 'cancel')}
                        >
                          {ar ? 'إلغاء' : 'Cancel'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </div>
        )}
      </div>

      <aside className={splitSidebarCls(theme)}>
        <div>
          <h3 className="font-bold text-sm">{t('inventory_filter_title')}</h3>
        </div>
        <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
          <div className="flex items-center justify-between gap-2">
            <p className={splitSectionTitleCls()}>{t('inventory_filter_list')}</p>
            <button
              type="button"
              onClick={() => void loadTransfers()}
              title={ar ? 'تحديث' : 'Refresh'}
              aria-label={ar ? 'تحديث' : 'Refresh'}
              className={btnGhost(theme)}
            >
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
          </div>
          {loading ? (
            <Loader2 className="animate-spin mx-auto" size={18} />
          ) : transferRows.length === 0 ? (
            <p className="text-xs text-gray-500">{t('inventory_filter_empty')}</p>
          ) : (
            <ul className="space-y-1 max-h-64 overflow-auto">
              {transferRows.map((row) => {
                const meta = STATUS_META[row.status];
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedTransferId(row.id)}
                      className={splitActiveListBtn(selectedTransferId === row.id, theme)}
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0 min-h-[1.25rem] leading-tight">
                        <span className="font-bold shrink-0">{row.transferNumber}</span>
                        <span className="text-xs opacity-80 shrink-0">{row.transferDate}</span>
                        <span className="text-[10px] opacity-75 shrink-0">
                          {ar ? (meta?.ar ?? row.status) : (meta?.en ?? row.status)}
                        </span>
                      </div>
                      <p className="text-[10px] opacity-75 mt-0.5 truncate">
                        {row.fromProjectName || row.fromProjectCode} → {row.toProjectName || row.toProjectCode}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {allowCreate && (
          <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              {ar ? 'طلب تحويل جديد' : 'New transfer'}
            </button>
            <ManualHelpButton topicId="inventory.transfer.project" size={16} />
          </div>
        )}
      </aside>

      {showModal && (
        <ProjectTransferModal
          projects={projects}
          contracts={contracts}
          myContractIds={myContractIds}
          onClose={() => setShowModal(false)}
          onSaved={() => void loadTransfers()}
        />
      )}
    </div>
  );
}

// ─── Tab 3: سجل الحركات ───────────────────────────────────────────────────────

function ConsumptionHistory({ contracts, myContractIds, onRefreshNeeded }: {
  contracts: Contract[]; myContractIds: string[] | null; onRefreshNeeded?: () => void;
}) {
  const { language, theme, t, dir } = useLanguage();
  const ar = language === 'ar';
  const moneyLocale = 'en-US';
  const formatMoneyPrint = (value: number) => formatMoneyLib(value, moneyLocale);
  const [companyInfo, setCompanyInfo] = useState<CompanyPrintInfo>({
    companyName: '',
    companyNameEn: '',
    headerLogo: '',
  });
  const { openDocPreview, ReportPreviewHost } = useReportDocumentPreview({
    language,
    t,
    formatMoney: formatMoneyPrint,
    companyInfo,
  });
  const [orders, setOrders] = useState<ConsumptionOrder[]>([]);
  const [returnOrders, setReturnOrders] = useState<ReturnOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [returnModal, setReturnModal] = useState<{
    projectId: string;
    contractId: string;
    seedLineIds?: number[];
  } | null>(null);
  const [printOrderId, setPrintOrderId] = useState<number | null>(null);
  const [printNames, setPrintNames] = useState({
    requester: '',
    receiver: '',
    storekeeper: '',
  });
  const [contractId, setContractId] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'confirmed'>('all');
  const [selectedHistoryKey, setSelectedHistoryKey] = useState<string | null>(null);

  useEffect(() => {
    void settingsApi.getCompanyInfo()
      .then((res) => {
        if (res.value) setCompanyInfo((prev) => ({ ...prev, ...res.value }));
      })
      .catch(() => undefined);
  }, []);

  const consumptionFilterContracts = useMemo(
    () => contractsForAccessibleProjects(
      contracts,
      accessibleProjectIdsFromContracts(contracts, myContractIds, []),
      [],
    ),
    [contracts, myContractIds],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const status = statusFilter === 'all' ? undefined : statusFilter;
      const [consumptionData, returnData] = await Promise.all([
        consumptionOrdersApi.list({ contractId: contractId || undefined, status }),
        returnOrdersApi.list({ contractId: contractId || undefined, status }),
      ]);
      setOrders(Array.isArray(consumptionData) ? (consumptionData as ConsumptionOrder[]) : []);
      setReturnOrders(Array.isArray(returnData) ? (returnData as ReturnOrder[]) : []);
    } catch {
      toast.error(ar ? 'فشل تحميل أوامر الصرف والإرجاع' : 'Failed to load issues and returns');
    } finally { setLoading(false); }
  }, [contractId, statusFilter, ar]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setSelectedHistoryKey(null);
  }, [contractId, statusFilter]);

  const printOrder = useMemo(
    () => (printOrderId == null ? null : orders.find((o) => o.id === printOrderId) ?? null),
    [orders, printOrderId],
  );

  const openPrintNamesModal = (orderId: number) => {
    setPrintNames({ requester: '', receiver: '', storekeeper: '' });
    setPrintOrderId(orderId);
  };

  const confirmPrintConsumption = () => {
    if (!printOrder) return;
    openDocPreview({
      reportId: 'consumption_order',
      title: ar
        ? `إذن صرف مخزني — ${printOrder.orderNumber}`
        : `Warehouse Issue Slip — ${printOrder.orderNumber}`,
      scopeLabel: [printOrder.projectName, printOrder.contractName].filter(Boolean).join(' · ') || undefined,
      dateLabel: printOrder.orderDate,
      columns: [],
      rows: [],
      sections: buildConsumptionOrderSections(
        {
          orderNumber: printOrder.orderNumber,
          orderDate: printOrder.orderDate,
          projectName: printOrder.projectName,
          contractName: printOrder.contractName,
          contractNumber: printOrder.contractNumber,
          statusLabel:
            printOrder.status === 'confirmed'
              ? ar ? 'مؤكد' : 'Confirmed'
              : ar ? 'مسودة' : 'Draft',
          notes: printOrder.notes,
          lines: (printOrder.lines ?? []).map((line) => ({
            materialCode: line.materialCode,
            materialName: line.materialName || '—',
            unit: line.materialUnit || '—',
            chapterName: line.chapterName,
            quantity: Number(line.quantity) || 0,
          })),
          requesterName: printNames.requester,
          receiverName: printNames.receiver,
          storekeeperName: printNames.storekeeper,
          formatQuantity: (n) => formatQuantity(n, language),
        },
        language,
      ),
      filename: `consumption-${printOrder.orderNumber}`,
    });
    setPrintOrderId(null);
  };

  const historySidebarEntries = useMemo(() => {
    const entries: Array<{
      key: string;
      kind: 'consumption' | 'return';
      label: string;
      date: string;
      status: string;
      hint: string;
    }> = [];
    for (const o of orders) {
      entries.push({
        key: `c-${o.id}`,
        kind: 'consumption',
        label: o.orderNumber,
        date: o.orderDate,
        status: o.status,
        hint: [o.projectName, o.contractName].filter(Boolean).join(' · '),
      });
    }
    for (const ro of returnOrders) {
      entries.push({
        key: `r-${ro.id}`,
        kind: 'return',
        label: ro.returnNumber,
        date: ro.returnDate,
        status: ro.status,
        hint: [ro.projectName, ro.contractName].filter(Boolean).join(' · '),
      });
    }
    return entries.sort((a, b) => b.date.localeCompare(a.date) || a.label.localeCompare(b.label));
  }, [orders, returnOrders]);

  const rows = useMemo(() => {
    const consumptionRows: Extract<ConsumptionHistoryRow, { kind: 'consumption' }>[] = [];
    const returnRows: Extract<ConsumptionHistoryRow, { kind: 'return' }>[] = [];

    const sortedOrders = [...orders].sort(
      (a, b) => b.orderDate.localeCompare(a.orderDate) || b.id - a.id,
    );

    for (const order of sortedOrders) {
      const pid = order.projectId || contracts.find((c) => c.id === order.contractId)?.projectId || '';
      const lines = order.lines ?? [];
      lines.forEach((line, idx) => {
        consumptionRows.push({
          kind: 'consumption',
          key: `c-${order.id}-${line.id}`,
          orderId: order.id,
          lineId: line.id,
          projectId: pid,
          contractId: order.contractId,
          orderNumber: order.orderNumber,
          orderDate: order.orderDate,
          status: order.status,
          boqItemCode: line.boqItemCode,
          boqDescription: line.boqDescription,
          materialName: line.materialName || line.materialCode || '—',
          unit: line.materialUnit || '—',
          quantity: line.quantity,
          unitCost: line.unitCost,
          totalCost: line.totalCost,
          contractName: order.contractName,
          projectName: order.projectName,
          showGroupCells: idx === 0,
          groupRowSpan: Math.max(lines.length, 1),
          linesInOrder: lines.length,
        });
      });
    }

    for (const ro of returnOrders) {
      const pid = ro.projectId || contracts.find((c) => c.id === ro.contractId)?.projectId || '';
      for (const line of ro.lines ?? []) {
        returnRows.push({
          kind: 'return',
          key: `r-${ro.id}-${line.id}`,
          returnOrderId: ro.id,
          consumptionOrderLineId: line.consumptionOrderLineId,
          projectId: pid,
          contractId: ro.contractId,
          returnNumber: ro.returnNumber,
          consumptionOrderNumber: line.consumptionOrderNumber,
          returnDate: ro.returnDate,
          status: ro.status,
          boqItemCode: line.boqItemCode,
          boqDescription: line.boqDescription,
          materialName: line.materialName || line.materialCode || '—',
          unit: line.materialUnit || '—',
          quantity: line.quantity,
          unitCost: line.unitCost,
          totalCost: Math.abs(line.totalCost),
          contractName: ro.contractName,
          projectName: ro.projectName,
        });
      }
    }

    returnRows.sort((a, b) => b.returnDate.localeCompare(a.returnDate));

    const merged: ConsumptionHistoryRow[] = [];
    let ci = 0;
    let ri = 0;
    while (ci < consumptionRows.length && ri < returnRows.length) {
      const cDate = consumptionRows[ci]!.orderDate;
      const rDate = returnRows[ri]!.returnDate;
      if (cDate >= rDate) {
        merged.push(consumptionRows[ci]!);
        ci += 1;
      } else {
        merged.push(returnRows[ri]!);
        ri += 1;
      }
    }
    while (ci < consumptionRows.length) {
      merged.push(consumptionRows[ci]!);
      ci += 1;
    }
    while (ri < returnRows.length) {
      merged.push(returnRows[ri]!);
      ri += 1;
    }
    return merged;
  }, [orders, returnOrders, contracts]);

  const detailRows = useMemo((): ConsumptionHistoryRow[] => {
    if (!selectedHistoryKey) return [];
    if (selectedHistoryKey.startsWith('c-')) {
      const orderId = Number(selectedHistoryKey.slice(2));
      const filtered = rows.filter((r) => r.kind === 'consumption' && r.orderId === orderId);
      return filtered.map((r, idx) =>
        r.kind === 'consumption'
          ? { ...r, showGroupCells: idx === 0, groupRowSpan: filtered.length }
          : r,
      );
    }
    const returnId = Number(selectedHistoryKey.slice(2));
    return rows.filter((r) => r.kind === 'return' && r.returnOrderId === returnId);
  }, [rows, selectedHistoryKey]);

  const returnCandidateLines = useMemo((): ReturnOrderLineContext[] => {
    const out: ReturnOrderLineContext[] = [];
    for (const r of rows) {
      if (r.kind !== 'consumption' || r.status !== 'confirmed' || !r.projectId) continue;
      out.push({
        consumptionOrderLineId: r.lineId,
        consumptionOrderId: r.orderId,
        orderNumber: r.orderNumber,
        projectId: r.projectId,
        contractId: r.contractId,
        materialName: r.materialName,
        materialUnit: r.unit,
        boqItemCode: r.boqItemCode,
        boqDescription: r.boqDescription,
        issuedQuantity: r.quantity,
        unitCost: r.unitCost,
      });
    }
    return out;
  }, [rows]);

  const draftOrders = orders.filter((o) => o.status === 'draft');

  const handleConfirmDraft = async (orderId: number) => {
    setConfirmingId(orderId);
    try {
      await consumptionOrdersApi.confirm(orderId);
      toast.success(ar ? 'تم تأكيد أمر الصرف' : 'Order confirmed');
      onRefreshNeeded?.();
      void load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : ar ? 'حدث خطأ' : 'Error');
    } finally {
      setConfirmingId(null);
    }
  };

  return (
    <div className={splitRowCls(dir)}>
      <div className={splitMainCls()}>
        {draftOrders.length > 0 && (
          <div className={cn('mb-4 p-3 rounded-lg border', theme === 'dark' ? 'border-amber-800 bg-amber-900/20' : 'border-amber-200 bg-amber-50')}>
            <p className="text-sm font-medium mb-2">{ar ? 'مسودات بانتظار التأكيد' : 'Draft orders pending confirmation'}</p>
            <div className="flex flex-wrap gap-2">
              {draftOrders.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  disabled={confirmingId === o.id}
                  onClick={() => handleConfirmDraft(o.id)}
                  className="text-xs px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {confirmingId === o.id && <Loader2 className="w-3 h-3 animate-spin" />}
                  {o.orderNumber} — {ar ? 'تأكيد' : 'Confirm'}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className={cn('flex items-center justify-center py-12 gap-2', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
            <Loader2 className="w-5 h-5 animate-spin" />{ar ? 'جاري التحميل...' : 'Loading...'}
          </div>
        ) : historySidebarEntries.length === 0 ? (
          <div className={splitEmptyPaneCls(theme)}>
            <History className="w-14 h-14 mx-auto mb-3 opacity-25" />
            <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{t('inventory_filter_empty')}</p>
          </div>
        ) : !selectedHistoryKey || detailRows.length === 0 ? (
          <div className={splitEmptyPaneCls(theme)}>
            <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{t('inventory_filter_select_record')}</p>
          </div>
        ) : (
          <div className={cn('border rounded-xl overflow-hidden', theme === 'dark' ? 'border-gray-700' : 'border-gray-200')}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className={cn('text-xs uppercase tracking-wide', tableTh(theme))}>
                  <tr>
                    <th className="p-3 text-center">{ar ? 'النوع' : 'Type'}</th>
                    <th className={cn('p-3 font-semibold', ar ? 'text-right' : 'text-left')}>{ar ? 'رقم الأمر' : 'Order #'}</th>
                    <th className={cn('p-3 font-semibold', ar ? 'text-right' : 'text-left')}>{ar ? 'التاريخ' : 'Date'}</th>
                    <th className="p-3 text-center">{ar ? 'الحالة' : 'Status'}</th>
                    <th className={cn('p-3 font-semibold', ar ? 'text-right' : 'text-left')}>{ar ? 'بند BOQ' : 'BOQ Item'}</th>
                    <th className={cn('p-3 font-semibold', ar ? 'text-right' : 'text-left')}>{ar ? 'الصنف' : 'Material'}</th>
                    <th className="p-3 text-center">{ar ? 'الوحدة' : 'Unit'}</th>
                    <th className="p-3 text-center">{ar ? 'الكمية' : 'Qty'}</th>
                    <th className="p-3 text-center">{ar ? 'القيمة' : 'Value'}</th>
                    <th className={cn('p-3 font-semibold', ar ? 'text-right' : 'text-left')}>{ar ? 'العقد' : 'Contract'}</th>
                    <th className="p-3 text-center">{ar ? 'إجراء' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody className={cn('divide-y', theme === 'dark' ? 'divide-gray-700' : 'divide-gray-100')}>
                {detailRows.map((r, ri) => (
                  <tr
                    key={listKey(r.key, ri, `${r.kind}-hist`)}
                    className={cn(
                      'transition-colors',
                      tableRowHover(theme),
                      r.kind === 'return' && (theme === 'dark' ? 'bg-blue-950/20' : 'bg-blue-50/50')
                    )}
                  >
                    {(r.kind === 'return' || r.showGroupCells) && (
                      <td
                        className="p-3 text-center align-top"
                        rowSpan={r.kind === 'consumption' ? r.groupRowSpan : undefined}
                      >
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded-full text-xs font-medium',
                            r.kind === 'return'
                              ? 'text-blue-700 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-300'
                              : 'text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-400'
                          )}
                        >
                          {r.kind === 'return' ? (ar ? 'إرجاع' : 'Return') : (ar ? 'صرف' : 'Issue')}
                        </span>
                      </td>
                    )}
                    {(r.kind === 'return' || r.showGroupCells) && (
                      <td
                        className="p-3 font-mono text-xs align-top"
                        rowSpan={r.kind === 'consumption' ? r.groupRowSpan : undefined}
                      >
                        {r.kind === 'consumption' ? (
                          <div>
                            <span>{r.orderNumber}</span>
                            {r.linesInOrder > 1 && (
                              <span className={cn('block text-[10px] mt-0.5', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
                                {t('consume_history_lines_count').replace('{count}', String(r.linesInOrder))}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div>
                            <span>{r.returnNumber}</span>
                            {r.consumptionOrderNumber && (
                              <span className={cn('block text-[10px] mt-0.5', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
                                {ar ? 'من' : 'from'} {r.consumptionOrderNumber}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                    {(r.kind === 'return' || r.showGroupCells) && (
                      <td
                        className="p-3 font-mono text-xs align-top"
                        rowSpan={r.kind === 'consumption' ? r.groupRowSpan : undefined}
                      >
                        {r.kind === 'consumption' ? r.orderDate : r.returnDate}
                      </td>
                    )}
                    {(r.kind === 'return' || r.showGroupCells) && (
                      <td
                        className="p-3 text-center align-top"
                        rowSpan={r.kind === 'consumption' ? r.groupRowSpan : undefined}
                      >
                        <span className={cn(
                          'px-2 py-0.5 rounded-full text-xs font-medium',
                          r.status === 'confirmed'
                            ? 'text-green-700 bg-green-50 dark:bg-green-900/30 dark:text-green-400'
                            : 'text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400',
                        )}>
                          {r.status === 'confirmed' ? (ar ? 'مؤكد' : 'Confirmed') : (ar ? 'مسودة' : 'Draft')}
                        </span>
                      </td>
                    )}
                    <td className="p-3 text-sm">
                      {r.boqItemCode && <span className="font-mono text-xs block">{r.boqItemCode}</span>}
                      <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>{r.boqDescription || '—'}</span>
                    </td>
                    <td className="p-3 font-medium">{r.materialName}</td>
                    <td className="p-3 text-center">{r.unit}</td>
                    <td
                      className={cn(
                        'p-3 text-center font-mono',
                        r.kind === 'return' ? 'text-blue-500' : 'text-red-500'
                      )}
                    >
                      {formatQuantity(r.quantity, language)}
                    </td>
                    <td className="p-3 text-center font-mono font-semibold">{fmtMoney(r.totalCost)}</td>
                    {(r.kind === 'return' || r.showGroupCells) && (
                      <td
                        className={cn('p-3 text-xs align-top', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}
                        rowSpan={r.kind === 'consumption' ? r.groupRowSpan : undefined}
                      >
                        {r.projectName} / {r.contractName}
                      </td>
                    )}
                    <td className="p-3 text-center align-top">
                      <div className="flex flex-col items-center gap-1">
                        {r.kind === 'consumption' && r.showGroupCells && (
                          <button
                            type="button"
                            onClick={() => openPrintNamesModal(r.orderId)}
                            className="text-xs px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition-colors inline-flex items-center gap-1"
                            title={t('consume_order_print')}
                          >
                            <Printer className="w-3 h-3" />
                            {t('consume_order_print')}
                          </button>
                        )}
                        {r.kind === 'consumption' && r.status === 'confirmed' && r.projectId && (
                          <button
                            type="button"
                            onClick={() =>
                              setReturnModal({
                                projectId: r.projectId,
                                contractId: r.contractId,
                                seedLineIds: [r.lineId],
                              })
                            }
                            className="text-xs px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                          >
                            {ar ? 'إرجاع' : 'Return'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>

      <aside className={splitSidebarCls(theme)}>
        <div>
          <h3 className="font-bold text-sm">{t('inventory_filter_title')}</h3>
        </div>
        <div className="space-y-3">
          <div>
            <label className={splitLabelCls(theme)}>{t('contract')}</label>
            <select
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              className={splitSelectCls(theme)}
            >
              <option value="">{ar ? '— كل العقود —' : '— All contracts —'}</option>
              {consumptionFilterContracts.map((c) => (
                <option key={c.id} value={c.id}>{c.contractNumber} — {c.contractName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={splitLabelCls(theme)}>{ar ? 'تصفية حسب الحالة' : 'Filter by status'}</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'draft' | 'confirmed')}
              className={splitSelectCls(theme)}
            >
              <option value="all">{ar ? `الكل (${historySidebarEntries.length})` : `All (${historySidebarEntries.length})`}</option>
              <option value="confirmed">{ar ? 'مؤكد' : 'Confirmed'}</option>
              <option value="draft">{ar ? 'مسودة' : 'Draft'}</option>
            </select>
          </div>
        </div>
        <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
          <div className="flex items-center justify-between gap-2">
            <p className={splitSectionTitleCls()}>{t('inventory_filter_list')}</p>
            <button onClick={load} title={ar ? 'تحديث' : 'Refresh'} aria-label={ar ? 'تحديث' : 'Refresh'} className={btnGhost(theme)}>
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
          </div>
          {loading ? (
            <Loader2 className="animate-spin mx-auto" size={18} />
          ) : historySidebarEntries.length === 0 ? (
            <p className="text-xs text-gray-500">{t('inventory_filter_empty')}</p>
          ) : (
            <ul className="space-y-1 max-h-52 overflow-auto">
              {historySidebarEntries.map((entry) => (
                <li key={entry.key}>
                  <button
                    type="button"
                    onClick={() => setSelectedHistoryKey(entry.key)}
                    className={splitActiveListBtn(selectedHistoryKey === entry.key, theme)}
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0 min-h-[1.25rem] leading-tight">
                      <span className="font-bold shrink-0">{entry.label}</span>
                      <span className="text-xs opacity-80 shrink-0">{entry.date}</span>
                      <span className="text-[10px] opacity-75 shrink-0">
                        {entry.kind === 'return' ? (ar ? 'إرجاع' : 'Return') : (ar ? 'صرف' : 'Issue')}
                      </span>
                      <span className="text-[10px] opacity-75 shrink-0">
                        {entry.status === 'confirmed' ? (ar ? 'مؤكد' : 'Confirmed') : (ar ? 'مسودة' : 'Draft')}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
          {selectedHistoryKey?.startsWith('c-') && (
            <button
              type="button"
              onClick={() => {
                const id = Number(selectedHistoryKey.slice(2));
                if (Number.isFinite(id)) openPrintNamesModal(id);
              }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white transition-colors"
            >
              <Printer className="w-4 h-4" />
              {t('consume_order_print')}
            </button>
          )}
          {contractId && (
            <button
              type="button"
              onClick={() => {
                const candidates = returnCandidateLines.filter((l) => l.contractId === contractId);
                const first = candidates[0];
                if (!first) {
                  toast.error(t('return_order_no_lines'));
                  return;
                }
                setReturnModal({
                  projectId: first.projectId,
                  contractId,
                });
              }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              {t('return_order_new')}
            </button>
          )}
          <div className="flex items-center gap-2">
            <ManualHelpButton topicId="inventory.return" size={16} />
          </div>
        </div>
      </aside>

      {printOrder && (
        <div className={modalOverlay()} onClick={() => setPrintOrderId(null)}>
          <div
            className={cn(modalCard(theme), 'max-w-md w-full')}
            onClick={(e) => e.stopPropagation()}
            dir={dir}
          >
            <h3 className="font-bold text-base mb-1">{t('consume_order_print')}</h3>
            <p className={cn('text-xs mb-4', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>
              {t('consume_order_print_names_hint')}
            </p>
            <p className={cn('text-sm font-mono mb-3', theme === 'dark' ? 'text-gray-300' : 'text-gray-700')}>
              {printOrder.orderNumber}
            </p>
            <div className="space-y-3 mb-5">
              <div>
                <label className={splitLabelCls(theme)}>{t('consume_order_sign_requester')}</label>
                <input
                  type="text"
                  value={printNames.requester}
                  onChange={(e) => setPrintNames((p) => ({ ...p, requester: e.target.value }))}
                  className={inputCls(theme)}
                  placeholder={t('consume_order_sign_name_ph')}
                />
              </div>
              <div>
                <label className={splitLabelCls(theme)}>{t('consume_order_sign_receiver')}</label>
                <input
                  type="text"
                  value={printNames.receiver}
                  onChange={(e) => setPrintNames((p) => ({ ...p, receiver: e.target.value }))}
                  className={inputCls(theme)}
                  placeholder={t('consume_order_sign_name_ph')}
                />
              </div>
              <div>
                <label className={splitLabelCls(theme)}>{t('consume_order_sign_storekeeper')}</label>
                <input
                  type="text"
                  value={printNames.storekeeper}
                  onChange={(e) => setPrintNames((p) => ({ ...p, storekeeper: e.target.value }))}
                  className={inputCls(theme)}
                  placeholder={t('consume_order_sign_name_ph')}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPrintOrderId(null)} className={btnGhost(theme)}>
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={confirmPrintConsumption}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white inline-flex items-center gap-2"
              >
                <Printer className="w-4 h-4" />
                {t('consume_order_print_preview')}
              </button>
            </div>
          </div>
        </div>
      )}

      {returnModal && (
        <ReturnOrderModal
          projectId={returnModal.projectId}
          contractId={returnModal.contractId}
          candidateLines={returnCandidateLines}
          seedLineIds={returnModal.seedLineIds}
          onClose={() => setReturnModal(null)}
          onSaved={() => {
            onRefreshNeeded?.();
            void load();
          }}
        />
      )}
      {ReportPreviewHost}
    </div>
  );
}

// ─── Setup guide (empty stock) ────────────────────────────────────────────────

function InventorySetupGuide({ theme }: { theme: Theme }) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const steps = ar
    ? [
        { n: '1', title: 'شجرة الأصناف', body: 'من تبويب «الأصناف» هنا أو من أسفل موديول المشاريع — أنشئ مجموعات وأصناف المواد.' },
        { n: '2', title: 'ربط BOQ', body: 'في جدول الكميات → زر الحزمة على البند — اختر الأصناف المسموح صرفها لهذا البند.' },
        { n: '3', title: 'فاتورة موزعة', body: 'التكاليف الفعلية → فاتورة مشتريات → اختر الصنف لكل بند واحفظ بحالة مؤكدة لتسجيل الوارد في المخزون.' },
        { n: '4', title: 'صرف وتحويل', body: 'من رصيد المخزون: «أمر صرف جديد» أو «صرف» على صف؛ من تبويب التحويلات: نقل بين العقود.' },
      ]
    : [
        { n: '1', title: 'Materials tree', body: 'Use the Materials tab here (or Projects module) to define groups and categories.' },
        { n: '2', title: 'Link BOQ', body: 'In BOQ → Package on a line → pick allowed materials for that item.' },
        { n: '3', title: 'Distributed invoice', body: 'Actual Costs → purchase invoice → material per line → save as confirmed to post stock.' },
        { n: '4', title: 'Issue & return', body: 'Balance tab: consumption order; History tab: returns. Legacy contract transfers are frozen.' },
      ];

  return (
    <div
      className={cn(
        'mb-6 rounded-xl border p-5 space-y-3',
        theme === 'dark' ? 'border-blue-800/50 bg-blue-950/30' : 'border-blue-200 bg-blue-50/80',
      )}
    >
      <p className={cn('text-sm font-bold', theme === 'dark' ? 'text-blue-300' : 'text-blue-800')}>
        {ar ? 'لا يوجد رصيد مخزون بعد — اتبع الخطوات:' : 'No inventory balance yet — follow these steps:'}
      </p>
      <ol className="space-y-2">
        {steps.map((s) => (
          <li key={s.n} className={cn('text-sm flex gap-3', theme === 'dark' ? 'text-gray-300' : 'text-gray-700')}>
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
              {s.n}
            </span>
            <span>
              <span className="font-semibold">{s.title}: </span>
              {s.body}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type Tab = 'materials' | 'balance' | 'transfers' | 'history';

interface InventoryDraft {
  activeTab: Tab;
}

function isInventoryTab(value: string): value is Tab {
  return value === 'materials' || value === 'balance' || value === 'transfers' || value === 'history';
}

export default function Inventory() {
  const { language, theme, dir, t } = useLanguage();
  const ar = language === 'ar';
  const { can } = usePermissions();
  const invPerm = can('inventory');
  const { role: userRole, assignedContractIds: scopeContractIds } = useUserAccessScope();
  const { isErpShell, activeViewId, erp } = useErpModuleView('inventory', isLocalBackend ? 'materials' : 'balance');
  const draftHydrated = useRef(false);
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const pending = peekPendingShellView('inventory');
    if (pending && isInventoryTab(pending)) return pending;
    return isLocalBackend ? 'materials' : 'balance';
  });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!isErpShell || !erp || draftHydrated.current) return;
    const saved = erp.getModuleDraft<InventoryDraft>('inventory');
    if (saved?.activeTab) setActiveTab(saved.activeTab);
    draftHydrated.current = true;
  }, [isErpShell, erp]);

  useEffect(() => {
    if (!isErpShell || !isInventoryTab(activeViewId)) return;
    setActiveTab(activeViewId);
  }, [activeViewId, isErpShell]);

  useEffect(() => {
    const pendingView = consumePendingShellView('inventory');
    if (pendingView && isInventoryTab(pendingView)) setActiveTab(pendingView);
  }, []);

  useErpModuleDraft('inventory', { activeTab }, isErpShell, erp);

  const userId = (auth as unknown as { currentUser?: { uid: string } }).currentUser?.uid ?? '';

  const { data: contracts, loading: contractsLoading, error: contractsError } = useApiQuery<Contract>(
    async () => loadContractRowsForInventory(),
    [refreshKey],
    { enabled: isLocalBackend, refreshKey },
  );

  useEffect(() => {
    if (contractsError) {
      toast.error(ar ? 'فشل تحميل العقود' : 'Failed to load contracts');
    }
  }, [contractsError, ar]);

  const myContractIds: string[] | null = useMemo(() => {
    if (userRole === 'admin' || userRole === 'projects_manager') return null;
    return scopeContractIds ?? [];
  }, [userRole, scopeContractIds]);

  const contractRows = contracts;

  const TAB_META: Record<Tab, { titleKey: 'inventory_menu_materials' | 'inventory_menu_balance' | 'inventory_menu_transfers' | 'inventory_menu_history'; subtitleKey: string }> = {
    materials: { titleKey: 'inventory_menu_materials', subtitleKey: 'inventory_screen_materials_subtitle' },
    balance: { titleKey: 'inventory_menu_balance', subtitleKey: 'inventory_screen_balance_subtitle' },
    transfers: { titleKey: 'inventory_menu_transfers', subtitleKey: 'inventory_screen_transfers_subtitle' },
    history: { titleKey: 'inventory_menu_history', subtitleKey: 'inventory_screen_history_subtitle' },
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'materials', label: t('inventory_menu_materials'), icon: <Package className="w-4 h-4" /> },
    { id: 'balance',   label: t('inventory_menu_balance'), icon: <Package className="w-4 h-4" /> },
    { id: 'transfers', label: t('inventory_menu_transfers'), icon: <ArrowLeftRight className="w-4 h-4" /> },
    { id: 'history',   label: t('inventory_menu_history'), icon: <History className="w-4 h-4" /> },
  ];

  if (!isLocalBackend) {
    return (
      <div className={cn('h-full flex flex-col p-8', pageBg(theme))} dir={dir}>
        <div className={cn('max-w-lg mx-auto rounded-2xl border p-6 space-y-3', cardBg(theme))}>
          <h1 className="text-lg font-bold">{ar ? 'إدارة المخازن' : 'Inventory Management'}</h1>
          <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>
            {ar
              ? 'موديول المخازن الكامل (أصناف، رصيد، تحويلات، أوامر صرف) يعمل مع الخادم المحلي SQLite فقط. عيّن VITE_DATA_BACKEND=local في .env وشغّل npm run local:api ثم أعد تحميل الصفحة.'
              : 'Full inventory requires the local SQLite backend. Set VITE_DATA_BACKEND=local, run npm run local:api, then reload.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('h-full flex flex-col', pageBg(theme))} dir={dir}>

      {/* ── Header ── */}
      <div className={cn('border-b px-6 py-4', headerBg(theme))}>
        <div className="flex items-center gap-3">
          <div className={cn('p-2 rounded-lg', theme === 'dark' ? 'bg-blue-900/40' : 'bg-blue-50')}>
            <Package className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className={cn('text-lg font-bold', theme === 'dark' ? 'text-gray-100' : 'text-gray-800')}>
              {t(TAB_META[activeTab].titleKey)}
            </h1>
            <p className={cn('text-xs', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
              {t(TAB_META[activeTab].subtitleKey)}
            </p>
          </div>
        </div>

        {/* Tab bar */}
        {!isErpShell && (
        <div className={cn('flex gap-1 mt-4 p-1 rounded-xl w-fit', theme === 'dark' ? 'bg-gray-800' : theme === 'soft' ? 'bg-white/50' : 'bg-gray-100')}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : theme === 'dark'
                    ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                    : 'text-gray-500 hover:text-gray-800 hover:bg-white',
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'materials' && <MaterialsTree />}
        {activeTab === 'balance' && (
          <InventoryBalance
            key={refreshKey}
            contracts={contractRows}
            contractsLoading={contractsLoading}
            myContractIds={myContractIds}
            onRefreshNeeded={() => setRefreshKey((k) => k + 1)}
          />
        )}
        {activeTab === 'transfers' && (
          <InventoryTransfers
            contracts={contractRows}
            myContractIds={myContractIds}
            userRole={userRole}
            userId={userId}
            allowCreate={invPerm.create}
          />
        )}
        {activeTab === 'history' && (
          <ConsumptionHistory
            contracts={contractRows}
            myContractIds={myContractIds}
            onRefreshNeeded={() => setRefreshKey((k) => k + 1)}
          />
        )}
      </div>
    </div>
  );
}
