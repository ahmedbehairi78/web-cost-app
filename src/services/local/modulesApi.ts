import type { AppUser, BillingRecord, BOQItem, MosCertificate, MosExtract, Project, Supplier, Transaction, VariationOrder } from '../../types';
import { apiClient } from '../../lib/apiClient';
import { createCrudApi } from './crudApi';
import {
  offlinePost,
  offlinePatch,
  offlinePut,
  offlineDelete,
  NetworkQueuedError,
} from '../../lib/offline/offlineWrite';

export { NetworkQueuedError };

function buildQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.append(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const projectsApi = createCrudApi<Project>('/projects');
export const contractsApi = createCrudApi('/contracts');
export const boqApi = {
  ...createCrudApi<BOQItem>('/boq-items'),
  create: (data: Partial<BOQItem>, opts?: { quiet?: boolean }) =>
    offlinePost<BOQItem>('/boq-items', data, {
      opType: 'boq.create',
      opClass: 'safe_save',
      summary: 'Create BOQ item',
      quiet: opts?.quiet,
    }),
  update: (id: string, data: Partial<BOQItem>, opts?: { quiet?: boolean }) =>
    offlinePut<BOQItem>(`/boq-items/${encodeURIComponent(id)}`, data, {
      opType: 'boq.update',
      opClass: 'safe_save',
      summary: `Update BOQ ${id}`,
      quiet: opts?.quiet,
    }),
  remove: (id: string) =>
    offlineDelete<BOQItem>(`/boq-items/${encodeURIComponent(id)}`, {
      opType: 'boq.delete',
      opClass: 'safe_save',
      summary: `Delete BOQ ${id}`,
    }),
};
export const suppliersApi = {
  ...createCrudApi<Supplier>('/suppliers'),
  importOpening: (body: {
    date: string;
    rows: Array<{
      type: 'supplier' | 'subcontractor';
      name: string;
      nameEn?: string;
      taxNumber?: string;
      phone?: string;
      address?: string;
      accountCode?: string;
      openingBalance: number;
    }>;
  }) =>
    apiClient.post<{
      created: number;
      skipped: number;
      openingPosted: number;
      openingSkipped: number;
      errors: string[];
      transactionId?: string;
      reference?: string;
      totalAmount?: number;
    }>('/suppliers/opening-import', body),
};
export const chartOfAccountsApi = {
  ...createCrudApi('/chart-of-accounts'),
  ensureMissing: (data: {
    codes?: string[];
    extras?: Array<{
      accountCode: string;
      accountName?: string;
      accountNameEn?: string;
      parentCode?: string;
      type?: string;
      isGroup?: boolean;
      status?: string;
      projectId?: string;
      supplierId?: string;
    }>;
  }) => apiClient.post<{ checked: number; added: number }>('/gl/coa/ensure-missing', data),
  syncBatch: (accounts: unknown[]) =>
    apiClient.post<{ synced: number; updated: number }>('/gl/coa/sync-batch', { accounts }),
};
export const purchaseTransactionsApi = {
  ...createCrudApi('/purchase-transactions'),
  create: (data: unknown) =>
    offlinePost<Record<string, unknown>>('/purchase-transactions', data, {
      opType: 'purchase_tx.create',
      opClass: 'safe_save',
      summary: 'Purchase / IPC draft',
    }),
  update: (id: string, data: unknown) =>
    offlinePut<Record<string, unknown>>(`/purchase-transactions/${encodeURIComponent(id)}`, data, {
      opType: 'purchase_tx.update',
      opClass: 'safe_save',
      summary: `Update purchase ${id}`,
    }),
  /**
   * Atomic invoice: GL + purchase row + optional warehouse stock (confirm_required offline).
   * Do not call glApi.createTransaction separately for purchase invoices — orphans the list.
   */
  postInvoice: (data: unknown) =>
    offlinePost<Record<string, unknown>>('/purchase-transactions/post-invoice', data, {
      opType: 'purchase_invoice.post',
      opClass: 'confirm_required',
      summary: 'Post purchase invoice',
    }),
  approve: (id: string) =>
    offlinePost<Record<string, unknown>>(`/purchase-transactions/${encodeURIComponent(id)}/approve`, {}, {
      opType: 'purchase_tx.approve',
      opClass: 'confirm_required',
      summary: `Approve IPC ${id}`,
    }),
};

export const custodySettlementsApi = {
  ...createCrudApi('/custody-settlements'),
  create: (data: unknown) =>
    offlinePost<Record<string, unknown>>('/custody-settlements', data, {
      opType: 'custody.create',
      opClass: 'safe_save',
      summary: 'Custody settlement draft',
    }),
  update: (id: string, data: unknown) =>
    offlinePut<Record<string, unknown>>(`/custody-settlements/${encodeURIComponent(id)}`, data, {
      opType: 'custody.update',
      opClass: 'safe_save',
      summary: `Update custody ${id}`,
    }),
  approve: (id: string) =>
    offlinePost<Record<string, unknown>>(`/custody-settlements/${encodeURIComponent(id)}/approve`, {}, {
      opType: 'custody.approve',
      opClass: 'confirm_required',
      summary: `Approve custody ${id}`,
    }),
};

export const billingApi = {
  list: (contractId?: string) => apiClient.get<BillingRecord[]>(`/billing${contractId ? `?contractId=${contractId}` : ''}`),
  create: (data: unknown) =>
    offlinePost<BillingSaveResponse>('/billing', data, {
      opType: 'billing.create',
      opClass: 'safe_save',
      summary: 'Client IPC save',
    }),
  update: (id: string, data: unknown) =>
    offlinePut<BillingSaveResponse>(`/billing/${encodeURIComponent(id)}`, data, {
      opType: 'billing.update',
      opClass: 'safe_save',
      summary: `Update IPC ${id}`,
    }),
  remove: (id: string) => apiClient.delete(`/billing/${encodeURIComponent(id)}`),
  patchStatus: (id: string, status: string) =>
    apiClient.patch<BillingRecord>(`/billing/${encodeURIComponent(id)}/status`, { status }),
  revertToDraft: (id: string) => apiClient.post(`/billing/${id}/revert-to-draft`),
  approve: (id: string) =>
    offlinePost<BillingRecord>(`/billing/${encodeURIComponent(id)}/approve`, {}, {
      opType: 'billing.approve',
      opClass: 'confirm_required',
      summary: `Approve client IPC ${id}`,
    }),
  journalPreview: (id: string) =>
    apiClient.get<{
      entries: Array<{ accountCode: string; accountName?: string; debit: number; credit: number }>;
      reference: string;
      description: string;
      billingNumber: string;
      status: string;
    }>(`/billing/${encodeURIComponent(id)}/journal-preview`),
};

export interface DocumentRegistryRecord {
  id: string;
  docType: 'mos' | 'ipc' | string;
  sourceModule: string;
  sourceEntityId: string;
  documentNo: string;
  projectId?: string | null;
  contractId?: string | null;
  documentDate?: string | null;
  status: string;
  amount?: number | null;
  phase?: string | null;
  needsAction: boolean;
  actionKind?: string | null;
  project?: { projectName?: string; projectCode?: string } | null;
  contract?: { contractName?: string; contractNumber?: string } | null;
}

export const documentRegistryApi = {
  list: (params?: {
    projectId?: string;
    contractId?: string;
    docType?: string;
    status?: string;
    inbox?: boolean;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.projectId) q.set('projectId', params.projectId);
    if (params?.contractId) q.set('contractId', params.contractId);
    if (params?.docType) q.set('docType', params.docType);
    if (params?.status) q.set('status', params.status);
    if (params?.inbox) q.set('inbox', 'true');
    if (params?.limit != null) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiClient.get<DocumentRegistryRecord[]>(`/document-registry${qs ? `?${qs}` : ''}`);
  },
  timeline: (contractId: string) =>
    apiClient.get<{
      contractId: string;
      events: Array<{
        id: string;
        docType: string;
        sourceEntityId: string;
        documentNo: string;
        documentDate?: string | null;
        status: string;
        phase?: string | null;
        amount?: number | null;
        needsAction: boolean;
        actionKind?: string | null;
      }>;
    }>(`/document-registry/timeline?contractId=${encodeURIComponent(contractId)}`),
  contractCycle: (contractId: string) =>
    apiClient.get<ContractDocumentCycleSummary>(
      `/document-registry/contract-cycle?contractId=${encodeURIComponent(contractId)}`,
    ),
  contractProgress: (contractId: string) =>
    apiClient.get<ContractProgressSummary>(
      `/document-registry/contract-progress?contractId=${encodeURIComponent(contractId)}`,
    ),
  backfill: () => apiClient.post<{ ok: boolean; mos: number; ipc: number; vo: number }>('/document-registry/backfill', {}),
};

export type ContractProgressRow = {
  boqItemId: string;
  itemCode: string;
  description: string;
  unit: string;
  tenderQty: number;
  mosEquivalentQty: number;
  ipcBilledQty: number;
  cumulativeQty: number;
  progressPct: number;
  exceedsTender: boolean;
};

export type ContractProgressSummary = {
  contractId: string;
  itemCount: number;
  rows: ContractProgressRow[];
  totals: {
    tenderQty: number;
    mosEquivalentQty: number;
    ipcBilledQty: number;
    cumulativeQty: number;
    progressPct: number;
    itemsExceedingTender: number;
  };
};

export type ContractDocumentCycleSummary = {
  contractId: string;
  mos: { total: number; approved: number; pending: number; latestNo: string | null };
  vo: { total: number; approved: number; pending: number; latestNo: string | null };
  ipc: { total: number; approved: number; pending: number; latestNo: string | null; billedAmount: number };
  pendingActions: number;
  suggestedNextStep: 'mos' | 'vo' | 'ipc' | 'none';
};

export type BillingSaveResponse = BillingRecord & {
  boqQuantityWarnings?: Array<{
    boqItemId: string;
    itemCode: string;
    description: string;
    tenderQty: number;
    totalQty: number;
    overBy: number;
  }>;
};

export interface GlTransactionsQuery {
  year?: number;
  dateFrom?: string;
  dateTo?: string;
  projectIds?: string[];
  accountFrom?: string;
  accountTo?: string;
  limit?: number;
}

function buildGlTransactionsQuery(params: GlTransactionsQuery): string {
  const q = new URLSearchParams();
  if (params.year != null) q.set('year', String(params.year));
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.projectIds?.length) q.set('projectIds', params.projectIds.join(','));
  if (params.accountFrom) q.set('accountFrom', params.accountFrom);
  if (params.accountTo) q.set('accountTo', params.accountTo);
  q.set('limit', String(params.limit ?? 500));
  return q.toString();
}

