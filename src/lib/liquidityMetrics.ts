import { AccountCodes } from '../services/accountingService';
import { toFiniteNumber } from './utils';

const isBankCash = (c?: string) => !!c && c.startsWith('121');

function accountCodeNorm(c?: string | number | null): string {
  return String(c ?? '').trim();
}

/** مدين وسيط شيك وارد CH-RECEIVED-*-ISS */
const RECEIVED_CHQ_CLEARING_DEBIT_CODES = new Set([
  AccountCodes.RECEIVED_CHEQUES_CLEARING,
  '12301001', // legacy
  '13101001',
]);

const IPC_CUSTOMER_SIDE_CREDIT_CODES = new Set<string>([
  AccountCodes.RECEIVABLES,
  '11201001',
  AccountCodes.RETENTION_GUARANTEE,
  AccountCodes.WHT_RECEIVABLE,
  AccountCodes.SOCIAL_INSURANCE_RECEIVABLE,
  AccountCodes.MANPOWER_LEVY_RECEIVABLE,
]);

const CHEQUE_REF_RE = /^CH-(RECEIVED|ISSUED)-(.+)-(ISS|CLR)$/i;

/** حقوق ملكية / تمويل — لا تُعد «تحصيلات تشغيلية». */
const NON_OPERATING_COLLECTION_CREDIT_PREFIXES = ['311', '312', '313', '314'] as const;

function isOperatingCollectionCreditCode(code: string): boolean {
  if (IPC_CUSTOMER_SIDE_CREDIT_CODES.has(code)) return true;
  if (code.startsWith('12201')) return true;
  if (code === AccountCodes.ADVANCE_PAYMENT || code.startsWith('21301')) return true;
  return false;
}

function hasNonOperatingFinancingCredit(
  entries: { accountCode: string | number; debit: number; credit: number }[],
): boolean {
  return entries.some(e => {
    const code = accountCodeNorm(e.accountCode);
    return (
      toFiniteNumber(e.credit) > 0 &&
      NON_OPERATING_COLLECTION_CREDIT_PREFIXES.some(p => code.startsWith(p))
    );
  });
}

export interface LiquidityContractSlice {
  id: string;
  projectId: string;
}

/** IPC statuses that count toward billed / uncollected (excludes draft only). */
export const LIQUIDITY_BILLED_STATUSES = ['submitted', 'review', 'approved', 'paid'] as const;

export interface LiquidityBillingSlice {
  contractId: string;
  status: string;
  worksValueExVat?: number;
  vatAmount?: number;
  netPayable?: number;
  retentionAmount?: number;
  execGuaranteeAmount?: number;
}

export interface LiquidityGlTxSlice {
  costCenterId?: string;
  projectId?: string;
  reference?: string;
  entries?: {
    accountCode: string | number;
    debit: number;
    credit: number;
    accountName?: string;
    costCenterId?: string | null;
  }[];
}

export interface LiquidityContractRow<C extends LiquidityContractSlice = LiquidityContractSlice> {
  contract: C;
  totalBilled: number;
  totalCollected: number;
  totalAdvances: number;
  totalRetention: number;
  uncollected: number;
  ipcCollected: number;
}

export function parseChequeRef(ref?: string | null): {
  direction: 'received' | 'issued';
  chequeId: string;
  leg: 'ISS' | 'CLR';
} | null {
  const s = String(ref ?? '').trim();
  const m = s.match(CHEQUE_REF_RE);
  if (!m) return null;
  return {
    direction: m[1].toLowerCase() as 'received' | 'issued',
    chequeId: m[2],
    leg: m[3].toUpperCase() as 'ISS' | 'CLR',
  };
}

export function buildChequeIssueEntryMap(
  glTxs: LiquidityGlTxSlice[],
): Map<string, NonNullable<LiquidityGlTxSlice['entries']>> {
  const map = new Map<string, NonNullable<LiquidityGlTxSlice['entries']>>();
  for (const tx of glTxs) {
    const p = parseChequeRef(tx.reference);
    if (p?.leg === 'ISS') map.set(p.chequeId, tx.entries ?? []);
  }
  return map;
}

export function contractCountByProject(contracts: LiquidityContractSlice[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of contracts) {
    m.set(c.projectId, (m.get(c.projectId) ?? 0) + 1);
  }
  return m;
}

