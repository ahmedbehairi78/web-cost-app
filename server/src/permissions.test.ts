import { describe, expect, it } from 'vitest';
import {
  buildPermissionsForRole,
  hasModuleView,
  hasModuleWrite,
  hasReferenceRead,
  normalizeUserPermissions,
} from './permissions.js';

describe('server permissions', () => {
  it('project_accountant with costs.create can read COA reference without ledger.view', () => {
    const perms = buildPermissionsForRole('project_accountant');
    expect(hasModuleView(perms, 'ledger')).toBe(false);
    expect(hasReferenceRead(perms, 'ledger')).toBe(false);
    expect(hasReferenceRead(perms, 'costs')).toBe(true);
    expect(hasModuleWrite(perms, 'costs')).toBe(true);
  });

  it('projects_manager can view costs reference but not write', () => {
    const perms = buildPermissionsForRole('projects_manager');
    expect(hasReferenceRead(perms, 'costs')).toBe(true);
    expect(hasModuleWrite(perms, 'costs')).toBe(false);
    expect(hasModuleWrite(perms, 'inventory')).toBe(true);
  });

  it('legacy flat boolean true expands to full CRUD', () => {
    const perms = normalizeUserPermissions({ costs: true });
    expect(hasModuleView(perms, 'costs')).toBe(true);
    expect(hasModuleWrite(perms, 'costs')).toBe(true);
  });

  it('transfers alias maps to inventory', () => {
    const perms = buildPermissionsForRole('project_accountant');
    expect(hasReferenceRead(perms, 'transfers')).toBe(true);
  });
});
