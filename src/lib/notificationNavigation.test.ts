import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS } from '../types';
import {
  canNavigateToNotificationTarget,
  resolveNotificationNavigation,
} from './notificationNavigation';

describe('resolveNotificationNavigation', () => {
  it('maps purchase request to open list', () => {
    expect(
      resolveNotificationNavigation({
        type: 'purchase_request_pending',
        moduleId: 'purchase_requests',
        entityId: 'pr-1',
      }),
    ).toEqual({ moduleId: 'purchase_requests', viewId: 'open' });
  });

  it('maps subcontractor IPC and extract to costs ipc tab', () => {
    expect(
      resolveNotificationNavigation({
        type: 'subcontractor_ipc_pending',
        moduleId: 'costs',
        entityId: 'ipc-1',
      }),
    ).toEqual({ moduleId: 'costs', viewId: 'ipc' });
    expect(
      resolveNotificationNavigation({
        type: 'subcontract_extract_pending',
        moduleId: 'costs',
        entityId: 'ex-1',
      }),
    ).toEqual({ moduleId: 'costs', viewId: 'ipc' });
  });

  it('maps custody settlement to costs custody tab', () => {
    expect(
      resolveNotificationNavigation({
        type: 'custody_settlement_pending',
        moduleId: 'costs',
        entityId: 'set-1',
      }),
    ).toEqual({ moduleId: 'costs', viewId: 'custody' });
  });

  it('maps inventory transfers and consumption drafts', () => {
    expect(
      resolveNotificationNavigation({
        type: 'transfer_pending_projects',
        moduleId: 'inventory',
        entityId: 'tr-1',
      }),
    ).toEqual({ moduleId: 'inventory', viewId: 'transfers' });
    expect(
      resolveNotificationNavigation({
        type: 'consumption_draft',
        moduleId: 'inventory',
        entityId: 'con-1',
      }),
    ).toEqual({ moduleId: 'inventory', viewId: 'history' });
    expect(
      resolveNotificationNavigation({
        type: 'consumption_pending_cost',
        moduleId: 'inventory',
        entityId: 'con-2',
      }),
    ).toEqual({ moduleId: 'inventory', viewId: 'history' });
    expect(
      resolveNotificationNavigation({
        type: 'warehouse_receipt_pending',
        moduleId: 'inventory',
        entityId: 'wr-1',
      }),
    ).toEqual({ moduleId: 'inventory', viewId: 'receipts' });
  });

  it('maps bank cheques and movement drafts to transactions', () => {
    expect(
      resolveNotificationNavigation({
        type: 'cheque_overdue',
        moduleId: 'banks',
        entityId: 'ch-1',
      }),
    ).toEqual({ moduleId: 'banks', viewId: 'transactions' });
    expect(
      resolveNotificationNavigation({
        type: 'bank_movement_draft',
        moduleId: 'banks',
        entityId: 'mv-1',
      }),
    ).toEqual({ moduleId: 'banks', viewId: 'transactions' });
  });

  it('maps billing and VO via technical office views', () => {
    expect(
      resolveNotificationNavigation({
        type: 'billing_submitted',
        moduleId: 'billing',
        entityId: 'b-1',
        contractId: 'c-1',
      }),
    ).toEqual({ moduleId: 'technical', viewId: 'billing' });
    expect(
      resolveNotificationNavigation({
        type: 'vo_submitted',
        moduleId: 'boq',
        entityId: 'vo-1',
        contractId: 'c-1',
      }),
    ).toEqual({ moduleId: 'technical', viewId: 'boq' });
  });

  it('maps overhead draft to ledger periods', () => {
    expect(
      resolveNotificationNavigation({
        type: 'overhead_draft',
        moduleId: 'ledger',
        entityId: 'oha-1',
      }),
    ).toEqual({ moduleId: 'ledger', viewId: 'periods' });
  });
});

describe('canNavigateToNotificationTarget', () => {
  it('allows admin for any target', () => {
    expect(
      canNavigateToNotificationTarget(
        DEFAULT_PERMISSIONS,
        { moduleId: 'costs', viewId: 'ipc' },
        { isAdmin: true },
      ),
    ).toBe(true);
  });

  it('denies costs ipc without costs_ipc permission', () => {
    expect(
      canNavigateToNotificationTarget(
        DEFAULT_PERMISSIONS,
        { moduleId: 'costs', viewId: 'ipc' },
      ),
    ).toBe(false);
  });

  it('allows purchase requests for any signed-in permission set', () => {
    expect(
      canNavigateToNotificationTarget(
        DEFAULT_PERMISSIONS,
        { moduleId: 'purchase_requests', viewId: 'open' },
      ),
    ).toBe(true);
  });

  it('allows full permissions for inventory transfers', () => {
    expect(
      canNavigateToNotificationTarget(
        ALL_PERMISSIONS,
        { moduleId: 'inventory', viewId: 'transfers' },
      ),
    ).toBe(true);
  });
});