export const glApi = {
  transactions: (year?: number, limit = 500) =>
    apiClient.get<Transaction[]>(`/gl/transactions?${buildGlTransactionsQuery({ year, limit })}`),
  transactionsQuery: (params: GlTransactionsQuery) =>
    apiClient.get<Transaction[]>(`/gl/transactions?${buildGlTransactionsQuery(params)}`),
  getTransaction: (id: string) => apiClient.get<Transaction>(`/gl/transactions/${id}`),
  transactionByReference: (reference: string) =>
    apiClient.get<Transaction>(`/gl/transactions/by-reference?reference=${encodeURIComponent(reference)}`),
  hasActiveReversal: (reversesReference: string) =>
    apiClient.get<{ exists: boolean }>(
      `/gl/transactions/has-reversal?reversesReference=${encodeURIComponent(reversesReference)}`,
    ),
  createTransaction: (data: unknown) =>
    offlinePost<Transaction>('/gl/transactions', data, {
      opType: 'gl.create_transaction',
      opClass: 'confirm_required',
      summary: 'GL journal post',
    }),
  deleteTransaction: (id: string) => apiClient.delete(`/gl/transactions/${id}`),
  /** Server business calendar today (Africa/Cairo) — ignore device date when posting. */
  businessToday: () =>
    apiClient.get<{ date: string; timeZone: string }>('/gl/business-today'),
};

export const reportsApi = {
  dashboard: () => apiClient.get('/reports/dashboard'),
  trialBalance: () => apiClient.get('/reports/trial-balance'),
  boqCostBreakdown: (params: {
    projectId?: string;
    contractId?: string;
    level?: 'project' | 'contract' | 'boq_item';
    dateFrom?: string;
    dateTo?: string;
  } = {}) =>
    apiClient.get<BoqCostBreakdownResponse>(`/reports/boq-cost-breakdown${buildQuery({
      projectId: params.projectId && params.projectId !== 'all' ? params.projectId : undefined,
      contractId: params.contractId && params.contractId !== 'all' ? params.contractId : undefined,
      level: params.level,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    })}`),
};

export type BoqCostLevel = 'project' | 'contract' | 'boq_item';

export type BoqCostBreakdownRow = {
  projectId: string;
  projectName: string;
  projectCode: string;
  contractId?: string;
  contractName?: string;
  contractNumber?: string;
  boqItemId?: string;
  itemCode?: string;
  boqDescription?: string;
  chapterCode?: string;
  sectionCode?: string;
  directCost: number;
  indirectCost: number;
  totalCost: number;
};

export type BoqCostBreakdownResponse = {
  level: BoqCostLevel;
  rows: BoqCostBreakdownRow[];
  totals: { directCost: number; indirectCost: number; totalCost: number };
};

// ─── مستخلصات التشوين (Material On-Site — MOS) ──────────────────────────────────

export const mosExtractsApi = {
  list: (params: { contractId?: string; boqItemId?: string; status?: string } = {}) =>
    apiClient.get<MosExtract[]>(`/mos-extracts${buildQuery(params)}`),

  create: (data: {
    firestoreId?: string;
    contractId: string;
    boqItemId: string;
    suppliedQuantity: number;
    onSitePercentage: number;
    unitPrice: number;
    deliveryNoteRef?: string;
    extractDate?: string;
    notes?: string;
  }) => apiClient.post<MosExtract>('/mos-extracts', data),

  approve: (id: string) => apiClient.post<MosExtract>(`/mos-extracts/${id}/approve`, {}),

  boqSummary: (boqItemId: string, contractId: string) =>
    apiClient.get<{ totalEquivalentQty: number; approvedCount: number; items: MosExtract[] }>(
      `/mos-extracts/boq-summary${buildQuery({ boqItemId, contractId })}`,
    ),
};

export const mosCertificatesApi = {
  list: (params: { contractId?: string; status?: string } = {}) =>
    apiClient.get<MosCertificate[]>(`/mos-certificates${buildQuery(params)}`),

  priorSummary: (contractId: string) =>
    apiClient.get<{
      priorEquivalentByBoqItemId: Record<string, number>;
      priorSuppliedByBoqItemId: Record<string, number>;
    }>(`/mos-certificates/prior-summary${buildQuery({ contractId })}`),

  equivalentMap: (contractId: string) =>
    apiClient.get<{ equivalent: Record<string, number>; supplied: Record<string, number> }>(
      `/mos-certificates/equivalent-map${buildQuery({ contractId })}`,
    ),

  create: (data: {
    contractId: string;
    extractDate?: string;
    deliveryNoteRef?: string;
    notes?: string;
    lines: {
      boqItemId: string;
      suppliedQtyThisPeriod: number;
      onSitePercentage: number;
      unitPrice: number;
    }[];
  }) =>
    offlinePost<MosCertificate>('/mos-certificates', data, {
      opType: 'mos.create',
      opClass: 'safe_save',
      summary: 'MOS certificate draft',
    }),

  approve: (id: string) =>
    offlinePost<MosCertificate>(`/mos-certificates/${id}/approve`, {}, {
      opType: 'mos.approve',
      opClass: 'confirm_required',
      summary: `Approve MOS ${id}`,
    }),
};

export const variationOrdersApi = {
  list: (params: { contractId?: string; status?: string } = {}) =>
    apiClient.get<VariationOrder[]>(`/variation-orders${buildQuery(params)}`),

  get: (id: string) => apiClient.get<VariationOrder>(`/variation-orders/${id}`),

  create: (data: {
    contractId: string;
    voDate?: string;
    title?: string;
    notes?: string;
    lines: Array<{
      lineType: 'new_item' | 'adjust' | 'delete_item';
      boqItemId?: string;
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
      newTenderQty?: number;
      newUnitRate?: number;
    }>;
  }) =>
    offlinePost<VariationOrder & { newBoqItemIds?: string[] }>('/variation-orders', data, {
      opType: 'vo.create',
      opClass: 'safe_save',
      summary: 'Create variation order',
    }),

  submit: (id: string) =>
    offlinePost<VariationOrder>(`/variation-orders/${encodeURIComponent(id)}/submit`, {}, {
      opType: 'vo.submit',
      opClass: 'safe_save',
      summary: `Submit VO ${id}`,
    }),

  approve: (id: string) =>
    offlinePost<VariationOrder>(`/variation-orders/${encodeURIComponent(id)}/approve`, {}, {
      opType: 'vo.approve',
      opClass: 'confirm_required',
      summary: `Approve VO ${id}`,
    }),

  reject: (id: string) =>
    offlinePost<VariationOrder>(`/variation-orders/${encodeURIComponent(id)}/reject`, {}, {
      opType: 'vo.reject',
      opClass: 'safe_save',
      summary: `Reject VO ${id}`,
    }),

  delete: (id: string) =>
    offlineDelete<{ ok: boolean }>(`/variation-orders/${encodeURIComponent(id)}`, {
      opType: 'vo.delete',
      opClass: 'safe_save',
      summary: `Delete VO ${id}`,
    }),
};

export type PurchaseInvoiceLinePayload = {
  materialCategoryId?: number;
  itemDescription?: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost?: number;
  boqItemId?: string;
};

/** @deprecated use PurchaseInvoiceLinePayload */
export type DistributedInvoiceLinePayload = PurchaseInvoiceLinePayload & {
  allocations?: Array<{
    contractId: string;
    quantity: number;
    unitCost?: number;
    totalCost?: number;
  }>;
};

export type MaterialGroup = { id: number; code: string; name: string; nameEn?: string | null };
export type MaterialCategory = {
  id: number;
  groupId: number;
  code: string;
  name: string;
  unit: string;
  groupCode?: string;
  groupName?: string;
  groupNameEn?: string;
};

export const materialsApi = {
  listGroups: () => apiClient.get<MaterialGroup[]>('/materials/groups'),
  createGroup: (data: { code: string; name: string; nameEn?: string }) =>
    apiClient.post<MaterialGroup>('/materials/groups', data),
  listCategories: (groupId?: number) =>
    apiClient.get<MaterialCategory[]>(
      `/materials/categories${groupId ? `?groupId=${groupId}` : ''}`
    ),
  lookupCategories: () => apiClient.get<MaterialCategory[]>('/materials/categories/lookup'),
  createCategory: (data: { groupId: number; code: string; name: string; unit: string }) =>
    apiClient.post<MaterialCategory>('/materials/categories', data),
  importTree: (rows: Array<{
    groupCode: string;
    groupName: string;
    groupNameEn?: string;
    categoryCode?: string;
    categoryName?: string;
    unit?: string;
  }>) =>
    apiClient.post<{
      groupsCreated: number;
      groupsSkipped: number;
      groupsUpdated?: number;
      categoriesCreated: number;
      categoriesSkipped: number;
      categoriesUpdated?: number;
      errors: string[];
    }>('/materials/import', { rows }),
};

export const boqMaterialsApi = {
  list: (boqItemId: string) =>
    apiClient.get<Array<{ materialCategoryId: number; code: string; name: string; unit: string }>>(
      `/boq-materials/${boqItemId}`
    ),
  byMaterial: (materialCategoryId: number, contractId: string) =>
    apiClient.get<
      Array<{
        boqItemId: string;
        itemCode: string;
        description: string;
        sectionName?: string;
        unit: string;
        tenderQty: number;
        tenderAmount: number;
        unitRateTotal: number;
      }>
    >(
      `/boq-materials/by-material/${materialCategoryId}?contractId=${encodeURIComponent(contractId)}`,
    ),
  allowed: (boqItemId: string) =>
    apiClient.get<Array<{
      materialCategoryId: number;
      code: string;
      name: string;
      unit: string;
      groupCode?: string;
      groupName?: string;
    }>>(
      `/boq-materials/${boqItemId}/allowed`
    ),
  setMaterials: (boqItemId: string, materialCategoryIds: number[]) =>
    apiClient.put(`/boq-materials/${boqItemId}`, { materialCategoryIds }),
  getLinkCounts: (contractId: string) =>
    apiClient.get<Record<string, number>>(`/boq-materials/contract/${contractId}/link-counts`),
  getConsumedQuantity: (boqItemId: string) =>
    apiClient.get<{ consumedQuantity: number }>(`/boq-materials/${boqItemId}/consumed-quantity`),
  getUnlinkedReport: (contractId: string) =>
    apiClient.get<{
      unlinkedItems: Array<{ id: string; itemCode: string; description: string; unit: string }>;
      unusedMaterials: Array<{ id: number; code: string; name: string; unit: string }>;
    }>(`/boq-materials/contract/${contractId}/unlinked-report`),
  canDelete: (boqItemId: string) =>
    apiClient.get<{
      canDelete: boolean;
      linkCount: number;
      consumptionCount: number;
      actualCostCount: number;
      reason: string | null;
    }>(`/boq-materials/${boqItemId}/can-delete`),
  inheritLinks: (targetBoqItemId: string, sourceBoqItemId: string) =>
    apiClient.post<{ inherited: number }>(`/boq-materials/${targetBoqItemId}/inherit`, {
      sourceBoqItemId,
    }),
};

