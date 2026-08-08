import { isLocalBackend } from './dataBackend';
import { ApiError } from './apiClient';
import { contractsApi } from '../services/local/modulesApi';
import { ensureCoaForJournalEntries } from './localCoaSync';
import { ensureLocalContractExists, ensureLocalProjectExists, nullIfEmpty } from './localEntitySync';
import type { JournalEntry } from '../services/accountingService';

type JournalHeader = {
  projectId?: string | null;
  costCenterId?: string | null;
};

async function isIndirectCostCenterId(costCenterId: string): Promise<boolean> {
  const { costCentersApi } = await import('../services/local/modulesApi');
  const rows = await costCentersApi.list('indirect');
  return rows.some((c) => c.id === costCenterId);
}

/**
 * Local-mode gate before ANY journal post (custody, purchases, cheques, consumption, manual GL, …).
 * Mirrors Firestore master data into SQLite so validation and FK constraints succeed.
 */
export async function prepareLocalJournalPost(
  header: JournalHeader,
  entries: JournalEntry[],
): Promise<void> {
  if (!isLocalBackend) return;

  await ensureCoaForJournalEntries(entries);

  const projectId = nullIfEmpty(header.projectId ?? undefined);
  const costCenterId = nullIfEmpty(header.costCenterId ?? undefined);

  if (projectId) {
    await ensureLocalProjectExists(projectId);
  }
  if (!costCenterId) return;

  // Indirect service centers (HO-*) live in cost_centers — not contracts.
  if (await isIndirectCostCenterId(costCenterId)) return;

  try {
    await contractsApi.get(costCenterId);
    return;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }

  await ensureLocalContractExists(costCenterId, projectId || '');
}
