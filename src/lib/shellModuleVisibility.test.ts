import { describe, expect, it } from 'vitest';
import {
  isFullVisibleShellModulesWhitelist,
  isShellModuleNavVisible,
  isVisibleShellModuleId,
  normalizeVisibleShellModules,
  VISIBLE_SHELL_MODULE_IDS,
} from './shellModuleVisibility';

describe('shellModuleVisibility', () => {
  it('accepts known toggleable module ids', () => {
    expect(isVisibleShellModuleId('dashboard')).toBe(true);
    expect(isVisibleShellModuleId('purchase_requests')).toBe(true);
    expect(isVisibleShellModuleId('calculator')).toBe(false);
    expect(isVisibleShellModuleId('')).toBe(false);
  });

  it('normalize: null / missing / non-array → null (show all)', () => {
    expect(normalizeVisibleShellModules(null)).toBeNull();
    expect(normalizeVisibleShellModules(undefined)).toBeNull();
    expect(normalizeVisibleShellModules('dashboard')).toBeNull();
    expect(normalizeVisibleShellModules({})).toBeNull();
  });

  it('normalize: filters invalid and duplicates', () => {
    expect(
      normalizeVisibleShellModules(['dashboard', 'bogus', 'dashboard', 'reports']),
    ).toEqual(['dashboard', 'reports']);
  });

  it('normalize: empty array stays empty whitelist', () => {
    expect(normalizeVisibleShellModules([])).toEqual([]);
  });

  it('nav visible: null whitelist shows all toggleable', () => {
    expect(isShellModuleNavVisible('reports', null)).toBe(true);
    expect(isShellModuleNavVisible('reports', undefined)).toBe(true);
  });

  it('nav visible: whitelist hides others', () => {
    expect(isShellModuleNavVisible('reports', ['dashboard', 'costs'])).toBe(false);
    expect(isShellModuleNavVisible('costs', ['dashboard', 'costs'])).toBe(true);
  });

  it('nav visible: utilities always shown', () => {
    expect(isShellModuleNavVisible('calculator', [])).toBe(true);
    expect(isShellModuleNavVisible('general', ['dashboard'])).toBe(true);
    expect(isShellModuleNavVisible('manual', null)).toBe(true);
    expect(isShellModuleNavVisible('display', [])).toBe(true);
  });

  it('full whitelist detection', () => {
    expect(isFullVisibleShellModulesWhitelist(null)).toBe(true);
    expect(isFullVisibleShellModulesWhitelist([...VISIBLE_SHELL_MODULE_IDS])).toBe(true);
    expect(isFullVisibleShellModulesWhitelist(['dashboard'])).toBe(false);
  });
});