export const consumptionOrdersApi = {
  list: (params?: { contractId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.contractId) q.set('contractId', params.contractId);
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return apiClient.get(`/consumption-orders${qs ? `?${qs}` : ''}`);
  },
  create: (data: {
    contractId: string;
    projectId?: string;
    orderDate: string;
    notes?: string;
    expenseAccountCode?: string;
    expenseAccountName?: string;
    lines: Array<{
      boqItemId: string;
      materialCategoryId: number;
      quantity: number;
      expenseAccountCode?: string;
      expenseAccountName?: string;
    }>;
  }) =>
    offlinePost('/consumption-orders', data, {
      opType: 'consumption.create',
      opClass: 'safe_save',
      summary: 'Consumption order draft',
    }),
  /** Create + confirm in one offline op (issue modal). pending_cost still returns without GL. */
  createAndConfirm: (data: {
    contractId: string;
    projectId?: string;
    orderDate: string;
    notes?: string;
    expenseAccountCode?: string;
    expenseAccountName?: string;
    lines: Array<{
      boqItemId: string;
      materialCategoryId: number;
      quantity: number;
      expenseAccountCode?: string;
      expenseAccountName?: string;
    }>;
  }) =>
    offlinePost('/consumption-orders', { ...data, autoConfirm: true }, {
      opType: 'consumption.confirm',
      opClass: 'confirm_required',
      summary: 'Confirm consumption issue',
    }),
  confirm: (id: number) =>
    offlinePost<{
      ok: boolean;
      order: {
        id: number;
        orderNumber: string;
        projectId: string;
        contractId: string;
        orderDate: string;
        totalCost: number;
        expenseAccountCode?: string | null;
        expenseAccountName?: string | null;
        lines?: Array<{ totalCost: number }>;
      };
    }>(`/consumption-orders/${id}/confirm`, {}, {
      opType: 'consumption.confirm',
      opClass: 'confirm_required',
      summary: `Confirm consumption #${id}`,
    }),
  approveCost: (id: number) =>
    offlinePost<{
      ok: boolean;
      order: {
        id: number;
        orderNumber: string;
        projectId: string;
        contractId: string;
        orderDate: string;
        totalCost: number;
      };
    }>(`/consumption-orders/${id}/approve-cost`, {}, {
      opType: 'consumption.confirm',
      opClass: 'confirm_required',
      summary: `Approve consumption cost #${id}`,
    }),
};

export const warehouseReceiptsApi = {
  list: (params?: { projectId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.projectId) q.set('projectId', params.projectId);
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return apiClient.get(`/warehouse-receipts${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => apiClient.get(`/warehouse-receipts/${id}`),
  create: (data: {
    projectId: string;
    receiptDate: string;
    supplierInvoiceRef: string;
    notes?: string;
    submit?: boolean;
    lines: Array<{ materialCategoryId: number; quantity: number }>;
  }) =>
    offlinePost('/warehouse-receipts', data, {
      opType: 'warehouse_receipt.create',
      opClass: 'safe_save',
      summary: 'Warehouse receipt',
    }),
  submit: (id: string) =>
    offlinePost(`/warehouse-receipts/${id}/submit`, {}, {
      opType: 'warehouse_receipt.submit',
      opClass: 'safe_save',
      summary: `Submit warehouse receipt ${id}`,
    }),
  approve: (
    id: string,
    data: {
      supplierAccountCode: string;
      supplierAccountName?: string;
      lines: Array<{ id: number; unitCost: number }>;
    },
  ) =>
    offlinePost(`/warehouse-receipts/${id}/approve`, data, {
      opType: 'warehouse_receipt.approve',
      opClass: 'confirm_required',
      summary: `Approve warehouse receipt ${id}`,
    }),
  reject: (id: string) => apiClient.post(`/warehouse-receipts/${id}/reject`, {}),
};

export const consumptionAllocationTemplatesApi = {
  list: (contractId: string, materialCategoryId: number) =>
    apiClient.get<
      Array<{
        id: number;
        contractId: string;
        materialCategoryId: number;
        name: string;
        basis: 'boq_qty' | 'boq_value' | 'manual';
        weights: Record<string, number>;
        updatedAt?: string;
      }>
    >(
      `/consumption-allocation-templates?contractId=${encodeURIComponent(contractId)}&materialCategoryId=${materialCategoryId}`,
    ),
  save: (data: {
    contractId: string;
    materialCategoryId: number;
    name?: string;
    basis: 'boq_qty' | 'boq_value' | 'manual';
    weights: Record<string, number>;
  }) => apiClient.post('/consumption-allocation-templates', data),
  remove: (id: number) => apiClient.delete(`/consumption-allocation-templates/${id}`),
};

export const returnOrdersApi = {
  list: (params?: { contractId?: string; projectId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.contractId) q.set('contractId', params.contractId);
    if (params?.projectId) q.set('projectId', params.projectId);
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return apiClient.get(`/return-orders${qs ? `?${qs}` : ''}`);
  },
  returnable: (consumptionOrderLineId: number) =>
    apiClient.get<{
      ok: boolean;
      line: {
        id: number;
        consumptionOrderId: number;
        orderNumber: string;
        orderDate: string;
        contractId: string;
        projectId: string;
        materialName?: string;
        materialCode?: string;
        materialUnit?: string;
        boqItemCode?: string;
        boqDescription?: string;
        quantity: number;
        unitCost: number;
        totalCost: number;
        issuedQuantity: number;
        returnedQuantity: number;
        returnableQuantity: number;
        expenseAccountCode?: string | null;
        expenseAccountName?: string | null;
      };
    }>(`/return-orders/returnable/${consumptionOrderLineId}`),
  create: (data: {
    contractId: string;
    projectId?: string;
    returnDate: string;
    notes?: string;
    lines: Array<{ consumptionOrderLineId: number; quantity: number; reason?: string }>;
  }) =>
    offlinePost('/return-orders', data, {
      opType: 'return.create',
      opClass: 'safe_save',
      summary: 'Return order draft',
    }),
  createAndConfirm: (data: {
    contractId: string;
    projectId?: string;
    returnDate: string;
    notes?: string;
    lines: Array<{ consumptionOrderLineId: number; quantity: number; reason?: string }>;
  }) =>
    offlinePost('/return-orders', { ...data, autoConfirm: true }, {
      opType: 'return.confirm',
      opClass: 'confirm_required',
      summary: 'Confirm return order',
    }),
  confirm: (id: number) =>
    offlinePost<{
      ok: boolean;
      order: {
        id: number;
        returnNumber: string;
        projectId: string;
        contractId: string;
        returnDate: string;
        totalCost: number;
        expenseAccountCode?: string | null;
        expenseAccountName?: string | null;
        consumptionOrderNumber?: string | null;
      };
    }>(`/return-orders/${id}/confirm`, {}, {
      opType: 'return.confirm',
      opClass: 'confirm_required',
      summary: `Confirm return #${id}`,
    }),
};

export type CostCenterRow = {
  id: string;
  code: string;
  name: string;
  nameEn?: string | null;
  type: 'direct' | 'indirect';
  contractId?: string | null;
  isActive?: boolean;
};

export const costCentersApi = {
  list: (type?: 'direct' | 'indirect') => {
    const qs = type ? `?type=${encodeURIComponent(type)}` : '';
    return apiClient.get<CostCenterRow[]>(`/cost-centers${qs}`);
  },
  create: (data: { code: string; name: string; nameEn?: string; isActive?: boolean }) =>
    apiClient.post<CostCenterRow>('/cost-centers', data),
  update: (id: string, data: { name?: string; nameEn?: string; isActive?: boolean }) =>
    apiClient.patch<CostCenterRow>(`/cost-centers/${encodeURIComponent(id)}`, data),
  remove: (id: string) => apiClient.delete(`/cost-centers/${encodeURIComponent(id)}`),
  nextIndirectCode: () => apiClient.get<{ code: string }>('/cost-centers/next-indirect-code'),
};

export const contractExpenseOrdersApi = {
  list: (params?: { contractId?: string; projectId?: string }) => {
    const q = new URLSearchParams();
    if (params?.contractId) q.set('contractId', params.contractId);
    if (params?.projectId) q.set('projectId', params.projectId);
    const qs = q.toString();
    return apiClient.get(`/contract-expense-orders${qs ? `?${qs}` : ''}`);
  },
  create: (data: {
    contractId: string;
    projectId: string;
    orderDate: string;
    expenseAccountCode: string;
    expenseAccountName?: string;
    creditorAccountCode: string;
    creditorAccountName?: string;
    totalAmount: number;
    description?: string;
    referenceNumber?: string;
    lines: Array<{ boqItemId: string; amount: number }>;
  }) => apiClient.post('/contract-expense-orders', data),
  confirm: (id: number) => apiClient.post(`/contract-expense-orders/${id}/confirm`, {}),
};

export const overheadAllocationApi = {
  listPeriods: () => apiClient.get('/overhead-allocation/periods'),
  createPeriod: (data: {
    label: string;
    periodStart: string;
    periodEnd: string;
    notes?: string;
    distributionBasis?: string;
    boqLoadingBasis?: string;
  }) => apiClient.post('/overhead-allocation/periods', data),
  updatePeriod: (
    periodId: string,
    data: {
      label?: string;
      periodStart?: string;
      periodEnd?: string;
      notes?: string;
      distributionBasis?: string;
      boqLoadingBasis?: string;
      includedIndirectCenterIds?: string[];
    },
  ) => apiClient.patch(`/overhead-allocation/periods/${encodeURIComponent(periodId)}`, data),
  preview: (periodId: string) => apiClient.get(`/overhead-allocation/periods/${encodeURIComponent(periodId)}/preview`),
  saveProposedLines: (periodId: string, lines: Array<{ indirectCenterId: string; contractId: string; accountCode: string; amount: number }>) =>
    apiClient.put(`/overhead-allocation/periods/${encodeURIComponent(periodId)}/proposed-lines`, { lines }),
  clearProposedLines: (periodId: string) =>
    apiClient.delete(`/overhead-allocation/periods/${encodeURIComponent(periodId)}/proposed-lines`),
  listLines: (periodId: string) => apiClient.get(`/overhead-allocation/periods/${encodeURIComponent(periodId)}/lines`),
  close: (periodId: string) => apiClient.post(`/overhead-allocation/periods/${encodeURIComponent(periodId)}/close`, {}),
  reopen: (periodId: string) => apiClient.post(`/overhead-allocation/periods/${encodeURIComponent(periodId)}/reopen`, {}),
};