/** قيود مرتبطة بالعقد: مركز تكلفة، أو — إن لم يُحدَّد — مشروع بعقد وحيد فقط (قيود قديمة/شيكات). */
export function glTxsAttributedToContract(
  glTxs: LiquidityGlTxSlice[],
  contract: LiquidityContractSlice,
  countMap: Map<string, number>,
): LiquidityGlTxSlice[] {
  const siblings = countMap.get(contract.projectId) ?? 0;
  return glTxs.filter(tx => {
    if (tx.costCenterId === contract.id) return true;
    if (tx.costCenterId) return false;
    const pid = tx.projectId;
    if (!pid || pid !== contract.projectId) return false;
    return siblings === 1;
  });
}

/** يضم قيد ISS المرتبط بـ CLR منسوب لنفس العقد (عندما يُحدَّد العقد على التحصيل فقط). */
export function glTxsForContractAnalysis(
  glTxs: LiquidityGlTxSlice[],
  contract: LiquidityContractSlice,
  countMap: Map<string, number>,
): LiquidityGlTxSlice[] {
  const direct = glTxsAttributedToContract(glTxs, contract, countMap);
  const directSet = new Set(direct);

  const clrChequeIds = new Set<string>();
  for (const tx of direct) {
    const p = parseChequeRef(tx.reference);
    if (p?.leg === 'CLR') clrChequeIds.add(p.chequeId);
  }
  if (clrChequeIds.size === 0) return direct;

  const paired: LiquidityGlTxSlice[] = [];
  for (const tx of glTxs) {
    if (directSet.has(tx)) continue;
    const p = parseChequeRef(tx.reference);
    if (p?.leg === 'ISS' && clrChequeIds.has(p.chequeId)) paired.push(tx);
  }
  return paired.length ? [...direct, ...paired] : direct;
}

function cashDebitOnBank(entries: { accountCode: string | number; debit: number; credit: number }[]): number {
  return entries
    .filter(e => isBankCash(accountCodeNorm(e.accountCode)) && toFiniteNumber(e.debit) > 0)
    .reduce((s, e) => s + toFiniteNumber(e.debit), 0);
}

function receivedChequeClearingDebit(
  entries: { accountCode: string | number; debit: number; credit: number }[],
): number {
  return entries
    .filter(
      e =>
        RECEIVED_CHQ_CLEARING_DEBIT_CODES.has(accountCodeNorm(e.accountCode)) &&
        toFiniteNumber(e.debit) > 0,
    )
    .reduce((s, e) => s + toFiniteNumber(e.debit), 0);
}

function hasIpcSettlementCredit(entries: { accountCode: string | number; debit: number; credit: number }[]): boolean {
  return entries.some(
    e =>
      IPC_CUSTOMER_SIDE_CREDIT_CODES.has(accountCodeNorm(e.accountCode)) &&
      toFiniteNumber(e.credit) > 0,
  );
}

/** دفعة مقدمة من العميل — 21301001 أو أي ورقة تحت 21301 (8 أرقام). */
function hasAdvancePaymentCredit(entries: { accountCode: string | number; debit: number; credit: number }[]): boolean {
  return entries.some(e => {
    const code = accountCodeNorm(e.accountCode);
    return toFiniteNumber(e.credit) > 0 && (code === AccountCodes.ADVANCE_PAYMENT || code.startsWith('21301'));
  });
}

function hasPureOperatingCollectionCredits(
  entries: { accountCode: string | number; debit: number; credit: number }[],
): boolean {
  const creditLines = entries.filter(e => toFiniteNumber(e.credit) > 0);
  if (creditLines.length === 0) return false;
  return creditLines.every(e => isOperatingCollectionCreditCode(accountCodeNorm(e.accountCode)));
}

function findReceivedChequeIss(
  allTxs: LiquidityGlTxSlice[],
  chequeId: string,
): LiquidityGlTxSlice | undefined {
  return allTxs.find(t => {
    const p = parseChequeRef(t.reference);
    return p?.direction === 'received' && p.leg === 'ISS' && p.chequeId === chequeId;
  });
}

function collectionSourceEntries(
  tx: LiquidityGlTxSlice,
  allTxs: LiquidityGlTxSlice[],
): { accountCode: string | number; debit: number; credit: number }[] {
  const p = parseChequeRef(tx.reference);
  if (p?.direction === 'received' && p.leg === 'CLR') {
    return findReceivedChequeIss(allTxs, p.chequeId)?.entries ?? [];
  }
  return tx.entries ?? [];
}

/**
 * تحصيل نقدي فعلي (دخل البنك/الصندوق): تحصيل مباشر أو CH-RECEIVED-*-CLR بعد ISS تشغيلي.
 * لا يُحسب ISS (لم يدخل النقد بعد) ولا قيود مختلطة (مثل Cr 12201 + Cr 21401).
 */
