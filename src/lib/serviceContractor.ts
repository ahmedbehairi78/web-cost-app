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
  /**
   * المسدد = actual cash Dr on the contractor GL account (bank / cash / custody).
   * Pass 0 when none; never omit to fall back to previous works.
   */
  actualPreviousPayments?: number,
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
  // المسدد is never estimated from previous works — only GL cash Dr (or 0).
  const previousPayments = (actualPreviousPayments != null && Number.isFinite(Number(actualPreviousPayments)))
    ? roundMoney(Math.max(0, Number(actualPreviousPayments)))
    : 0;
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

export type ContractorCashGlTx = {
  isDeleted?: boolean;
  costCenterId?: string | null;
  projectId?: string | null;
  entries?: Array<{
    accountCode?: string;
    debit?: unknown;
    credit?: unknown;
    costCenterId?: string | null;
  }>;
};

/**
 * Cash-like payment sources posted against a contractor:
 * bank / transfer / cash fund / custody (121…) or issued-cheque ISS (21601…).
 */
export function isContractorCashPaymentSourceCode(code: string): boolean {
  const c = String(code || '').trim();
  if (c.startsWith('121')) return true;
  if (c.startsWith('21601')) return true;
  return false;
}

function glMoney(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (value && typeof value === 'object' && typeof (value as { toNumber?: () => number }).toNumber === 'function') {
    const n = Number((value as { toNumber: () => number }).toNumber());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** GL list endpoints return an array; tolerate a wrapped `{ data }` payload. */
export function asGlTransactionList(raw: unknown): ContractorCashGlTx[] {
  if (Array.isArray(raw)) return raw as ContractorCashGlTx[];
  if (raw && typeof raw === 'object') {
    const o = raw as { data?: unknown; items?: unknown };
    if (Array.isArray(o.data)) return o.data as ContractorCashGlTx[];
    if (Array.isArray(o.items)) return o.items as ContractorCashGlTx[];
  }
  return [];
}

/** Line cost center, else journal header — matches statement attribution. */
function resolveContractorDebitCostCenter(
  entry: { costCenterId?: string | null },
  transactionCostCenterId?: string | null,
): string {
  const line = String(entry.costCenterId ?? '').trim();
  if (line) return line;
  return String(transactionCostCenterId ?? '').trim();
}

export type ContractorCashPaymentOptions = {
  /** Scope unallocated (no-CC) payments that carry a projectId. */
  projectIds?: string[];
};

/**
 * المسدد = Σ cash debit lines on the contractor leaf:
 * - CC matches IPC cost center(s), or
 * - no CC (typical bank transfer without contract) — counted once; if the journal
 *   has projectId and projectIds were passed, project must match.
 * Prefer `glApi.contractorCashPayments` in the UI.
 */
export function sumContractorCashPaymentsFromGl(
  txs: unknown,
  supplierAccountCode: string,
  costCenterIds: string[],
  options?: ContractorCashPaymentOptions,
): number {
  const code = String(supplierAccountCode || '').trim();
  const centers = new Set(costCenterIds.map((id) => String(id).trim()).filter(Boolean));
  const projects = new Set((options?.projectIds ?? []).map((id) => String(id).trim()).filter(Boolean));
  if (!code || centers.size === 0) return 0;
  let total = 0;
  for (const tx of asGlTransactionList(txs)) {
    if (tx.isDeleted) continue;
    const entries = tx.entries ?? [];
    const hasCashSource = entries.some(
      (e) => glMoney(e.credit) > 0 && isContractorCashPaymentSourceCode(String(e.accountCode || '')),
    );
    if (!hasCashSource) continue;
    for (const e of entries) {
      if (String(e.accountCode || '').trim() !== code) continue;
      const debit = glMoney(e.debit);
      if (debit <= 0) continue;
      const cc = resolveContractorDebitCostCenter(e, tx.costCenterId);
      if (cc) {
        if (centers.has(cc)) total += debit;
        continue;
      }
      const txProject = String(tx.projectId ?? '').trim();
      if (txProject && projects.size > 0 && !projects.has(txProject)) continue;
      total += debit;
    }
  }
  return roundMoney(total);
}

/** Resolve 8-digit contractor COA code from picker id, suppliers.supplierId, or a raw code. */
export function resolveContractorAccountCode(
  accounts: Array<{ id?: string; accountCode?: string; supplierId?: string | null }>,
  supplierRef: string,
): string {
  const ref = String(supplierRef || '').trim();
  if (!ref) return '';
  const byId = accounts.find((a) => a.id === ref);
  if (byId) return String(byId.accountCode || '').trim();
  const bySupplier = accounts.find((a) => String(a.supplierId || '') === ref);
  if (bySupplier) return String(bySupplier.accountCode || '').trim();
  if (/^\d{8}$/.test(ref)) return ref;
  return '';
}
