import type { UserPermissions } from '../types';
import { canOpenModuleView } from './moduleViewPermissions';
import { canOpenShellModule } from './permissions';
import {
  billingFocusFromNotification,
  boqFocusFromNotification,
  resolveShellNavigation,
  setPendingBillingFocus,
  setPendingBoqFocus,
  setPendingCostsIpcId,
  setPendingCustodySettlementId,
  setPendingPurchaseRequestId,
  setPendingShellView,
} from './shellNavigation';

export type NotificationNavItem = {
  type: string;
  moduleId: string;
  entityId?: string;
  contractId?: string;
  projectId?: string;
};

export type NotificationNavTarget = {
  moduleId: string;
  viewId: string;
};

const INVENTORY_TRANSFER_TYPES = new Set([
  'transfer_pending_b',
  'transfer_pending_projects',
]);

const BANK_TRANSACTION_TYPES = new Set([
  'cheque_pending',
  'cheque_overdue',
  'bank_movement_draft',
]);

const BILLING_MODULE_TYPES = new Set([
  'mos_draft',
  'billing_submitted',
  'billing_review',
]);

/** Default sub-view when a notification only carries a shell module id. */
function defaultViewForModule(moduleId: string): string {
  switch (moduleId) {
    case 'technical':
      return 'projects';
    case 'ledger':
      return 'journal';
    case 'costs':
      return 'invoice';
    case 'inventory':
      return 'balance';
    case 'banks':
      return 'transactions';
    case 'purchase_requests':
      return 'open';
    case 'reports':
      return 'income';
    case 'assets':
      return 'register';
    case 'payroll':
      return 'runs';
    case 'dashboard':
      return 'main';
    case 'settings':
      return 'database';
    default:
      return 'main';
  }
}

/**
 * Map an inbox notification to the shell module + sub-view that owns the source document.
 * Does not write pending-focus state — call {@link prepareNotificationNavigation} before open.
 */
export function resolveNotificationNavigation(item: NotificationNavItem): NotificationNavTarget {
  if (item.type === 'purchase_request_pending') {
    return { moduleId: 'purchase_requests', viewId: 'open' };
  }
  if (item.type === 'subcontractor_ipc_pending' || item.type === 'subcontract_extract_pending') {
    return { moduleId: 'costs', viewId: 'ipc' };
  }
  if (item.type === 'custody_settlement_pending') {
    return { moduleId: 'costs', viewId: 'custody' };
  }
  if (item.type === 'overhead_draft') {
    return { moduleId: 'ledger', viewId: 'periods' };
  }
  if (INVENTORY_TRANSFER_TYPES.has(item.type)) {
    return { moduleId: 'inventory', viewId: 'transfers' };
  }
  if (item.type === 'consumption_draft' || item.type === 'consumption_pending_cost') {
    return { moduleId: 'inventory', viewId: 'history' };
  }
  if (item.type === 'warehouse_receipt_pending') {
    return { moduleId: 'costs', viewId: 'invoice' };
  }
  if (BANK_TRANSACTION_TYPES.has(item.type)) {
    return { moduleId: 'banks', viewId: 'transactions' };
  }

  const billingFocus = billingFocusFromNotification(item);
  if (billingFocus || BILLING_MODULE_TYPES.has(item.type) || item.moduleId === 'billing') {
    return { moduleId: 'technical', viewId: 'billing' };
  }

  const boqFocus = boqFocusFromNotification(item);
  if (boqFocus || item.type === 'vo_submitted' || item.moduleId === 'boq') {
    return { moduleId: 'technical', viewId: 'boq' };
  }

  const resolved = resolveShellNavigation(item.moduleId);
  const moduleId = resolved.moduleId;
  const viewId = resolved.viewId ?? defaultViewForModule(moduleId);
  return { moduleId, viewId };
}

/** Write deep-link pending state (tab + entity) for a resolved target. */
export function applyNotificationNavigationPending(
  item: NotificationNavItem,
  target: NotificationNavTarget = resolveNotificationNavigation(item),
): void {
  const billingFocus = billingFocusFromNotification(item);
  if (billingFocus) {
    setPendingBillingFocus(billingFocus);
  }

  const boqFocus = boqFocusFromNotification(item);
  if (boqFocus) {
    setPendingBoqFocus(boqFocus);
  }

  if (item.type === 'subcontractor_ipc_pending' && item.entityId) {
    setPendingCostsIpcId(item.entityId);
  }
  if (item.type === 'custody_settlement_pending' && item.entityId) {
    setPendingCustodySettlementId(item.entityId);
  }
  if (item.type === 'purchase_request_pending' && item.entityId) {
    setPendingPurchaseRequestId(item.entityId);
  }

  setPendingShellView(target.moduleId, target.viewId);
}

/**
 * Set deep-link pending state (tab + entity) then return the navigation target.
 * Call only after permission checks succeed.
 */
export function prepareNotificationNavigation(item: NotificationNavItem): NotificationNavTarget {
  const target = resolveNotificationNavigation(item);
  applyNotificationNavigationPending(item, target);
  return target;
}

export function canNavigateToNotificationTarget(
  permissions: UserPermissions,
  target: NotificationNavTarget,
  opts?: { isAdmin?: boolean },
): boolean {
  if (!canOpenShellModule(permissions, target.moduleId, opts)) return false;
  return canOpenModuleView(permissions, target.moduleId, target.viewId, opts);
}