export type AccountingPeriodLockRow = {
  id: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  status: 'locked' | 'open' | string;
  lockedAt?: string | null;
  lockedBy?: string | null;
  allowedUserIds: string[];
  createdAt?: string;
  updatedAt?: string;
};

export const accountingPeriodsApi = {
  list: () => apiClient.get<AccountingPeriodLockRow[]>('/accounting-periods'),
  create: (data: {
    label: string;
    periodStart: string;
    periodEnd: string;
    allowedUserIds?: string[];
  }) => apiClient.post<AccountingPeriodLockRow>('/accounting-periods', data),
  lock: (id: string) =>
    apiClient.post<AccountingPeriodLockRow>(`/accounting-periods/${encodeURIComponent(id)}/lock`, {}),
  unlock: (id: string) =>
    apiClient.post<AccountingPeriodLockRow>(`/accounting-periods/${encodeURIComponent(id)}/unlock`, {}),
  setAllowedUsers: (id: string, allowedUserIds: string[]) =>
    apiClient.put<AccountingPeriodLockRow>(`/accounting-periods/${encodeURIComponent(id)}/allowed-users`, {
      allowedUserIds,
    }),
};

export type FiscalClosingStatus = 'draft' | 'pl_closed' | 'bs_approved' | 'opening_posted' | string;

export type FiscalPeriodClosingRow = {
  id: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  openingDate: string;
  status: FiscalClosingStatus;
  netProfit?: number | null;
  balanceGap?: number | null;
  plCloseTransactionId?: string | null;
  openingTransactionId?: string | null;
  periodLockId?: string | null;
  plClosedAt?: string | null;
  bsApprovedAt?: string | null;
  openingPostedAt?: string | null;
  notes?: string | null;
};

export type FiscalJournalPreviewEntry = {
  accountCode: string;
  accountName?: string;
  debit: number;
  credit: number;
};

export const fiscalClosingsApi = {
  list: () => apiClient.get<FiscalPeriodClosingRow[]>('/fiscal-closings'),
  create: (data: {
    label: string;
    periodStart: string;
    periodEnd: string;
    openingDate?: string;
    notes?: string;
  }) => apiClient.post<FiscalPeriodClosingRow>('/fiscal-closings', data),
  previewIncomeClose: (periodStart: string, periodEnd: string) =>
    apiClient.get<{
      periodStart: string;
      periodEnd: string;
      plBalances: Array<{ accountCode: string; accountName: string; netDebit: number }>;
      entries: FiscalJournalPreviewEntry[];
      netProfit: number;
      entryCount: number;
    }>(
      `/fiscal-closings/preview/income-close?periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`,
    ),
  previewBalanceSheet: (periodEnd: string) =>
    apiClient.get<{
      periodEnd: string;
      balances: Array<{ accountCode: string; accountName: string; netDebit: number }>;
      balanceGap: number;
      isBalanced: boolean;
      totalAssets: number;
      totalLiabEquity: number;
    }>(`/fiscal-closings/preview/balance-sheet?periodEnd=${encodeURIComponent(periodEnd)}`),
  previewOpening: (periodEnd: string, openingDate?: string) =>
    apiClient.get<{
      openingDate: string;
      entries: FiscalJournalPreviewEntry[];
      entryCount: number;
      balanceGap: number;
      isBalanced: boolean;
    }>(
      `/fiscal-closings/preview/opening?periodEnd=${encodeURIComponent(periodEnd)}${
        openingDate ? `&openingDate=${encodeURIComponent(openingDate)}` : ''
      }`,
    ),
  closeIncome: (id: string) =>
    apiClient.post<FiscalPeriodClosingRow>(`/fiscal-closings/${encodeURIComponent(id)}/close-income`, {}),
  approveBalanceSheet: (id: string) =>
    apiClient.post<FiscalPeriodClosingRow>(
      `/fiscal-closings/${encodeURIComponent(id)}/approve-balance-sheet`,
      {},
    ),
  postOpening: (id: string) =>
    apiClient.post<FiscalPeriodClosingRow>(`/fiscal-closings/${encodeURIComponent(id)}/post-opening`, {}),
  reopen: (id: string) =>
    apiClient.post<FiscalPeriodClosingRow>(`/fiscal-closings/${encodeURIComponent(id)}/reopen`, {}),
};

export const sqliteCoreApi = {
  createDistributedPurchaseInvoice: (data: {
    invoiceId?: string;
    invoiceNumber?: string;
    invoiceDate?: string;
    supplierName?: string;
    projectId: string;
    status?: 'draft' | 'confirmed' | 'posted';
    vatPct?: number;
    lines: PurchaseInvoiceLinePayload[];
  }) => apiClient.post('/sqlite-core/purchase-invoices/distributed', data),
  confirmPurchaseInvoice: (invoiceId: string) =>
    apiClient.post(`/sqlite-core/purchase-invoices/${encodeURIComponent(invoiceId)}/confirm`, {}),
  health: () => apiClient.get('/sqlite-core/health'),
  migrations: () => apiClient.get('/sqlite-core/migrations'),
};

// ─── Inventory API ────────────────────────────────────────────────────────────

export type ProjectInventoryMovement = {
  id: number;
  projectId: string;
  materialCategoryId: number;
  movementType: 'receipt' | 'issue' | 'return' | 'reserve' | 'release';
  quantity: number;
  unitCost?: number;
  referenceType?: string;
  referenceId?: string;
  notes?: string;
  createdAt: string;
  materialCode?: string;
  materialName?: string;
  materialUnit?: string;
};

export type InventoryMaintenanceStats = {
  projectInventoryRows: number;
  contractInventoryRows: number;
  movementLogRows: number;
  consumptionOrders: number;
  consumptionOrderLines: number;
  returnOrders: number;
  transferOrders: number;
  purchaseInvoices: number;
  purchaseInvoiceLines: number;
  boqActualCosts: number;
};

export const inventoryMaintenanceApi = {
  stats: () => apiClient.get<InventoryMaintenanceStats>('/inventory-maintenance/stats'),
  purge: (data: {
    deleteMovements?: boolean;
    resetBalances?: boolean;
    projectId?: string;
  }) =>
    apiClient.post<{
      ok: boolean;
      projectId: string | null;
      deleteMovements: boolean;
      resetBalances: boolean;
      deleted: Record<string, number>;
    }>('/inventory-maintenance/purge', data),
};

export const financialMaintenanceApi = {
  wipeFinancial: () =>
    apiClient.post<{ ok: boolean; deleted: Record<string, number>; total: number }>(
      '/financial-maintenance/wipe-financial',
      {},
    ),
  wipeGroups: (groups: string[]) =>
    apiClient.post<{ ok: boolean; deleted: Record<string, number>; total: number; groups: string[] }>(
      '/financial-maintenance/wipe',
      { groups },
    ),
  factoryReset: () =>
    apiClient.post<{
      ok: boolean;
      requiresReLogin: boolean;
      keptEmails: string[];
      tablesTruncated: number;
      coaAdded: number;
    }>('/financial-maintenance/factory-reset', {}),
};

