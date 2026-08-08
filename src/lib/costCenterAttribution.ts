/** Resolve effective cost center for a journal line (line override or transaction header). */
export function resolveEntryCostCenterId(
  entry: { costCenterId?: string | null },
  transactionCostCenterId?: string | null,
): string | null {
  const line = String(entry.costCenterId ?? '').trim();
  if (line) return line;
  const header = String(transactionCostCenterId ?? '').trim();
  return header || null;
}

export function transactionMatchesCostCenterFilter(
  transaction: {
    costCenterId?: string | null;
    entries?: Array<{ costCenterId?: string | null }>;
  },
  contractOrCenterId: string,
): boolean {
  const target = String(contractOrCenterId).trim();
  if (!target) return true;
  if (String(transaction.costCenterId ?? '').trim() === target) return true;
  return (transaction.entries ?? []).some(
    (e) => resolveEntryCostCenterId(e, transaction.costCenterId) === target,
  );
}

export function filterEntriesForCostCenter<T extends { costCenterId?: string | null }>(
  entries: T[] | undefined,
  transactionCostCenterId: string | null | undefined,
  contractOrCenterId: string | 'all',
): T[] {
  if (!entries?.length) return [];
  if (contractOrCenterId === 'all') return entries;
  const target = String(contractOrCenterId).trim();
  return entries.filter(
    (e) => resolveEntryCostCenterId(e, transactionCostCenterId) === target,
  );
}
