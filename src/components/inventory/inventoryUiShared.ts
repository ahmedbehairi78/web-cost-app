import { cn } from '../../lib/utils';
import { formatMoney as formatMoneyLib } from '../../lib/money';
import type { AppTheme } from '../../lib/shellTheme';

export type Theme = AppTheme;

export interface ProjectInventoryItem {
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
  quantityUnpriced?: number;
  quantityAvailable: number;
  unitCost: number;
  avgUnitCost?: number;
  updatedAt?: string;
}

export interface Contract {
  id: string;
  contractName: string;
  contractNumber: string;
  projectId: string;
}

export interface ProjectRow {
  id: string;
  projectName: string;
  projectCode?: string;
  inventoryAccountCode?: string;
}

export const today = () => new Date().toISOString().slice(0, 10);

/** Projects reachable via at least one assigned contract; null = unrestricted (admin / PM). */
export function accessibleProjectIdsFromContracts(
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

export function projectMatchesScope(project: ProjectRow, scopedIds: Set<string>): boolean {
  if (scopedIds.has(project.id)) return true;
  const code = String(project.projectCode || '').trim();
  return code.length > 0 && scopedIds.has(code);
}

export function asProjectInventoryItems(data: unknown): ProjectInventoryItem[] {
  if (Array.isArray(data)) return data as ProjectInventoryItem[];
  if (data && typeof data === 'object' && 'items' in data && Array.isArray((data as { items: unknown }).items))
    return (data as { items: ProjectInventoryItem[] }).items;
  return [];
}

export function projectInventoryItemLabel(item: ProjectInventoryItem, ar: boolean): string {
  const code = item.materialCode ? `${item.materialCode} — ` : '';
  const name = item.materialName || item.itemDescription || (ar ? 'صنف' : 'Item');
  return `${code}${name}`;
}

export function fmtMoney(n: number) {
  return formatMoneyLib(n);
}

export function tableTh(theme: Theme) {
  return theme === 'dark' ? 'bg-gray-800 text-gray-300'
    : theme === 'soft' ? 'bg-gray-100 text-gray-600'
    : 'bg-gray-50 text-gray-600';
}

export function inputCls(theme: Theme) {
  return cn(
    'w-full border rounded-lg px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-blue-500',
    theme === 'dark'
      ? 'bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500'
      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400',
  );
}

export function btnGhost(theme: Theme) {
  return cn(
    'p-2 rounded-lg border transition-colors',
    theme === 'dark'
      ? 'border-gray-600 hover:bg-gray-700 text-gray-300'
      : 'border-gray-300 hover:bg-gray-100 text-gray-600',
  );
}

export function splitLabelCls(theme: Theme) {
  return cn('block text-xs font-bold mb-1.5', theme === 'dark' ? 'text-gray-400' : 'text-gray-500');
}

export function modalOverlay() {
  return 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
}

export function modalCard(theme: Theme) {
  return cn(
    'rounded-xl shadow-2xl w-full p-6',
    theme === 'dark' ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900',
  );
}
