import { roundMoney } from './money';

/** Subcontractor service classification (still COA 21102). */

export const SERVICE_KINDS = ['works', 'labour', 'equipment', 'vehicles', 'housing'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

export const SERVICE_IPC_KINDS = ['labour', 'equipment', 'vehicles', 'housing'] as const;
export type ServiceIpcKind = (typeof SERVICE_IPC_KINDS)[number];

export const SERVICE_IPC_TYPE = 'service_ipc';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hide raw UUIDs — those are internal ids, not certificate numbers. */
export function displayServiceIpcNumber(referenceNumber?: string | null, fallbackId?: string | null): string {
  const ref = String(referenceNumber ?? '').trim();
  if (ref && !UUID_RE.test(ref)) return ref;
  const id = String(fallbackId ?? '').trim();
  if (id && !UUID_RE.test(id)) return id;
  return '';
}

/** Print / list title. The document number already includes المورد + تسلسل + السنة. */
export function serviceIpcPrintTitle(input: {
  contractorName?: string | null;
  documentNumber?: string | null;
  statusLabel?: string | null;
  language: 'ar' | 'en';
}): string {
  const number = displayServiceIpcNumber(input.documentNumber);
  const status = String(input.statusLabel ?? '').trim();
  if (number && (/^مستخلص\s/.test(number) || /^IPC\s/i.test(number))) {
    return status ? `${number} (${status})` : number;
  }
  const name = String(input.contractorName ?? '').trim();
  const head = input.language === 'ar' ? 'مستخلص' : 'IPC';
  const parts = [head, name, number].filter(Boolean);
  const title = parts.length <= 1 ? head : parts.join(' ');
  return status ? `${title} (${status})` : title;
}

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

export type ServiceIpcSummaryPcts = {
  vatPct: number;
  execGuaranteePct: number;
  whtPct: number;
  labourInsurancePct: number;
  manpowerLevyPct: number;
};

/** Certificate waterfall — withholdings on total works; due = to-date net − advance − previous payments. */
export type ServiceIpcCertificateSummary = {
  previousWorks: number;
  currentWorks: number;
  totalWorks: number;
  vatToDate: number;
  execGuaranteeToDate: number;
  labourInsuranceToDate: number;
  whtToDate: number;
  manpowerLevyToDate: number;
  netAfterDeductions: number;
  advancePaymentRecovery: number;
  previousPayments: number;
  amountDue: number;
  vatPeriod: number;
  execGuaranteePeriod: number;
  labourInsurancePeriod: number;
  whtPeriod: number;
  manpowerLevyPeriod: number;
};

function applyPct(base: number, pct: number): number {
  return roundMoney(base * (Number(pct) || 0) / 100);
}

export function computeServiceIpcCertificateSummary(
  lines: Array<{ previousQty?: number; currentQty?: number; rate?: number }>,
  pcts: ServiceIpcSummaryPcts,
  advancePaymentRecovery = 0,
): ServiceIpcCertificateSummary {
  const previousWorks = roundMoney(
    lines.reduce((s, l) => s + Number(l.previousQty || 0) * Number(l.rate || 0), 0),
  );
  const currentWorks = roundMoney(lines.reduce((s, l) => s + periodLineAmount(l), 0));
  const totalWorks = roundMoney(previousWorks + currentWorks);

  const vatToDate = applyPct(totalWorks, pcts.vatPct);
  const execGuaranteeToDate = applyPct(totalWorks, pcts.execGuaranteePct);
  const labourInsuranceToDate = applyPct(totalWorks, pcts.labourInsurancePct);
  const whtToDate = applyPct(totalWorks, pcts.whtPct);
  const manpowerLevyToDate = applyPct(totalWorks, pcts.manpowerLevyPct);

  const vatPrev = applyPct(previousWorks, pcts.vatPct);
  const execPrev = applyPct(previousWorks, pcts.execGuaranteePct);
  const insPrev = applyPct(previousWorks, pcts.labourInsurancePct);
  const whtPrev = applyPct(previousWorks, pcts.whtPct);
  const levyPrev = applyPct(previousWorks, pcts.manpowerLevyPct);

  const withholdToDate = roundMoney(
    execGuaranteeToDate + labourInsuranceToDate + whtToDate + manpowerLevyToDate,
  );
  const withholdPrev = roundMoney(execPrev + insPrev + whtPrev + levyPrev);
  const netAfterDeductions = roundMoney(totalWorks + vatToDate - withholdToDate);
  const previousPayments = roundMoney(previousWorks + vatPrev - withholdPrev);
  const advance = roundMoney(advancePaymentRecovery);
  const amountDue = roundMoney(netAfterDeductions - advance - previousPayments);

  return {
    previousWorks,
    currentWorks,
    totalWorks,
    vatToDate,
    execGuaranteeToDate,
    labourInsuranceToDate,
    whtToDate,
    manpowerLevyToDate,
    netAfterDeductions,
    advancePaymentRecovery: advance,
    previousPayments,
    amountDue,
    vatPeriod: roundMoney(vatToDate - vatPrev),
    execGuaranteePeriod: roundMoney(execGuaranteeToDate - execPrev),
    labourInsurancePeriod: roundMoney(labourInsuranceToDate - insPrev),
    whtPeriod: roundMoney(whtToDate - whtPrev),
    manpowerLevyPeriod: roundMoney(manpowerLevyToDate - levyPrev),
  };
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
