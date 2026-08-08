import { resolveEntryCostCenterId } from './costCenterAttribution';

export type GlUiLang = 'ar' | 'en';

type ContractLite = {
  id: string;
  contractName?: string;
  contractNameEn?: string | null;
  contractNumber?: string;
  projectId?: string;
};

type ProjectLite = {
  id: string;
  projectName?: string;
  projectNameEn?: string | null;
  projectCode?: string;
};

/** Journal header: show `descriptionEn` in English UI when set; else fall back. */
export function resolveTxDescription(
  tx: { description?: string | null; descriptionEn?: string | null },
  language: string,
): string {
  const en =
    tx.descriptionEn != null && String(tx.descriptionEn).trim() !== ''
      ? String(tx.descriptionEn).trim()
      : '';
  const ar = String(tx.description ?? '').trim();
  if (language === 'en') return en || ar;
  return ar || en;
}

export interface TxWithCostCenter {
  costCenterId?: string | null;
  projectId?: string | null;
  contract?: ContractLite | null;
  project?: ProjectLite | null;
}

type IndirectCenterLite = {
  id: string;
  code: string;
  name: string;
  nameEn?: string | null;
};

/** Cost center = contract within project, or indirect service center (HO-…). */
export function resolveCostCenterLine(
  tx: TxWithCostCenter,
  contractsMap: Map<string, ContractLite>,
  projectsMap: Map<string, ProjectLite>,
  language: string,
  indirectCentersMap?: Map<string, IndirectCenterLite>,
): string {
  const lang: GlUiLang = language === 'en' ? 'en' : 'ar';
  const ccId = tx.costCenterId ? String(tx.costCenterId) : '';
  const indirect = ccId && indirectCentersMap?.get(ccId);
  if (indirect) {
    const name = lang === 'en' ? indirect.nameEn?.trim() || indirect.name : indirect.name;
    return `${indirect.code} — ${name}`;
  }
  const c = tx.contract ?? (ccId ? contractsMap.get(ccId) : undefined);
  if (!c) {
    if (tx.costCenterId) return `#${tx.costCenterId}`;
    return '-';
  }

  const projId = (tx.contract?.projectId ?? c.projectId) || tx.projectId || undefined;
  const p = tx.project ?? (projId ? projectsMap.get(String(projId)) : undefined);
  const pname =
    lang === 'en'
      ? p?.projectNameEn != null && String(p.projectNameEn).trim() !== ''
        ? String(p.projectNameEn)
        : p?.projectName ?? p?.projectCode ?? '...'
      : p?.projectName ?? p?.projectCode ?? '...';
  const cname =
    lang === 'en'
      ? c.contractNameEn != null && String(c.contractNameEn).trim() !== ''
        ? String(c.contractNameEn)
        : c.contractName ?? c.contractNumber
      : c.contractName ?? c.contractNumber;
  const name = cname || c.contractNumber || '';
  return `${name} (${pname})`;
}

/** Per journal line — uses line `costCenterId` when set, else transaction header. */
export function resolveEntryCostCenterLine(
  entry: { costCenterId?: string | null },
  tx: TxWithCostCenter,
  contractsMap: Map<string, ContractLite>,
  projectsMap: Map<string, ProjectLite>,
  language: string,
  indirectCentersMap?: Map<string, IndirectCenterLite>,
): string {
  const ccId = resolveEntryCostCenterId(entry, tx.costCenterId);
  if (!ccId) return '-';
  return resolveCostCenterLine(
    { ...tx, costCenterId: ccId },
    contractsMap,
    projectsMap,
    language,
    indirectCentersMap,
  );
}

type CoaAccountLite = {
  accountCode: string;
  accountName: string;
  accountNameEn?: string | null;
};

type JournalEntryLite = {
  accountCode: string;
  accountName?: string;
  debit: number;
  credit: number;
};

/** Resolve display name from COA or journal line fallback. */
export function resolveAccountDisplayName(
  accountCode: string,
  accounts: CoaAccountLite[],
  entryAccountName: string | undefined,
  language: string,
): string {
  const code = String(accountCode).trim();
  const acc = accounts.find(a => String(a.accountCode).trim() === code);
  if (acc) {
    return language === 'ar'
      ? acc.accountName
      : (acc.accountNameEn?.trim() || acc.accountName);
  }
  return String(entryAccountName ?? '').trim() || code;
}

export type JournalSide = 'debit' | 'credit';

/** Side of a statement line — debit lines are balanced by credit lines and vice versa. */
export function resolveEntrySide(entry: { debit?: number; credit?: number }): JournalSide | null {
  const debit = Number(entry.debit) || 0;
  const credit = Number(entry.credit) || 0;
  if (debit > 0) return 'debit';
  if (credit > 0) return 'credit';
  return null;
}

/**
 * Balancing accounts for one statement line (deduped by account code).
 * `side` = the side of the line being displayed; only the opposite side is returned,
 * so a multi-line journal does not list same-side accounts as counterparts.
 */
export function resolveCounterpartEntries(
  entries: JournalEntryLite[],
  selectedAccountCode: string,
  accounts: CoaAccountLite[],
  language: string,
  side?: JournalSide | null,
): { code: string; name: string }[] {
  const selected = String(selectedAccountCode).trim();
  const seen = new Set<string>();
  const result: { code: string; name: string }[] = [];

  for (const e of entries) {
    const code = String(e.accountCode ?? '').trim();
    if (!code || code === selected) continue;
    const debit = Number(e.debit) || 0;
    const credit = Number(e.credit) || 0;
    if (debit <= 0 && credit <= 0) continue;
    if (side === 'debit' && credit <= 0) continue;
    if (side === 'credit' && debit <= 0) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    result.push({
      code,
      name: resolveAccountDisplayName(code, accounts, e.accountName, language),
    });
  }
  return result;
}

export function formatCounterpartLine(
  counterparts: { code: string; name: string }[],
): string {
  return counterparts.map(c => `${c.code} ${c.name}`).join(' · ');
}