export const inventoryApi = {
  list: (contractId?: string) =>
    apiClient.get(`/inventory${contractId ? `?contractId=${contractId}` : ''}`),
  summary: (contractId: string) =>
    apiClient.get(`/inventory/${contractId}/summary`),
  projectSummary: (projectId: string) =>
    apiClient.get(`/inventory/project/${projectId}/summary`),
  projectMovements: (projectId: string, params?: { from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    const qs = q.toString();
    return apiClient.get(
      `/inventory/project/${encodeURIComponent(projectId)}/movements${qs ? `?${qs}` : ''}`
    ) as Promise<{ projectId: string; movements: ProjectInventoryMovement[] }>;
  },
  spentByContract: (params?: {
    contractId?: string;
    projectId?: string;
    dateFrom?: string;
    dateTo?: string;
    /** When `month`, each row includes `month: YYYY-MM`. */
    groupBy?: 'month' | 'day';
  }) => {
    const q = new URLSearchParams();
    if (params?.contractId) q.set('contractId', params.contractId);
    if (params?.projectId) q.set('projectId', params.projectId);
    if (params?.dateFrom) q.set('dateFrom', params.dateFrom);
    if (params?.dateTo) q.set('dateTo', params.dateTo);
    if (params?.groupBy) q.set('groupBy', params.groupBy);
    const qs = q.toString();
    return apiClient.get(`/inventory/spent-by-contract${qs ? `?${qs}` : ''}`) as Promise<
      Array<{ contractId: string; projectId?: string; totalSpent: number; month?: string }>
    >;
  },
  consume: (data: {
    inventoryItemId: number;
    quantity: number;
    consumptionDate: string;
    boqItemId?: string;
    notes?: string;
  }) => apiClient.post('/inventory/consume', data),
  consumption: (params?: { contractId?: string; from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.contractId) q.set('contractId', params.contractId);
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    const qs = q.toString();
    return apiClient.get(`/inventory/consumption${qs ? `?${qs}` : ''}`);
  },
  boqActuals: (contractId?: string) => {
    const q = contractId ? `?contractId=${encodeURIComponent(contractId)}` : '';
    return apiClient.get(`/inventory/boq-actuals${q}`) as Promise<{
      purchases: Array<{ boqItemId: string; totalPurchased: number; invoiceCount: number }>;
      actualCosts: Array<{ boqItemId: string; totalConsumed: number }>;
      projectInventory: Array<{
        id: number;
        projectId: string;
        materialCategoryId: number;
        itemDescription: string;
        unit: string;
        quantityBalance: number;
        avgUnitCost: number;
      }>;
      inventory: Array<{
        id: number;
        projectId?: string;
        itemDescription: string;
        unit: string;
        quantityBalance: number;
        avgUnitCost: number;
      }>;
    }>;
  },
  importOpeningBalances: (
    projectId: string,
    body: {
      date: string;
      rows: Array<{ materialCategoryCode: string; quantity: number; avgUnitCost: number }>;
    },
  ) =>
    apiClient.post<{
      imported: number;
      skipped: number;
      errors: string[];
      transactionId?: string;
      reference?: string;
      totalAmount?: number;
    }>(`/inventory/project/${encodeURIComponent(projectId)}/opening-import`, body),
};

// ─── Inventory Transfers API ──────────────────────────────────────────────────

export const inventoryTransfersApi = {
  list: (params?: { status?: string; fromContractId?: string; toContractId?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.fromContractId) q.set('fromContractId', params.fromContractId);
    if (params?.toContractId) q.set('toContractId', params.toContractId);
    const qs = q.toString();
    return apiClient.get(`/inventory-transfers${qs ? `?${qs}` : ''}`);
  },
  pendingProjects: () => apiClient.get('/inventory-transfers/pending-projects'),
  create: (data: {
    fromContractId: string;
    toContractId: string;
    transferDate: string;
    notes?: string;
    lines: { inventoryItemId: number; quantity: number }[];
  }) => apiClient.post('/inventory-transfers', data),
  approveB: (id: number) => apiClient.post(`/inventory-transfers/${id}/approve-b`, {}),
  rejectB: (id: number, reason?: string) =>
    apiClient.post(`/inventory-transfers/${id}/reject-b`, { reason }),
  approveProjects: (id: number) =>
    apiClient.post(`/inventory-transfers/${id}/approve-projects`, {}),
  rejectProjects: (id: number, reason?: string) =>
    apiClient.post(`/inventory-transfers/${id}/reject-projects`, { reason }),
  cancel: (id: number) => apiClient.post(`/inventory-transfers/${id}/cancel`, {}),
};

// ─── Project inventory transfers (مخزن المشروع ↔ مشروع) ───────────────────────

const PROJECT_TRANSFERS_BASE = '/inventory/project-transfers';

export const projectInventoryTransfersApi = {
  list: (params?: { status?: string; fromProjectId?: string; toProjectId?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.fromProjectId) q.set('fromProjectId', params.fromProjectId);
    if (params?.toProjectId) q.set('toProjectId', params.toProjectId);
    const qs = q.toString();
    return apiClient.get(`${PROJECT_TRANSFERS_BASE}${qs ? `?${qs}` : ''}`);
  },
  pendingProjects: () => apiClient.get(`${PROJECT_TRANSFERS_BASE}/pending-projects`),
  create: (data: {
    fromProjectId: string;
    toProjectId: string;
    transferDate: string;
    notes?: string;
    lines: { projectInventoryId: number; quantity: number }[];
    fromProjectCode?: string;
    fromProjectName?: string;
    toProjectCode?: string;
    toProjectName?: string;
  }) =>
    offlinePost(PROJECT_TRANSFERS_BASE, data, {
      opType: 'project_transfer.create',
      opClass: 'safe_save',
      summary: 'Project warehouse transfer',
    }),
  approveB: (id: number) =>
    offlinePost(`${PROJECT_TRANSFERS_BASE}/${id}/approve-b`, {}, {
      opType: 'project_transfer.approve_b',
      opClass: 'confirm_required',
      summary: `Transfer approve-B #${id}`,
    }),
  rejectB: (id: number, reason?: string) =>
    apiClient.post(`${PROJECT_TRANSFERS_BASE}/${id}/reject-b`, { reason }),
  approveProjects: (
    id: number,
    data?: {
      fromWarehouseAccountCode?: string;
      fromWarehouseAccountName?: string;
      toWarehouseAccountCode?: string;
      toWarehouseAccountName?: string;
    },
  ) =>
    offlinePost(`${PROJECT_TRANSFERS_BASE}/${id}/approve-projects`, data ?? {}, {
      opType: 'project_transfer.approve_projects',
      opClass: 'confirm_required',
      summary: `Transfer approve-projects #${id}`,
    }),
  rejectProjects: (id: number, reason?: string) =>
    apiClient.post(`${PROJECT_TRANSFERS_BASE}/${id}/reject-projects`, { reason }),
  cancel: (id: number) => apiClient.post(`${PROJECT_TRANSFERS_BASE}/${id}/cancel`, {}),
};

// ─── Subcontractor API ────────────────────────────────────────────────────────

export const subcontractorApi = {
  listSubcontractors: () => apiClient.get('/subcontractors'),
  createSubcontractor: (data: {
    name: string;
    trade: string;
    contactInfo?: string;
    taxNumber?: string;
    commercialRegister?: string;
  }) => apiClient.post('/subcontractors', data),
  updateSubcontractor: (id: number, data: Record<string, unknown>) =>
    apiClient.put(`/subcontractors/${id}`, data),

  listAssignments: (contractId?: string) =>
    apiClient.get(`/subcontract-assignments${contractId ? `?contractId=${contractId}` : ''}`),
  createAssignment: (data: {
    contractId: string;
    subcontractorId: number;
    boqItemId: string;
    subcontractUnitPrice: number;
    ownerUnitPrice: number;
    assignedQuantity: number;
    assignedDate: string;
  }) => apiClient.post('/subcontract-assignments', data),

  listExtracts: (params?: { assignmentId?: number; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.assignmentId) q.set('assignmentId', String(params.assignmentId));
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return apiClient.get(`/subcontract-extracts${qs ? `?${qs}` : ''}`);
  },
  createExtract: (data: {
    assignmentId: number;
    extractNumber: string;
    extractDate: string;
    periodFrom: string;
    periodTo: string;
    executedQuantity: number;
    unitPrice: number;
    performanceGuaranteeRate?: number;
    advancePaymentDeduction?: number;
    delayPenalty?: number;
    notes?: string;
  }) => apiClient.post('/subcontract-extracts', data),
  updateStatus: (id: number, status: string, notes?: string) =>
    apiClient.put(`/subcontract-extracts/${id}/status`, { status, notes }),
};

// ─── Settings API ─────────────────────────────────────────────────────────────

export type CompanyPrintSettings = {
  companyName?: string;
  companyNameEn?: string;
  taxId?: string;
  address?: string;
  addressEn?: string;
  /** Center letterhead logo. */
  headerLogo?: string;
  /** Optional side logos for IPC cover (physical left / right). */
  headerLogoLeft?: string;
  headerLogoRight?: string;
  /** Middle title line under center logo (IPC cover). */
  coverContractLabel?: string;
  coverPreparedBy?: string;
  coverApprovedBy?: string;
  footerText?: string;
  footerTextEn?: string;
  reportPrintProfiles?: import('../../lib/reportPrintProfiles').StoredReportPrintProfiles;
};

export type UserPreferences = {
  defaultTheme?: string | null;
  defaultModule?: string | null;
  defaultLanguage?: 'ar' | 'en' | null;
  /** UI-only nav whitelist; null = show all permitted modules */
  visibleShellModules?: string[] | null;
};

export type UserContactPatch = {
  phoneE164?: string | null;
  whatsappOptIn?: boolean;
  preferredLanguage?: 'ar' | 'en';
};

export type WhatsAppNotificationsConfig = {
  enabled: boolean;
};

export type PushToProductionPreview = {
  configured: boolean;
  local: { transactions: number; transactions2026: number };
  remote: { transactions: number; transactions2026: number } | null;
  missingOnRemote: number;
  targetHost: string | null;
};

export type PushToProductionResult = {
  ok: boolean;
  preview: PushToProductionPreview;
  counts: Record<string, number>;
  skipped: Record<string, number>;
  gl: { transactions: number; balanced: number; unbalanced: number; unbalancedIds: string[] };
};

export type BoqRateBackfillPreview = {
  postgresRowsNeedingRates: number;
  firestoreConfigured: boolean;
};

export type BoqRateBackfillReport = {
  source: string;
  scanned: number;
  updated: number;
  skippedNoPostgresRow: number;
  skippedNoRateBreakdownInSource: number;
  skippedAlreadyHadRates: number;
};

export const settingsApi = {
  getCompanyInfo: () =>
    apiClient.get<{ value: CompanyPrintSettings | null }>('/settings/company_info'),
  putCompanyInfo: (data: CompanyPrintSettings) =>
    apiClient.put<{ ok: boolean }>('/settings/company_info', data),
  patchReportPrintProfiles: (reportPrintProfiles: NonNullable<CompanyPrintSettings['reportPrintProfiles']>) =>
    apiClient.patch<{ ok: boolean; reportPrintProfiles?: CompanyPrintSettings['reportPrintProfiles'] }>(
      '/settings/company_info/report-print-profiles',
      { reportPrintProfiles },
    ),
  getUserPreferences: () => apiClient.get<UserPreferences>('/settings/user-preferences'),
  patchUserPreferences: (data: Partial<UserPreferences>) =>
    apiClient.patch<UserPreferences>('/settings/user-preferences', data),
  getUserPreferencesForUser: (userId: string) =>
    apiClient.get<UserPreferences>(`/settings/user-preferences/${encodeURIComponent(userId)}`),
  patchUserPreferencesForUser: (userId: string, data: Partial<UserPreferences>) =>
    apiClient.patch<UserPreferences>(
      `/settings/user-preferences/${encodeURIComponent(userId)}`,
      data,
    ),
  exportBackup: () => apiClient.get<{ exportedAt: string; version: number; collections: Record<string, unknown[]> }>('/settings/backup-export'),
  importBackup: (payload: { exportedAt?: string; version?: number; collections: Record<string, unknown[]>; mode: 'merge' | 'replace' }) =>
    apiClient.post<{
      ok: boolean;
      mode: 'merge' | 'replace';
      requiresReLogin?: boolean;
      collectionsProcessed: number;
      recordsProcessed: number;
      counts: Record<string, number>;
      skipped: Record<string, number>;
      gl?: {
        transactions?: number;
        balanced?: number;
        unbalanced?: number;
        unbalancedIds?: string[];
      };
    }>('/settings/backup-import', payload),
  pushToProductionPreview: (year?: number) =>
    apiClient.get<PushToProductionPreview>(
      `/settings/push-to-production/preview${year != null ? `?year=${year}` : ''}`,
    ),
  pushToProduction: () => apiClient.post<PushToProductionResult>('/settings/push-to-production', {}),
  boqRateBackfillPreview: () =>
    apiClient.get<BoqRateBackfillPreview>('/settings/backfill-boq-rates/preview'),
  boqRateBackfillRun: () =>
    apiClient.post<BoqRateBackfillReport>('/settings/backfill-boq-rates', {}),
  getWhatsAppNotifications: () =>
    apiClient.get<WhatsAppNotificationsConfig>('/settings/whatsapp-notifications'),
  patchWhatsAppNotifications: (enabled: boolean) =>
    apiClient.patch<WhatsAppNotificationsConfig>('/settings/whatsapp-notifications', { enabled }),
  patchUserContact: (userId: string, data: UserContactPatch) =>
    apiClient.patch<AppUser>(`/settings/users/${encodeURIComponent(userId)}/contact`, data),
};

export const banksApi = {
  accounts: createCrudApi('/bank-accounts'),
  movements: {
    ...createCrudApi('/bank-movements'),
    create: (data: unknown) =>
      offlinePost('/bank-movements', data, {
        opType: 'bank_movement.create',
        opClass: 'safe_save',
        summary: 'Bank movement draft',
      }),
    update: (id: string, data: unknown) =>
      offlinePut(`/bank-movements/${encodeURIComponent(id)}`, data, {
        opType: 'bank_movement.update',
        opClass: 'safe_save',
        summary: `Update bank movement ${id}`,
      }),
    /** Atomic GL + status=posted (confirm_required offline). */
    post: (id: string, body: unknown) =>
      offlinePost(`/bank-movements/${encodeURIComponent(id)}/post`, body, {
        opType: 'bank_movement.post',
        opClass: 'confirm_required',
        summary: `Post bank movement ${id}`,
      }),
    cancelPosted: (id: string) =>
      offlinePost(`/bank-movements/${encodeURIComponent(id)}/cancel`, {}, {
        opType: 'bank_movement.post',
        opClass: 'confirm_required',
        summary: `Cancel bank movement ${id}`,
      }),
  },
  cheques: {
    ...createCrudApi('/bank-cheques'),
    create: (data: unknown) =>
      offlinePost('/bank-cheques', data, {
        opType: 'bank_cheque.create',
        opClass: 'safe_save',
        summary: 'Bank cheque draft',
      }),
    update: (id: string, data: unknown) =>
      offlinePut(`/bank-cheques/${encodeURIComponent(id)}`, data, {
        opType: 'bank_cheque.update',
        opClass: 'safe_save',
        summary: `Update bank cheque ${id}`,
      }),
    issue: (id: string, body: unknown) =>
      offlinePost(`/bank-cheques/${encodeURIComponent(id)}/issue`, body, {
        opType: 'bank_cheque.iss',
        opClass: 'confirm_required',
        summary: `Issue cheque ${id}`,
      }),
    clear: (id: string, body: unknown) =>
      offlinePost(`/bank-cheques/${encodeURIComponent(id)}/clear`, body, {
        opType: 'bank_cheque.clr',
        opClass: 'confirm_required',
        summary: `Clear cheque ${id}`,
      }),
    reject: (id: string) =>
      offlinePost(`/bank-cheques/${encodeURIComponent(id)}/reject`, {}, {
        opType: 'bank_cheque.iss',
        opClass: 'confirm_required',
        summary: `Reject cheque ${id}`,
      }),
    cancelIssue: (id: string) =>
      offlinePost(`/bank-cheques/${encodeURIComponent(id)}/cancel-issue`, {}, {
        opType: 'bank_cheque.iss',
        opClass: 'confirm_required',
        summary: `Cancel cheque issue ${id}`,
      }),
  },
  statements: createCrudApi('/bank-statements'),
  statementLines: createCrudApi('/bank-statement-lines'),
};

export const notificationsApi = {
  feed: () =>
    apiClient.get<{ items: import('../../types').AppNotificationItem[]; unreadCount: number }>(
      '/notifications/feed',
    ),
  item: (key: string) =>
    apiClient.get<import('../../types').NotificationItemDetail>(
      `/notifications/item?key=${encodeURIComponent(key)}`,
    ),
  action: (key: string, action: import('../../types').NotificationActionType) =>
    apiClient.post<{ ok: boolean }>('/notifications/actions', { key, action }),
  verifyLink: (token: string) =>
    apiClient.get<{ valid: boolean; notificationKey?: string; expiresAt?: string }>(
      `/notifications/link/verify?t=${encodeURIComponent(token)}`,
    ),
  markRead: (keys: string[]) =>
    apiClient.post<void>('/notifications/mark-read', { keys }),
  dismiss: (keys: string[]) =>
    apiClient.post<void>('/notifications/dismiss', { keys }),
  outboxStats: () =>
    apiClient.get<{ stats: Record<string, number> }>('/notifications/outbox-stats'),
  testWhatsApp: (phoneE164: string) =>
    apiClient.post<{ ok: boolean; dryRun?: boolean; messageId?: string }>(
      '/notifications/test-whatsapp',
      { phoneE164 },
    ),
};

// ─── Purchase Requests API ───────────────────────────────────────────────────

export type PurchaseRequestStatus =
  | 'open'
  | 'contacted'
  | 'postponed'
  | 'unavailable'
  | 'executed'
  | 'cancelled';

export type PurchaseRequestPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface PurchaseRequestRow {
  id: string;
  requestNumber: string;
  materialMode: 'coded' | 'uncoded' | string;
  materialCategoryId?: number | null;
  materialCode?: string | null;
  materialName?: string | null;
  unit?: string | null;
  description?: string | null;
  quantity: number;
  projectId: string;
  contractId: string;
  boqItemId?: string | null;
  boqItemCode?: string | null;
  boqDescription?: string | null;
  neededByDate: string;
  priority: PurchaseRequestPriority | string;
  status: PurchaseRequestStatus | string;
  requestedAt: string;
  requestedByUserId?: string | null;
  statusUpdatedAt?: string | null;
  statusNote?: string | null;
  isDeleted?: boolean;
}

export interface PurchaseRequestBoqPickerItem {
  id: string;
  itemCode: string;
  description: string;
}

export const purchaseRequestsApi = {
  meta: () =>
    apiClient.get<{
      projects: Array<{
        id: string;
        projectCode: string;
        projectName: string;
        projectNameEn?: string | null;
      }>;
      contracts: Array<{
        id: string;
        projectId: string;
        contractName: string;
        contractNameEn?: string | null;
        contractNumber: string;
      }>;
    }>('/purchase-requests/meta'),
  materialsLookup: () =>
    apiClient.get<
      Array<{
        id: number;
        groupId: number;
        code: string;
        name: string;
        unit: string;
        groupCode?: string;
        groupName?: string;
      }>
    >('/purchase-requests/materials-lookup'),
  boqPicker: (contractId: string) =>
    apiClient.get<PurchaseRequestBoqPickerItem[]>(
      `/purchase-requests/boq-picker?contractId=${encodeURIComponent(contractId)}`,
    ),
  list: (scope: 'open' | 'executed' | 'all' = 'open') =>
    apiClient.get<PurchaseRequestRow[]>(`/purchase-requests?scope=${scope}`),
  create: (body: Record<string, unknown>) =>
    offlinePost<PurchaseRequestRow>('/purchase-requests', body, {
      opType: 'purchase_request.create',
      opClass: 'safe_save',
      summary: 'Purchase request',
    }),
  updateStatus: (id: string, status: PurchaseRequestStatus, note?: string) =>
    offlinePatch<PurchaseRequestRow>(`/purchase-requests/${encodeURIComponent(id)}/status`, {
      status,
      ...(note != null ? { note } : {}),
    }, {
      opType: 'purchase_request.update_status',
      opClass: 'safe_save',
      summary: `PR status ${status}`,
    }),
  notifyWhatsApp: (id: string) =>
    apiClient.post<{ ok: boolean }>(`/purchase-requests/${encodeURIComponent(id)}/notify-whatsapp`, {}),
  remove: (id: string) =>
    apiClient.delete<{ ok: boolean }>(`/purchase-requests/${encodeURIComponent(id)}`),
};

// ─── Cash Budget (planning only — no GL) ─────────────────────────────────────

export type CashBudgetPeriodType = 'weekly' | 'biweekly' | 'monthly';
export type CashBudgetStatus = 'draft' | 'approved';
export type CashBudgetSide = 'obligation' | 'source';

export interface CashBudgetSummaryDto {
  openingBank: number;
  openingCash: number;
  availableLiquidity: number;
  periodSources: number;
  obligations: number;
  gap: number;
}

export interface CashBudgetLineRow {
  id: string;
  periodId: string;
  side: CashBudgetSide;
  category: string;
  description: string;
  amount: number;
  dueDate: string | null;
  origin: 'auto' | 'manual';
  originType?: string | null;
  originId?: string | null;
  projectId?: string | null;
  contractId?: string | null;
  costCenterName?: string | null;
  costCenterNameEn?: string | null;
  projectName?: string | null;
  projectNameEn?: string | null;
  allocatedCash?: number | null;
  excluded: boolean;
  notes?: string | null;
  sortOrder?: number;
}

export interface CashBudgetPeriodRow {
  id: string;
  periodNumber: string;
  periodType: CashBudgetPeriodType;
  periodStart: string;
  periodEnd: string;
  status: CashBudgetStatus;
  openingBank: number;
  openingCash: number;
  notes?: string | null;
  summary: CashBudgetSummaryDto;
  settlementPct?: number;
  bankPool?: number;
  distributablePool?: number;
  lineCount?: number;
  lines?: CashBudgetLineRow[];
}

export interface CashBudgetCustodyFloorRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountNameEn?: string | null;
  minBalance: number;
  glBalance: number;
  pendingSettlements: number;
  replenish: number;
}

