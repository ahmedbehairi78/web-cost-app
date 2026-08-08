import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ApiError } from './apiClient';
import { isLocalBackend } from './dataBackend';
import { contractsApi, projectsApi } from '../services/local/modulesApi';

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof ApiError && /UNIQUE constraint failed/i.test(error.message);
}

export type LocalProjectHint = {
  projectName?: string;
  projectCode?: string;
  clientName?: string;
  budget?: number;
};

export type LocalContractHint = {
  projectId?: string;
  contractName?: string;
  contractNumber?: string;
  contractValue?: number;
  startDate?: string;
  endDate?: string;
};

/** Mirror a Firestore project into SQLite when missing (required for purchase_transactions FK). */
export async function ensureLocalProjectExists(
  projectId: string,
  hint?: LocalProjectHint,
): Promise<void> {
  if (!projectId) return;
  try {
    await projectsApi.get(projectId);
    return;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }

  let data: Record<string, unknown> = {};
  if (!isLocalBackend) {
    const snap = await getDoc(doc(db, 'projects', projectId));
    if (snap.exists()) data = snap.data() as Record<string, unknown>;
  }

  const projectName = hint?.projectName || String(data.projectName || projectId);
  try {
    await projectsApi.create({
      id: projectId,
      projectCode: hint?.projectCode || String(data.projectCode || `PRJ-${projectId.slice(0, 8)}`),
      projectName,
      clientName: hint?.clientName || String(data.clientName || projectName),
      status: 'active',
      budget: Number(hint?.budget ?? data.budget ?? 0),
      isDeleted: data.isDeleted === true,
    } as Parameters<typeof projectsApi.create>[0] & { budget: number });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }
}

/** Mirror a Firestore contract into SQLite when missing (required for IPC purchase FK). */
export async function ensureLocalContractExists(
  contractId: string,
  projectId: string,
  hint?: LocalContractHint,
): Promise<void> {
  if (!contractId) return;
  try {
    await contractsApi.get(contractId);
    return;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }

  let data: Record<string, unknown> = {};
  if (!isLocalBackend) {
    const snap = await getDoc(doc(db, 'contracts', contractId));
    if (!snap.exists()) return;
    data = snap.data() as Record<string, unknown>;
  } else if (!hint) {
    // Local mode without Firestore read — minimal stub for FK constraints.
    if (!String(projectId ?? '').trim()) return;
    try {
      await contractsApi.create({
        id: contractId,
        projectId,
        contractName: contractId,
        contractNumber: contractId.slice(0, 8),
        contractValue: 0,
        startDate: '',
        isDeleted: false,
      } as Parameters<typeof contractsApi.create>[0]);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
    return;
  }

  try {
    await contractsApi.create({
      id: contractId,
      projectId: String(hint?.projectId || data.projectId || projectId),
      contractName: String(hint?.contractName || data.contractName || data.contractNumber || contractId),
      contractNumber: String(hint?.contractNumber || data.contractNumber || contractId.slice(0, 8)),
      contractValue: Number(hint?.contractValue ?? data.contractValue ?? 0),
      startDate: String(hint?.startDate || data.startDate || ''),
      endDate: typeof (hint?.endDate ?? data.endDate) === 'string' ? (hint?.endDate ?? data.endDate) as string : undefined,
      isDeleted: data.isDeleted === true,
    } as Parameters<typeof contractsApi.create>[0]);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }
}

/** Normalize optional FK ids for SQLite inserts (empty string → null). */
export function nullIfEmpty(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

export type LocalBoqItemHint = {
  projectId?: string;
  contractId?: string;
  itemCode?: string;
  description?: string;
  unit?: string;
  chapterCode?: string;
  chapterName?: string;
  workTypeCode?: string;
  sectionCode?: string;
  sectionName?: string;
  tenderQty?: number;
  unitRateTotal?: number;
  tenderAmount?: number;
  expectedDuration?: number;
  startDate?: string;
};

/** Mirror a Firestore BOQ item into SQLite (required for boq_item_materials FK). */
export async function ensureLocalBoqItemExists(
  boqItemId: string,
  hint?: LocalBoqItemHint,
): Promise<void> {
  if (!boqItemId || !isLocalBackend) return;

  const { boqApi } = await import('../services/local/modulesApi');
  try {
    await boqApi.get(boqItemId);
    return;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }

  let data: Record<string, unknown> = {};
  const snap = await getDoc(doc(db, 'boq_items', boqItemId));
  if (snap.exists()) data = snap.data() as Record<string, unknown>;

  const projectId = String(hint?.projectId || data.projectId || '').trim();
  const contractId = String(hint?.contractId || data.contractId || '').trim();
  if (!projectId) {
    throw new Error('BOQ item has no project — sync project first.');
  }

  await ensureLocalProjectExists(projectId);
  if (contractId) {
    await ensureLocalContractExists(contractId, projectId);
  }

  const itemCode = String(hint?.itemCode || data.itemCode || '').trim();
  const description = String(hint?.description || data.description || '').trim();
  const unit = String(hint?.unit || data.unit || '').trim();
  if (!itemCode || !description || !unit) {
    throw new Error('BOQ item is missing required fields (code, description, unit).');
  }

  try {
    await boqApi.create({
      id: boqItemId,
      projectId,
      contractId: contractId || undefined,
      chapterCode: String(hint?.chapterCode || data.chapterCode || ''),
      chapterName: String(hint?.chapterName || data.chapterName || ''),
      workTypeCode: String(hint?.workTypeCode || data.workTypeCode || ''),
      sectionCode: String(hint?.sectionCode || data.sectionCode || ''),
      sectionName: String(hint?.sectionName || data.sectionName || ''),
      itemCode,
      description,
      unit,
      tenderQty: Number(hint?.tenderQty ?? data.tenderQty ?? data.quantity ?? 0),
      rateMaterials: Number(data.rateMaterials ?? 0),
      rateLabour: Number(data.rateLabour ?? 0),
      rateEquipment: Number(data.rateEquipment ?? 0),
      rateDirect: Number(data.rateDirect ?? 0),
      rateOverheadPct: Number(data.rateOverheadPct ?? 10),
      rateProfitPct: Number(data.rateProfitPct ?? 12),
      unitRateTotal: Number(hint?.unitRateTotal ?? data.unitRateTotal ?? data.unitRate ?? 0),
      tenderAmount: Number(hint?.tenderAmount ?? data.tenderAmount ?? 0),
      expectedDuration: Number(hint?.expectedDuration ?? data.expectedDuration ?? 0),
      startDate: String(hint?.startDate || data.startDate || ''),
      isDeleted: data.isDeleted === true,
    } as Parameters<typeof boqApi.create>[0]);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }
}
