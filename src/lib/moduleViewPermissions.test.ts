import { describe, expect, it } from 'vitest';
import { DEFAULT_PERMISSIONS } from '../types';
import { buildPermissionsForRole, crudOff, crudOn } from './permissions';
import {
  canOpenModuleView,
  firstPermittedModuleView,
  permissionKeyForModuleView,
} from './moduleViewPermissions';

describe('moduleViewPermissions', () => {
  it('ledger journal/statement require ledger.view; periods require overhead.view', () => {
    const ledgerOnly = {
      ...DEFAULT_PERMISSIONS,
      ledger: crudOn(),
    };
    expect(canOpenModuleView(ledgerOnly, 'ledger', 'journal')).toBe(true);
    expect(canOpenModuleView(ledgerOnly, 'ledger', 'statement')).toBe(true);
    expect(canOpenModuleView(ledgerOnly, 'ledger', 'periods')).toBe(false);

    const periodsOnly = {
      ...DEFAULT_PERMISSIONS,
      overhead: crudOn(),
    };
    expect(canOpenModuleView(periodsOnly, 'ledger', 'journal')).toBe(false);
    expect(canOpenModuleView(periodsOnly, 'ledger', 'periods')).toBe(true);
  });

  it('technical views map to projects/boq/billing/documents', () => {
    const pm = buildPermissionsForRole('projects_manager');
    expect(canOpenModuleView(pm, 'technical', 'projects')).toBe(true);
    expect(canOpenModuleView(pm, 'technical', 'boq')).toBe(true);
    expect(canOpenModuleView(pm, 'technical', 'billing')).toBe(true);
    expect(canOpenModuleView(pm, 'technical', 'documents')).toBe(true);
  });

  it('costs custody allows costs or ledger view', () => {
    const ledgerOnly = { ...DEFAULT_PERMISSIONS, ledger: crudOn() };
    expect(canOpenModuleView(ledgerOnly, 'costs', 'custody')).toBe(true);
    expect(canOpenModuleView(ledgerOnly, 'costs', 'invoice')).toBe(false);
  });

  it('settings sub-views use settings flag', () => {
    const withSettings = { ...DEFAULT_PERMISSIONS, settings: true };
    expect(canOpenModuleView(withSettings, 'settings', 'database')).toBe(true);
    expect(canOpenModuleView(withSettings, 'settings', 'users')).toBe(true);
    expect(canOpenModuleView(withSettings, 'settings', 'cost_centers')).toBe(true);
    expect(canOpenModuleView(withSettings, 'settings', 'activity')).toBe(true);
    expect(canOpenModuleView(DEFAULT_PERMISSIONS, 'settings', 'database')).toBe(false);
  });

  it('firstPermittedModuleView skips denied ledger tabs', () => {
    const periodsOnly = { ...DEFAULT_PERMISSIONS, overhead: crudOn() };
    expect(firstPermittedModuleView(periodsOnly, 'ledger')).toBe('periods');

    const ledgerOnly = { ...DEFAULT_PERMISSIONS, ledger: crudOn() };
    expect(firstPermittedModuleView(ledgerOnly, 'ledger')).toBe('journal');
  });

  it('permissionKeyForModuleView maps periods to overhead', () => {
    expect(permissionKeyForModuleView('ledger', 'periods')).toBe('overhead');
    expect(permissionKeyForModuleView('ledger', 'journal')).toBe('ledger');
    expect(permissionKeyForModuleView('settings', 'users')).toBe('settings');
  });

  it('purchase_requests is open for all signed-in users (including DEFAULT_PERMISSIONS)', () => {
    expect(canOpenModuleView(DEFAULT_PERMISSIONS, 'purchase_requests', 'create')).toBe(true);
    expect(canOpenModuleView(DEFAULT_PERMISSIONS, 'purchase_requests', 'open')).toBe(true);
    expect(canOpenModuleView(DEFAULT_PERMISSIONS, 'purchase_requests', 'executed')).toBe(true);
    expect(firstPermittedModuleView(DEFAULT_PERMISSIONS, 'purchase_requests')).toBe('create');
  });

  it('cash_budget requires cash_budget.view (not open for DEFAULT_PERMISSIONS)', () => {
    expect(canOpenModuleView(DEFAULT_PERMISSIONS, 'cash_budget', 'main')).toBe(false);
    expect(canOpenModuleView({ ...DEFAULT_PERMISSIONS, cash_budget: crudOn() }, 'cash_budget', 'main')).toBe(true);
    expect(firstPermittedModuleView({ ...DEFAULT_PERMISSIONS, cash_budget: crudOn() }, 'cash_budget')).toBe('main');
  });
});