export const cashBudgetApi = {
  list: () => apiClient.get<CashBudgetPeriodRow[]>('/cash-budget'),
  get: (id: string) =>
    apiClient.get<CashBudgetPeriodRow>(`/cash-budget/${encodeURIComponent(id)}`),
  create: (body: { periodType: CashBudgetPeriodType; periodStart: string; notes?: string }) =>
    apiClient.post<CashBudgetPeriodRow>('/cash-budget', body),
  patch: (id: string, body: { notes?: string | null; openingBank?: number; openingCash?: number; settlementPct?: number }) =>
    apiClient.patch<CashBudgetPeriodRow>(`/cash-budget/${encodeURIComponent(id)}`, body),
  suggest: (id: string) =>
    apiClient.post<CashBudgetPeriodRow>(`/cash-budget/${encodeURIComponent(id)}/suggest`, {}),
  addLine: (id: string, body: {
    side: CashBudgetSide;
    category?: string;
    description: string;
    amount: number;
    dueDate?: string | null;
  }) => apiClient.post<CashBudgetLineRow>(`/cash-budget/${encodeURIComponent(id)}/lines`, body),
  patchLine: (id: string, lineId: string, body: Record<string, unknown>) =>
    apiClient.patch<CashBudgetLineRow>(
      `/cash-budget/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`,
      body,
    ),
  deleteLine: (id: string, lineId: string) =>
    apiClient.delete<{ ok: boolean }>(
      `/cash-budget/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`,
    ),
  approve: (id: string, body?: { settlementPct?: number }) =>
    apiClient.post<CashBudgetPeriodRow>(`/cash-budget/${encodeURIComponent(id)}/approve`, body ?? {}),
  reopen: (id: string) =>
    apiClient.post<CashBudgetPeriodRow>(`/cash-budget/${encodeURIComponent(id)}/reopen`, {}),
  remove: (id: string) =>
    apiClient.delete<{ ok: boolean }>(`/cash-budget/${encodeURIComponent(id)}`),
  setMinBalance: (accountId: string, minBalance: number) =>
    apiClient.patch<Record<string, unknown>>(
      `/cash-budget/coa/${encodeURIComponent(accountId)}/min-balance`,
      { minBalance },
    ),
  custodyFloors: (asOf?: string) =>
    apiClient.get<CashBudgetCustodyFloorRow[]>(
      `/cash-budget/custody-floors${asOf ? `?asOf=${encodeURIComponent(asOf)}` : ''}`,
    ),
};