export function dashboardCollectionAmountForTx(
  tx: LiquidityGlTxSlice,
  allTxs: LiquidityGlTxSlice[] = [],
): number {
  const entries = tx.entries ?? [];
  const p = parseChequeRef(tx.reference);

  if (p?.direction === 'received' && p.leg === 'ISS') return 0;

  if (p?.direction === 'received' && p.leg === 'CLR') {
    if (hasNonOperatingFinancingCredit(entries)) return 0;
    const bankDr = cashDebitOnBank(entries);
    if (bankDr <= 0) return 0;
    const issEntries = findReceivedChequeIss(allTxs, p.chequeId)?.entries ?? [];
    if (hasNonOperatingFinancingCredit(issEntries) || !hasPureOperatingCollectionCredits(issEntries)) {
      return 0;
    }
    return bankDr;
  }

  if (hasNonOperatingFinancingCredit(entries) || !hasPureOperatingCollectionCredits(entries)) {
    return 0;
  }
  const bankDr = cashDebitOnBank(entries);
  if (bankDr > 0) return bankDr;
  return 0;
}

/** entry-only helper — prefer dashboardCollectionAmountForTx with full tx + reference */
export function dashboardCollectionAmount(
  entries: { accountCode: string | number; debit: number; credit: number }[],
): number {
  return dashboardCollectionAmountForTx({ entries });
}

function collectionAmountForContractTx(
  tx: LiquidityGlTxSlice,
  allTxs: LiquidityGlTxSlice[],
): { ipc: number; advance: number; other: number } {
  const amount = dashboardCollectionAmountForTx(tx, allTxs);
  if (amount <= 0) return { ipc: 0, advance: 0, other: 0 };

  const sourceEntries = collectionSourceEntries(tx, allTxs);
  const hasAdv = hasAdvancePaymentCredit(sourceEntries);
  const hasIpcSettle = hasIpcSettlementCredit(sourceEntries);
  if (hasAdv && !hasIpcSettle) return { ipc: 0, advance: amount, other: 0 };
  return { ipc: amount, advance: 0, other: 0 };
}

function billingNetPayable(b: LiquidityBillingSlice): number {
  const stored = toFiniteNumber(b.netPayable);
  if (stored > 0) return stored;
  const gross = toFiniteNumber(b.worksValueExVat) + toFiniteNumber(b.vatAmount);
  const retention = toFiniteNumber(
    b.retentionAmount !== undefined ? b.retentionAmount : b.execGuaranteeAmount,
  );
  return Math.max(0, gross - retention);
}

export function computeLiquidityContractRow<C extends LiquidityContractSlice>(
  contract: C,
  billing: LiquidityBillingSlice[],
  glTxs: LiquidityGlTxSlice[],
  countMap: Map<string, number>,
): LiquidityContractRow<C> {
  const billedDocs = billing.filter(
    b =>
      b.contractId === contract.id &&
      (LIQUIDITY_BILLED_STATUSES as readonly string[]).includes(b.status),
  );
  const totalBilled = billedDocs.reduce(
    (s, b) => s + toFiniteNumber(b.worksValueExVat) + toFiniteNumber(b.vatAmount),
    0,
  );
  const totalNetPayable = billedDocs.reduce((s, b) => s + billingNetPayable(b), 0);
  const totalRetention = billedDocs.reduce(
    (s, b) => s + toFiniteNumber(b.retentionAmount !== undefined ? b.retentionAmount : b.execGuaranteeAmount),
    0,
  );

  const contractTxs = glTxsForContractAnalysis(glTxs, contract, countMap);

  let ipcCollected = 0;
  let clientAdvances = 0;

  for (const tx of contractTxs) {
    const split = collectionAmountForContractTx(tx, glTxs);
    ipcCollected += split.ipc;
    clientAdvances += split.advance;
  }

  /** تحصيلات تشغيلية فقط — IPC + دفعات مقدمة عميل (بدون تمويل جاري شركاء / حقوق ملكية). */
  const totalCollected = ipcCollected + clientAdvances;
  /** netPayable − ipcCollected fallback when no 12201 GL on contract; else ledger balance (includes ISS Cr 12201). */
  const receivablesNet = receivablesBalanceFromContractTxs(contractTxs);
  const uncollectedFromBilling = Math.max(0, totalNetPayable - ipcCollected);
  const uncollected =
    receivablesNet > 0 || hasCustomerReceivableGlActivity(contractTxs)
      ? Math.max(0, receivablesNet)
      : uncollectedFromBilling;

  return {
    contract,
    totalBilled,
    totalCollected,
    totalAdvances: clientAdvances,
    totalRetention,
    uncollected,
    ipcCollected,
  };
}

