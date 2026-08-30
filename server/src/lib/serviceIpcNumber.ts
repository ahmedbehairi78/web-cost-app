import { SERVICE_IPC_TYPE } from './serviceContractor.js';

export type ServiceIpcNumberParts = {
  supplierLabel: string;
  seq: number;
  year: number;
};

export type ServiceIpcNumberPeer = {
  referenceNumber?: string | null;
  supplierName?: string | null;
  supplierAccountId?: string | null;
  supplierId?: string | null;
  date?: string | null;
};

function normalizeSupplierKey(name: string): string {
  return String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function sanitizeServiceSupplierLabel(name: string): string {
  return String(name || '').replace(/\s+/g, ' ').trim().replace(/-+/g, '-') || 'مورد';
}

export function yearFromIpcDate(date?: string | null, fallbackYear: number = new Date().getFullYear()): number {
  const m = String(date || '').trim().match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : fallbackYear;
}

/** `مستخلص محمد الشيخ-001-2026` or spaced `مستخلص تامر يسري - 001 -2026`. */
export function parseServiceIpcNumber(referenceNumber: string): ServiceIpcNumberParts | null {
  const raw = String(referenceNumber || '').trim();
  const ar = raw.match(/^مستخلص\s+(.+?)\s*-\s*(\d{1,4})\s*-\s*(\d{4})$/);
  if (ar) {
    return { supplierLabel: ar[1].trim(), seq: parseInt(ar[2], 10), year: parseInt(ar[3], 10) };
  }
  const en = raw.match(/^IPC\s+(.+?)\s*-\s*(\d{1,4})\s*-\s*(\d{4})$/i);
  if (en) {
    return { supplierLabel: en[1].trim(), seq: parseInt(en[2], 10), year: parseInt(en[3], 10) };
  }
  return null;
}

export function formatServiceIpcNumber(supplierName: string, seq: number, year: number): string {
  const label = sanitizeServiceSupplierLabel(supplierName);
  const n = Number.isFinite(seq) && seq > 0 ? Math.floor(seq) : 1;
  return `مستخلص ${label}-${String(n).padStart(3, '0')}-${year}`;
}

export function needsServiceIpcNumber(type: unknown, referenceNumber: unknown): boolean {
  if (String(type ?? '') !== SERVICE_IPC_TYPE) return false;
  return parseServiceIpcNumber(String(referenceNumber ?? '').trim()) == null;
}

function supplierKey(row: {
  supplierName?: string | null;
  supplierAccountId?: string | null;
  supplierId?: string | null;
}): string {
  const account = String(row.supplierAccountId || '').trim();
  if (account) return `acc:${account}`;
  const id = String(row.supplierId || '').trim();
  if (id) return `sup:${id}`;
  return `name:${normalizeSupplierKey(row.supplierName || '')}`;
}

export function nextServiceIpcNumberFromExisting(
  existing: ServiceIpcNumberPeer[],
  target: ServiceIpcNumberPeer & { supplierName: string },
): string {
  const year = yearFromIpcDate(target.date);
  const key = supplierKey(target);
  const nameKey = normalizeSupplierKey(target.supplierName);
  let max = 0;
  for (const row of existing) {
    const parsed = parseServiceIpcNumber(String(row.referenceNumber || ''));
    if (!parsed || parsed.year !== year) continue;
    const sameId = supplierKey(row) === key;
    const sameName = normalizeSupplierKey(parsed.supplierLabel) === nameKey
      || normalizeSupplierKey(row.supplierName || '') === nameKey;
    if (!sameId && !sameName) continue;
    if (parsed.seq > max) max = parsed.seq;
  }
  return formatServiceIpcNumber(target.supplierName, max + 1, year);
}
