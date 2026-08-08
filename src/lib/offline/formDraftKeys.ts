/** Canonical form draft keys for offline autosave (local backend). */
export const FORM_DRAFT_KEYS = {
  purchaseRequestNew: 'purchase_request:new',
  consumption: (projectId: string, contractId: string) =>
    `consumption:${projectId}:${contractId}:new`,
  returnOrder: (projectId: string, contractId: string) =>
    `return:${projectId}:${contractId}:new`,
  invoiceNew: 'costs_invoice:new',
  ipcSubNew: 'costs_ipc:new',
  custodyNew: 'costs_custody:new',
  billingIpc: (contractId: string) => `billing_ipc:${contractId}:new`,
  mosNew: (contractId: string) => `mos:${contractId}:new`,
  bankMovementNew: 'bank_movement:new',
  bankChequeNew: 'bank_cheque:new',
  glJournalNew: 'gl_journal:new',
  warehouseReceiptNew: (projectId: string) => `warehouse_receipt:${projectId}:new`,
} as const;
