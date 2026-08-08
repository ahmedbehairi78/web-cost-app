import { DEFAULT_MODULE, NONE_DEFAULT_MODULE, isNoDefaultModule, normalizeDefaultModule } from '../constants/modules';

/** Legacy standalone modules merged into shell parents (view preserved). */
export const LEGACY_SHELL_MODULE_MAP: Record<string, { moduleId: string; viewId: string }> = {
  projects: { moduleId: 'technical', viewId: 'projects' },
  boq: { moduleId: 'technical', viewId: 'boq' },
  billing: { moduleId: 'technical', viewId: 'billing' },
  overhead: { moduleId: 'ledger', viewId: 'periods' },
};

export function resolveShellNavigation(
  moduleId: string,
  viewId?: string,
): { moduleId: string; viewId?: string } {
  const legacy = LEGACY_SHELL_MODULE_MAP[moduleId];
  if (legacy) {
    return { moduleId: legacy.moduleId, viewId: viewId ?? legacy.viewId };
  }
  return { moduleId, viewId };
}

let pendingShellView: { moduleId: string; viewId: string } | null = null;

/** Sidebar window open — pass initial sub-view into composite modules. */
export function setPendingShellView(moduleId: string, viewId: string): void {
  pendingShellView = { moduleId, viewId };
}

/** Read pending view without clearing (for initial tab state before mount effects). */
export function peekPendingShellView(moduleId: string): string | undefined {
  if (pendingShellView?.moduleId !== moduleId) return undefined;
  return pendingShellView.viewId;
}

export function consumePendingShellView(moduleId: string): string | undefined {
  if (pendingShellView?.moduleId !== moduleId) return undefined;
  const viewId = pendingShellView.viewId;
  pendingShellView = null;
  return viewId;
}

export type PendingBillingFocus = {
  contractId: string;
  projectId?: string;
  docType?: 'mos' | 'ipc';
  entityId?: string;
};

let pendingBillingFocus: PendingBillingFocus | null = null;

/** Open Technical Office → Billing with contract + optional MOS/IPC highlight. */
export function setPendingBillingFocus(focus: PendingBillingFocus): void {
  pendingBillingFocus = focus;
}

export function consumePendingBillingFocus(): PendingBillingFocus | undefined {
  const focus = pendingBillingFocus ?? undefined;
  pendingBillingFocus = null;
  return focus;
}

export type PendingBoqFocus = {
  contractId: string;
  projectId?: string;
  variationOrderId?: string;
};

let pendingBoqFocus: PendingBoqFocus | null = null;

/** Open Technical Office → BOQ with contract + optional VO highlight. */
export function setPendingBoqFocus(focus: PendingBoqFocus): void {
  pendingBoqFocus = focus;
}

export function consumePendingBoqFocus(): PendingBoqFocus | undefined {
  const focus = pendingBoqFocus ?? undefined;
  pendingBoqFocus = null;
  return focus;
}

const BOQ_NOTIFICATION_TYPES = new Set(['vo_submitted']);

/** Map inbox notification → BOQ tab focus (VO highlight). */
export function boqFocusFromNotification(item: {
  type: string;
  entityId?: string;
  contractId?: string;
  projectId?: string;
}): PendingBoqFocus | null {
  if (!item.contractId || !item.entityId || !BOQ_NOTIFICATION_TYPES.has(item.type)) {
    return null;
  }
  return {
    contractId: item.contractId,
    projectId: item.projectId,
    variationOrderId: item.entityId,
  };
}

const BILLING_NOTIFICATION_TYPES = new Set([
  'mos_draft',
  'billing_submitted',
  'billing_review',
]);

/** Map inbox notification → billing tab focus (MOS / IPC highlight). */
export function billingFocusFromNotification(item: {
  type: string;
  entityId?: string;
  contractId?: string;
  projectId?: string;
}): PendingBillingFocus | null {
  if (!item.contractId || !item.entityId || !BILLING_NOTIFICATION_TYPES.has(item.type)) {
    return null;
  }
  return {
    contractId: item.contractId,
    projectId: item.projectId,
    docType: item.type === 'mos_draft' ? 'mos' : 'ipc',
    entityId: item.entityId,
  };
}

let pendingCostsIpcId: string | null = null;

/** Open Actual Costs → IPC tab and load a purchase transaction by id. */
export function setPendingCostsIpcId(id: string): void {
  pendingCostsIpcId = id;
}

export function consumePendingCostsIpcId(): string | undefined {
  const id = pendingCostsIpcId ?? undefined;
  pendingCostsIpcId = null;
  return id;
}

let pendingCustodySettlementId: string | null = null;

/** Open Actual Costs → custody tab and load a settlement by id. */
export function setPendingCustodySettlementId(id: string): void {
  pendingCustodySettlementId = id;
}

export function consumePendingCustodySettlementId(): string | undefined {
  const id = pendingCustodySettlementId ?? undefined;
  pendingCustodySettlementId = null;
  return id;
}

let pendingPurchaseRequestId: string | null = null;

/** Open Purchase Requests module and highlight a request by id. */
export function setPendingPurchaseRequestId(id: string): void {
  pendingPurchaseRequestId = id;
}

export function consumePendingPurchaseRequestId(): string | undefined {
  const id = pendingPurchaseRequestId ?? undefined;
  pendingPurchaseRequestId = null;
  return id;
}

/** Saved startup module — maps legacy ids to shell parent + sub-view. */
export function resolveStartupModule(raw: string | undefined | null): { moduleId: string | null; viewId?: string } {
  if (isNoDefaultModule(raw)) return { moduleId: null };
  if (!raw) return { moduleId: DEFAULT_MODULE };
  const legacy = LEGACY_SHELL_MODULE_MAP[raw];
  if (legacy) return { moduleId: legacy.moduleId, viewId: legacy.viewId };
  return { moduleId: normalizeDefaultModule(raw) };
}

/** Apply stored user preference to startup module ref (never map «none» → ledger). */
export function resolveSavedDefaultModulePreference(raw: string | null | undefined): {
  moduleId: string;
  viewId?: string;
} {
  if (isNoDefaultModule(raw)) {
    return { moduleId: NONE_DEFAULT_MODULE };
  }
  if (raw == null || String(raw).trim() === '') {
    return { moduleId: DEFAULT_MODULE };
  }
  const startup = resolveStartupModule(raw);
  if (startup.moduleId == null) {
    return { moduleId: NONE_DEFAULT_MODULE };
  }
  return { moduleId: startup.moduleId, viewId: startup.viewId };
}

export function parseDefaultModuleSelectValue(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === '') return DEFAULT_MODULE;
  if (isNoDefaultModule(raw)) return NONE_DEFAULT_MODULE;
  return normalizeDefaultModule(String(raw));
}