// ─── Fixed Assets API ────────────────────────────────────────────────────────

export interface FixedAssetGroup {
  id: number;
  groupName: string;
  defaultAssetAccountCode: string;
  defaultDepreciationAccountCode: string;
  defaultExpenseAccountCode: string;
  defaultDepreciationModel: string;
  defaultUsefulLifeYears: number;
  defaultAnnualRate: number | null;
  isDeleted: boolean;
}

export interface FixedAsset {
  id: string;
  assetNumber: string;
  assetName: string;
  groupId: number | null;
  group?: { groupName: string } | null;
  acquisitionDate: string;
  assetValue: number;
  salvageValue: number;
  usefulLifeYears: number;
  depreciationModel: string;
  annualDepreciationRate: number;
  assetAccountCode: string;
  assetAccountName: string | null;
  accumulatedDepreciationAccountCode: string;
  accumulatedDepreciationAccountName: string | null;
  expenseAccountCode: string;
  expenseAccountName: string | null;
  costCenterId: string | null;
  costCenterType: string | null;
  bookValue: number;
  openingAccumulatedDepr: number;
  status: 'pending_setup' | 'active' | 'fully_depreciated' | 'disposed';
  purchaseTransactionId: string | null;
  notes: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FixedAssetDepreciationEntry {
  id: number;
  assetId: string;
  asset?: { assetNumber: string; assetName: string };
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  depreciationAmount: number;
  bookValueBefore: number;
  bookValueAfter: number;
  transactionId: string | null;
  status: string;
  createdAt: string;
}

export interface FixedAssetDepreciationLine {
  assetId: string;
  assetNumber: string;
  assetName: string;
  bookValueBefore: number;
  depreciationAmount: number;
  bookValueAfter: number;
  expenseAccountCode: string;
  expenseAccountName: string | null;
  accumulatedDepreciationAccountCode: string;
  costCenterId: string | null;
}

export const fixedAssetsApi = {
  // Groups
  listGroups: () => apiClient.get<FixedAssetGroup[]>('/fixed-assets/groups'),
  createGroup: (data: Omit<FixedAssetGroup, 'id' | 'isDeleted'>) =>
    offlinePost<FixedAssetGroup>('/fixed-assets/groups', data, {
      opType: 'fixed_asset.create',
      opClass: 'safe_save',
      summary: 'Fixed asset group',
    }),
  updateGroup: (id: number, data: Partial<FixedAssetGroup>) =>
    offlinePut<FixedAssetGroup>(`/fixed-assets/groups/${id}`, data, {
      opType: 'fixed_asset.update',
      opClass: 'safe_save',
      summary: `Update asset group ${id}`,
    }),

  // Assets
  list: (params?: { status?: string; groupId?: number; costCenterId?: string }) =>
    apiClient.get<FixedAsset[]>(`/fixed-assets${buildQuery({ status: params?.status, groupId: params?.groupId?.toString(), costCenterId: params?.costCenterId })}`),
  get: (id: string) => apiClient.get<FixedAsset & { depreciationEntries: FixedAssetDepreciationEntry[]; depreciationSchedule: unknown[] }>(`/fixed-assets/${id}`),
  create: (data: Partial<FixedAsset> & { assetName: string; acquisitionDate: string; assetValue: number }) =>
    offlinePost<FixedAsset>('/fixed-assets', data, {
      opType: 'fixed_asset.create',
      opClass: 'safe_save',
      summary: 'Create fixed asset',
    }),
  update: (id: string, data: Partial<FixedAsset>) =>
    offlinePut<FixedAsset>(`/fixed-assets/${encodeURIComponent(id)}`, data, {
      opType: 'fixed_asset.update',
      opClass: 'safe_save',
      summary: `Update fixed asset ${id}`,
    }),
  remove: (id: string) => apiClient.delete<{ ok: boolean }>(`/fixed-assets/${id}`),

  // Depreciation
  computeDepreciation: (periodLabel: string) =>
    apiClient.post<{
      periodLabel: string;
      periodStart: string;
      periodEnd: string;
      lines: FixedAssetDepreciationLine[];
      total: number;
    }>('/fixed-assets/depreciation/compute', { periodLabel }),
  postDepreciation: (periodLabel: string, lines: FixedAssetDepreciationLine[]) =>
    offlinePost<{ ok: boolean; periodLabel: string; posted: number }>(
      '/fixed-assets/depreciation/post',
      { periodLabel, lines },
      {
        opType: 'fixed_asset.depreciation_post',
        opClass: 'confirm_required',
        summary: `Post depreciation ${periodLabel}`,
      },
    ),
  listDepreciation: (params?: { periodLabel?: string; assetId?: string }) =>
    apiClient.get<FixedAssetDepreciationEntry[]>(`/fixed-assets/depreciation${buildQuery({ periodLabel: params?.periodLabel, assetId: params?.assetId })}`),

  // Reports & Import
  registerReport: (status?: string) =>
    apiClient.get<{
      rows: (FixedAsset & { groupName: string | null; accumulatedDepreciation: number; netBookValue: number })[];
      totals: { totalAssetValue: number; totalAccumulatedDepr: number; totalNetBookValue: number };
    }>(`/fixed-assets/register-report${status ? `?status=${status}` : ''}`),
  importAssets: (rows: Partial<FixedAsset & { groupName: string }>[]) =>
    offlinePost<{ created: number; errors: Array<{ row: number; error: string }> }>(
      '/fixed-assets/import',
      { rows },
      {
        opType: 'fixed_asset.import',
        opClass: 'safe_save',
        summary: 'Import fixed assets',
      },
    ),
  syncFromGl: () =>
    apiClient.post<{
      scanned: number;
      created: number;
      skipped: number;
      assets: Array<{ id: string; assetNumber: string; assetName: string; assetValue: number; assetAccountCode: string }>;
    }>('/fixed-assets/sync-from-gl'),
};

// ─── HR / Payroll ─────────────────────────────────────────────────────────────

export interface PayrollEmployee {
  id: string;
  employeeCode: string;
  name: string;
  nameEn: string | null;
  department: string | null;
  jobTitle: string | null;
  defaultCostCenterId: string | null;
  defaultCostCenterType: string | null;
  defaultExpenseAccountCode: string | null;
  defaultExpenseAccountName: string | null;
  basicSalary: number;
  hireDate: string | null;
  birthDate: string | null;
  priorInsuranceMonths: number | null;
  phoneE164: string | null;
  whatsappOptIn: boolean;
  status: string;
  notes: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeCostCenterAllocation {
  id?: string;
  employeeId?: string;
  costCenterId: string;
  costCenterType: string | null;
  expenseAccountCode: string | null;
  expenseAccountName: string | null;
  percentage: number;
}

export interface PayrollRunLineAllocation {
  id?: string;
  runLineId?: string;
  costCenterId: string;
  costCenterType: string | null;
  expenseAccountCode: string;
  expenseAccountName: string | null;
  percentage: number;
  amount: number;
}

export interface PayrollRunLine {
  id: string;
  runId: string;
  employeeId: string | null;
  employeeCode: string;
  employeeName: string;
  department: string | null;
  costCenterId: string | null;
  costCenterType: string | null;
  costCenterCode: string | null;
  expenseAccountCode: string;
  expenseAccountName: string | null;
  basicSalary: number;
  overtime: number;
  bonus: number;
  incentiveKpi: number;
  otherEarnings: number;
  grossSalary: number;
  socialInsurance: number;
  incomeTax: number;
  advances: number;
  penalties: number;
  otherDeductions: number;
  totalDeductions: number;
  netSalary: number;
  notes: string | null;
  allocations?: PayrollRunLineAllocation[];
}

export interface PayrollRun {
  id: string;
  runNumber: string;
  periodMonth: number;
  periodYear: number;
  periodLabel: string;
  description: string | null;
  status: 'draft' | 'accrued' | 'paid';
  accrualDate: string | null;
  accrualTransactionId: string | null;
  paymentDate: string | null;
  paymentAccountCode: string | null;
  paymentAccountName: string | null;
  paymentTransactionId: string | null;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  lines?: PayrollRunLine[];
}

/** Payload for creating/replacing a payroll line (server computes gross/net/totals). */
export interface PayrollLineInput {
  employeeId?: string | null;
  employeeCode: string;
  employeeName: string;
  department?: string | null;
  costCenterId?: string | null;
  costCenterType?: string | null;
  costCenterCode?: string | null;
  expenseAccountCode?: string;
  expenseAccountName?: string | null;
  basicSalary?: number;
  overtime?: number;
  bonus?: number;
  incentiveKpi?: number;
  otherEarnings?: number;
  socialInsurance?: number;
  incomeTax?: number;
  advances?: number;
  penalties?: number;
  otherDeductions?: number;
  notes?: string | null;
}

export const payrollApi = {
  // Employees
  listEmployees: (params?: { status?: string; department?: string }) =>
    apiClient.get<PayrollEmployee[]>(`/payroll/employees${buildQuery({ status: params?.status, department: params?.department })}`),
  createEmployee: (data: Partial<PayrollEmployee> & { employeeCode: string; name: string }) =>
    offlinePost<PayrollEmployee>('/payroll/employees', data, {
      opType: 'payroll.employee.create',
      opClass: 'safe_save',
      summary: 'Create payroll employee',
    }),
  updateEmployee: (id: string, data: Partial<PayrollEmployee>) =>
    offlinePut<PayrollEmployee>(`/payroll/employees/${encodeURIComponent(id)}`, data, {
      opType: 'payroll.employee.update',
      opClass: 'safe_save',
      summary: `Update employee ${id}`,
    }),
  removeEmployee: (id: string) => apiClient.delete<{ ok: boolean }>(`/payroll/employees/${id}`),
  importEmployees: (rows: Array<Partial<PayrollEmployee> & { carriedLeaveDays?: number }>) =>
    offlinePost<{ created: number; updated: number; errors: Array<{ row: number; error: string }> }>(
      '/payroll/employees/import',
      { rows },
      {
        opType: 'payroll.employee.create',
        opClass: 'safe_save',
        summary: 'Import payroll employees',
      },
    ),

  // Runs
  listRuns: (params?: { status?: string; year?: number }) =>
    apiClient.get<PayrollRun[]>(`/payroll/runs${buildQuery({ status: params?.status, year: params?.year?.toString() })}`),
  getRun: (id: string) => apiClient.get<PayrollRun>(`/payroll/runs/${id}`),
  createRun: (data: { periodMonth: number; periodYear: number; description?: string; lines?: PayrollLineInput[] }) =>
    offlinePost<PayrollRun>('/payroll/runs', data, {
      opType: 'payroll.run.create',
      opClass: 'safe_save',
      summary: 'Create payroll run',
    }),
  replaceLines: (id: string, lines: PayrollLineInput[]) =>
    offlinePut<PayrollRun>(`/payroll/runs/${encodeURIComponent(id)}/lines`, { lines }, {
      opType: 'payroll.run.lines',
      opClass: 'safe_save',
      summary: `Save payroll run lines ${id}`,
    }),
  removeRun: (id: string) => apiClient.delete<{ ok: boolean }>(`/payroll/runs/${id}`),
  accrue: (id: string, accrualDate?: string) =>
    offlinePost<PayrollRun & { transactionId: string }>(
      `/payroll/runs/${encodeURIComponent(id)}/accrue`,
      { accrualDate },
      {
        opType: 'payroll.run.accrue',
        opClass: 'confirm_required',
        summary: `Accrue payroll run ${id}`,
      },
    ),
  accruePreview: (id: string) =>
    apiClient.get<JournalPreviewResponse>(`/payroll/runs/${encodeURIComponent(id)}/accrue-preview`),
  pay: (id: string, data: { paymentAccountCode: string; paymentAccountName?: string; paymentDate?: string }) =>
    offlinePost<PayrollRun & { transactionId: string }>(
      `/payroll/runs/${encodeURIComponent(id)}/pay`,
      data,
      {
        opType: 'payroll.run.pay',
        opClass: 'confirm_required',
        summary: `Pay payroll run ${id}`,
      },
    ),
  reopen: (id: string) =>
    offlinePost<PayrollRun>(`/payroll/runs/${encodeURIComponent(id)}/reopen`, {}, {
      opType: 'payroll.run.reopen',
      opClass: 'confirm_required',
      summary: `Reopen payroll run ${id}`,
    }),

  // Employee default cost-center split
  getEmployeeAllocations: (employeeId: string) =>
    apiClient.get<EmployeeCostCenterAllocation[]>(`/payroll/employees/${employeeId}/cost-center-allocations`),
  setEmployeeAllocations: (employeeId: string, allocations: EmployeeCostCenterAllocation[]) =>
    offlinePut<EmployeeCostCenterAllocation[]>(
      `/payroll/employees/${encodeURIComponent(employeeId)}/cost-center-allocations`,
      { allocations },
      {
        opType: 'payroll.employee.allocations',
        opClass: 'safe_save',
        summary: `Employee cost centers ${employeeId}`,
      },
    ),
  setRunLineAllocations: (lineId: string, allocations: Array<Omit<PayrollRunLineAllocation, 'amount' | 'id' | 'runLineId'>>) =>
    offlinePut<PayrollRunLineAllocation[]>(
      `/payroll/run-lines/${encodeURIComponent(lineId)}/allocations`,
      { allocations },
      {
        opType: 'payroll.run.lines',
        opClass: 'safe_save',
        summary: `Run line allocations ${lineId}`,
      },
    ),

  // Salary notifications
  notifySalaries: (id: string, languageCode?: string) =>
    apiClient.post<{ queued: number; skipped: number; dryRun: boolean }>(`/payroll/runs/${id}/notify-salaries`, { languageCode }),
};

export interface JournalPreviewLine {
  accountCode: string;
  accountName?: string;
  debit: number;
  credit: number;
  costCenterId?: string;
}

export interface JournalPreviewResponse {
  reference: string;
  description: string;
  entries: JournalPreviewLine[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export interface AttendanceRule {
  id: string;
  workingDaysPerMonth: number;
  dailyWorkHours: number;
  overtimeMultiplier: number;
  lateGraceMins: number;
  lateTier1Mins: number;
  lateTier2Mins: number;
  lateTier3Mins: number;
  lateAboveTier3: string;
  absenceDeduction: string;
  absenceFixedAmount: number | null;
}

export interface AttendanceImportLine {
  id?: string;
  employeeCode: string;
  employeeName?: string | null;
  daysPresent?: number;
  daysAbsent?: number;
  daysPaidLeave?: number;
  leaveBreakdown?: Record<string, number> | null;
  lateMinutes?: number;
  directPenalties?: number;
  overtimeHours?: number;
  notes?: string | null;
}

export interface AttendanceImport {
  id: string;
  periodMonth: number;
  periodYear: number;
  fileName: string;
  rowCount: number;
  importedBy: string | null;
  createdAt: string;
  lines?: AttendanceImportLine[];
  lineCount?: number;
}

export interface AttendancePreviewRow {
  employeeCode: string;
  employeeName: string;
  employeeId: string | null;
  department: string | null;
  costCenterId: string | null;
  costCenterType: string | null;
  costCenterCode: string | null;
  expenseAccountCode: string;
  expenseAccountName: string | null;
  basicSalary: number;
  overtime: number;
  socialInsurance: number;
  incomeTax: number;
  penalties: number;
  penaltyDays?: number;
  penaltyDaysDeduction?: number;
  absenceDeduction: number;
  lateDeduction: number;
  grossSalary: number;
  netSalary: number;
  daysPresent: number;
  daysAbsent: number;
  daysPaidLeave: number;
  lateMinutes: number;
  overtimeHours: number;
  notes: string | null;
  matched: boolean;
  warning?: string;
}

export interface LeaveType {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  paid: boolean;
  affectsAnnualBalance: boolean;
  defaultAnnualDays: number;
  sortOrder: number;
  isActive: boolean;
}

export interface OfficialHoliday {
  id: string;
  holidayDate: string;
  year: number;
  nameAr: string;
  nameEn: string;
}

export interface EmployeeLeaveBalance {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  year: number;
  entitledDays: number;
  carriedDays: number;
  usedDays: number;
  notes: string | null;
  employeeCode: string;
  employeeName: string;
  leaveTypeCode: string;
  leaveTypeNameAr: string;
  leaveTypeNameEn: string;
}

export const attendanceApi = {
  getRules: () => apiClient.get<AttendanceRule>('/payroll/attendance-rules'),
  updateRules: (data: Partial<AttendanceRule>) =>
    apiClient.put<AttendanceRule>('/payroll/attendance-rules', data),
  listImports: (params?: { year?: number; month?: number }) =>
    apiClient.get<AttendanceImport[]>(`/payroll/attendance-imports${buildQuery({ year: params?.year?.toString(), month: params?.month?.toString() })}`),
  getImport: (id: string) => apiClient.get<AttendanceImport>(`/payroll/attendance-imports/${id}`),
  createImport: (data: { periodMonth: number; periodYear: number; fileName: string; lines: AttendanceImportLine[] }) =>
    apiClient.post<AttendanceImport>('/payroll/attendance-imports', data),
  previewAttendance: (runId: string, data: { importId?: string; lines?: AttendanceImportLine[] }) =>
    apiClient.post<{ preview: AttendancePreviewRow[]; rule: AttendanceRule }>(
      `/payroll/runs/${runId}/apply-attendance`,
      { ...data, mode: 'preview' },
    ),
  applyAttendance: (runId: string, data: { importId?: string; lines?: AttendanceImportLine[] }) =>
    apiClient.post<{ preview: AttendancePreviewRow[]; run: PayrollRun }>(
      `/payroll/runs/${runId}/apply-attendance`,
      { ...data, mode: 'apply' },
    ),
};

export const leaveTypesApi = {
  list: () => apiClient.get<LeaveType[]>('/payroll/leave-types'),
  create: (data: Partial<LeaveType>) => apiClient.post<LeaveType>('/payroll/leave-types', data),
  update: (id: string, data: Partial<LeaveType>) => apiClient.patch<LeaveType>(`/payroll/leave-types/${id}`, data),
  remove: (id: string) => apiClient.delete<{ ok: boolean }>(`/payroll/leave-types/${id}`),
};

export const officialHolidaysApi = {
  list: (year?: number) =>
    apiClient.get<OfficialHoliday[]>(`/payroll/official-holidays${buildQuery({ year: year?.toString() })}`),
  create: (data: { holidayDate: string; nameAr: string; nameEn: string }) =>
    apiClient.post<OfficialHoliday>('/payroll/official-holidays', data),
  update: (id: string, data: Partial<{ holidayDate: string; nameAr: string; nameEn: string }>) =>
    apiClient.patch<OfficialHoliday>(`/payroll/official-holidays/${id}`, data),
  remove: (id: string) => apiClient.delete<{ ok: boolean }>(`/payroll/official-holidays/${id}`),
};

export const leaveBalancesApi = {
  list: (params?: { year?: number; employeeId?: string }) =>
    apiClient.get<EmployeeLeaveBalance[]>(
      `/payroll/leave-balances${buildQuery({ year: params?.year?.toString(), employeeId: params?.employeeId })}`,
    ),
  upsert: (data: { employeeId: string; leaveTypeId: string; year: number; entitledDays: number; carriedDays: number; usedDays: number; notes?: string | null }) =>
    apiClient.put<EmployeeLeaveBalance>('/payroll/leave-balances', data),
  initialize: (year: number) =>
    apiClient.post<{ created: number }>('/payroll/leave-balances/initialize', { year }),
  recomputeUsed: (year: number) =>
    apiClient.post<{ updated: number; created: number }>('/payroll/leave-balances/recompute-used', { year }),
};
