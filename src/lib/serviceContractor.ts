/** Subcontractor service classification (still COA 21102). */

export const SERVICE_KINDS = ['works', 'labour', 'equipment', 'vehicles', 'housing'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

export const SERVICE_IPC_KINDS = ['labour', 'equipment', 'vehicles', 'housing'] as const;
export type ServiceIpcKind = (typeof SERVICE_IPC_KINDS)[number];

export const SERVICE_IPC_TYPE = 'service_ipc';

export function isServiceKind(value: unknown): value is ServiceKind {
  return typeof value === 'string' && (SERVICE_KINDS as readonly string[]).includes(value);
}

export function isServiceIpcKind(value: unknown): value is ServiceIpcKind {
  return typeof value === 'string' && (SERVICE_IPC_KINDS as readonly string[]).includes(value);
}

/** True when this directory row uses the service-IPC flow (not BOQ-item IPC). */
export function isServiceContractor(row: { type?: string; serviceKind?: string | null } | undefined): boolean {
  if (!row) return false;
  const type = String(row.type || '');
  if (type === 'supplier' || type === 'material') return false;
  return isServiceIpcKind(row.serviceKind);
}

export function serviceKindExpenseAccount(kind: ServiceIpcKind): string {
  if (kind === 'labour') return '51102001';
  if (kind === 'housing') return '51103001';
  return '51104001';
}

export function serviceKindExpenseName(kind: ServiceIpcKind, supplierName: string): string {
  if (kind === 'labour') return `عمالة مباشرة - ${supplierName}`;
  if (kind === 'housing') return `تكاليف مقاولو الباطن - ${supplierName}`;
  if (kind === 'vehicles') return `معدات وآلات (سيارات) - ${supplierName}`;
  return `معدات وآلات - ${supplierName}`;
}

export type ServiceIpcLine = {
  id?: string;
  contractId: string;
  projectId?: string;
  chapterCode?: string;
  chapterName?: string;
  description: string;
  unit: string;
  rate: number;
  previousQty: number;
  currentQty: number;
};

export function serviceIpcLineKey(line: {
  contractId?: string;
  chapterCode?: string;
  description?: string;
}): string {
  const desc = String(line.description || '').trim().toLowerCase();
  const chapter = String(line.chapterCode || '').trim();
  const contractId = String(line.contractId || '').trim();
  return `${contractId}|${chapter}|${desc}`;
}

export function netQty(previousQty: number, currentQty: number): number {
  return Number(previousQty || 0) + Number(currentQty || 0);
}

export function periodLineAmount(line: { currentQty?: number; rate?: number }): number {
  return Number(line.currentQty || 0) * Number(line.rate || 0);
}

export function toDateLineAmount(line: { previousQty?: number; currentQty?: number; rate?: number }): number {
  return netQty(Number(line.previousQty || 0), Number(line.currentQty || 0)) * Number(line.rate || 0);
}

export function previousQtyFromApproved(
  approvedItems: Array<{ contractId?: string; chapterCode?: string; description?: string; currentQty?: number }>,
  line: { contractId?: string; chapterCode?: string; description?: string },
): number {
  const key = serviceIpcLineKey(line);
  if (!key.endsWith('|') && key.split('|')[2] === '') return 0;
  return approvedItems
    .filter((item) => serviceIpcLineKey(item) === key)
    .reduce((sum, item) => sum + Number(item.currentQty || 0), 0);
}

export function uniqueBoqChapters(
  boqItems: Array<{ contractId?: string; chapterCode?: string | null; chapterName?: string | null; isDeleted?: boolean }>,
  contractId: string,
): { code: string; name: string }[] {
  const map = new Map<string, string>();
  for (const item of boqItems) {
    if (item.isDeleted) continue;
    if (String(item.contractId || '') !== contractId) continue;
    const code = String(item.chapterCode || '').trim();
    if (!code) continue;
    if (!map.has(code)) map.set(code, String(item.chapterName || code).trim() || code);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([code, name]) => ({ code, name }));
}