export function aggregateLiquidityPortfolio(rows: LiquidityContractRow<LiquidityContractSlice>[]): {
  billed: number;
  collected: number;
  ipcCollected: number;
  advances: number;
  retention: number;
  uncollected: number;
} {
  return rows.reduce(
    (acc, r) => ({
      billed: acc.billed + r.totalBilled,
      collected: acc.collected + r.totalCollected,
      ipcCollected: acc.ipcCollected + r.ipcCollected,
      advances: acc.advances + r.totalAdvances,
      retention: acc.retention + r.totalRetention,
      uncollected: acc.uncollected + r.uncollected,
    }),
    { billed: 0, collected: 0, ipcCollected: 0, advances: 0, retention: 0, uncollected: 0 },
  );
}

/** تحصيل IPC نقدي فقط (يستبعد دفعات مقدمة عميل) — KPI لوحة التحكم */
export function dashboardIpcCollectionAmountForTx(
  tx: LiquidityGlTxSlice,
  allTxs: LiquidityGlTxSlice[] = [],
): number {
  const amount = dashboardCollectionAmountForTx(tx, allTxs);
  if (amount <= 0) return 0;
  const sourceEntries = collectionSourceEntries(tx, allTxs);
  if (hasAdvancePaymentCredit(sourceEntries) && !hasIpcSettlementCredit(sourceEntries)) {
    return 0;
  }
  return amount;
}

/** تحصيلات IPC النقدية فقط (بدون دفعات مقدمة) — KPI لوحة التحكم */
export function sumDashboardIpcCollectionsFromGlTxs(glTxs: LiquidityGlTxSlice[]): number {
  return glTxs.reduce((sum, tx) => sum + dashboardIpcCollectionAmountForTx(tx, glTxs), 0);
}

/** إجمالي التحصيلات (IPC + دفعات مقدمة) — تقرير السيولة */
export function sumDashboardCollectionsFromGlTxs(glTxs: LiquidityGlTxSlice[]): number {
  return glTxs.reduce((sum, tx) => sum + dashboardCollectionAmountForTx(tx, glTxs), 0);
}

/** صافي مدين حساب العملاء 12201… (ورقة 8 أرقام) من قائمة القيود */
export function isCustomerReceivableAccountCode(code: string | number | null | undefined): boolean {
  const c = accountCodeNorm(code);
  return c === AccountCodes.RECEIVABLES || (c.startsWith('12201') && c.length === 8);
}

export function receivablesBalanceFromGlTxs(glTxs: LiquidityGlTxSlice[]): number {
  let balance = 0;
  for (const tx of glTxs) {
    for (const e of tx.entries ?? []) {
      if (isCustomerReceivableAccountCode(e.accountCode)) {
        balance += toFiniteNumber(e.debit) - toFiniteNumber(e.credit);
      }
    }
  }
  return balance;
}

export function receivablesBalanceFromContractTxs(contractTxs: LiquidityGlTxSlice[]): number {
  return receivablesBalanceFromGlTxs(contractTxs);
}

export function hasCustomerReceivableGlActivity(glTxs: LiquidityGlTxSlice[]): boolean {
  for (const tx of glTxs) {
    for (const e of tx.entries ?? []) {
      if (!isCustomerReceivableAccountCode(e.accountCode)) continue;
      if (toFiniteNumber(e.debit) > 0 || toFiniteNumber(e.credit) > 0) return true;
    }
  }
  return false;
}

/** KPI «مستخلصات تحت التحصيل» — نفس منطق لوحة التحكم */
export function computePortfolioPendingBilling(
  glTxs: LiquidityGlTxSlice[],
  contractUncollectedSum: number,
): number {
  if (hasCustomerReceivableGlActivity(glTxs)) {
    return Math.max(0, receivablesBalanceFromGlTxs(glTxs));
  }
  return contractUncollectedSum;
}

/** صافي مدين حسابات 121… (نقدية وبنوك) — KPI تقرير السيولة */
export function cashAndBankBalanceFromGlTxs(glTxs: LiquidityGlTxSlice[]): number {
  let balance = 0;
  for (const tx of glTxs) {
    for (const e of tx.entries ?? []) {
      const code = accountCodeNorm(e.accountCode);
      if (isBankCash(code)) {
        balance += toFiniteNumber(e.debit) - toFiniteNumber(e.credit);
      }
    }
  }
  return balance;
}
