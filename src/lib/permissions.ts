import {
  ALL_PERMISSIONS as FULL_ACCESS,
  DEFAULT_PERMISSIONS,
  type ModuleCrudPermission,
  type PermissionKey,
  type UserRole,
  type UserPermissions,
} from '../types';
import {
  NONE_DEFAULT_MODULE,
  STARTUP_MODULES,
  isNoDefaultModule,
} from '../constants/modules';
import { LEGACY_SHELL_MODULE_MAP } from './shellNavigation';
import {
  canOpenModuleView,
  firstPermittedModuleView,
  permissionKeyForModuleView,
} from './moduleViewPermissions';
import { isShellModuleNavVisible } from './shellModuleVisibility';

const CRUD_KEYS = [
  'ledger',
  'projects',
  'boq',
  'billing',
  'costs_invoice',
  'costs_ipc',
  'costs_custody',
  'suppliers',
  'banks',
  'inventory',
  'subcontractor',
  'overhead',
  'assets',
  'payroll',
  'purchase_requests',
] as const satisfies readonly PermissionKey[];

/** Sub-keys that form the virtual `costs` umbrella. */
const COSTS_SUB_KEYS = ['costs_invoice', 'costs_ipc', 'costs_custody'] as const satisfies readonly PermissionKey[];

const BOOL_KEYS = ['dashboard', 'reports', 'settings'] as const satisfies readonly PermissionKey[];

export function crudOff(): ModuleCrudPermission {
  return { view: false, create: false, edit: false };
}

export function crudOn(): ModuleCrudPermission {
  return { view: true, create: true, edit: true };
}

function parseCrud(v: unknown): ModuleCrudPermission {
  if (v === true) return crudOn();
  if (v === false) return crudOff();
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const m = v as Record<string, unknown>;
    return { view: Boolean(m.view), create: Boolean(m.create), edit: Boolean(m.edit) };
  }
  return crudOff();
}

/**
 * Accepts legacy flat booleans per module or new `{ view, create, edit }` objects.
 *
 * Migration: if only the legacy `costs` key is present (no sub-keys), copy its value to all
 * three sub-keys so existing user records keep working automatically.
 */
export function normalizeUserPermissions(raw: unknown): UserPermissions {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const result = { ...FULL_ACCESS };

  for (const k of BOOL_KEYS) {
    result[k] = typeof o[k] === 'boolean' ? o[k] : false;
  }

  for (const k of CRUD_KEYS) {
    result[k] = parseCrud(o[k]);
  }

  // Default: purchase requests available to all signed-in users when key absent from stored JSON.
  if (!('purchase_requests' in o)) {
    result.purchase_requests = { view: true, create: true, edit: false };
  }

  // Migration: if sub-keys are all off but the legacy `costs` key is set, propagate it.
  const hasAnyCostsSub = COSTS_SUB_KEYS.some((k) => {
    const v = o[k];
    return v === true || (v && typeof v === 'object' && !Array.isArray(v) && (v as Record<string, unknown>).view);
  });
  if (!hasAnyCostsSub && o['costs']) {
    const legacy = parseCrud(o['costs']);
    for (const k of COSTS_SUB_KEYS) {
      result[k] = { ...legacy };
    }
  }

  // Derive the virtual `costs` umbrella as the union of the sub-keys (for server compat).
  result['costs'] = {
    view: COSTS_SUB_KEYS.some((k) => result[k].view),
    create: COSTS_SUB_KEYS.some((k) => result[k].create),
    edit: COSTS_SUB_KEYS.some((k) => result[k].edit),
  };

  return result;
}

export function moduleAccess(permissions: UserPermissions, key: PermissionKey): ModuleCrudPermission {
  const v = permissions[key];
  if (typeof v === 'boolean') {
    return { view: v, create: v, edit: v };
  }
  return {
    view: v.view === true,
    create: v.create === true,
    edit: v.edit === true,
  };
}

export function hasModuleView(permissions: UserPermissions, key: PermissionKey): boolean {
  return moduleAccess(permissions, key).view;
}

/** Shell utilities — no module.view required (Sidebar footer). */
export const SHELL_UTILITY_MODULE_IDS = new Set(['general', 'display', 'calculator', 'manual']);

const PERMISSION_MODULE_IDS = new Set<PermissionKey>([
  ...BOOL_KEYS,
  ...CRUD_KEYS,
]);

/** Whether the user may open a module window (view gate only — not reference reads). */
export function canOpenModule(
  permissions: UserPermissions,
  moduleId: string,
  _opts?: { isAdmin?: boolean },
): boolean {
  if (SHELL_UTILITY_MODULE_IDS.has(moduleId)) return true;
  if (!PERMISSION_MODULE_IDS.has(moduleId as PermissionKey)) return false;
  return hasModuleView(permissions, moduleId as PermissionKey);
}

/** Shell nav / window open — ledger includes accounting periods (overhead) access. */
export function canOpenShellModule(
  permissions: UserPermissions,
  moduleId: string,
  opts?: { isAdmin?: boolean },
): boolean {
  // Purchase requests module is available to every authenticated user.
  if (moduleId === 'purchase_requests') return true;
  if (moduleId === 'ledger') {
    return canOpenModule(permissions, 'ledger', opts) || canOpenModule(permissions, 'overhead', opts);
  }
  if (moduleId === 'technical') {
    return (
      canOpenModule(permissions, 'projects', opts)
      || canOpenModule(permissions, 'boq', opts)
      || canOpenModule(permissions, 'billing', opts)
    );
  }
  if (moduleId === 'overhead') {
    return canOpenModule(permissions, 'overhead', opts);
  }
  if (moduleId === 'costs') {
    return COSTS_SUB_KEYS.some((k) => canOpenModule(permissions, k, opts));
  }
  if (moduleId === 'projects' || moduleId === 'boq' || moduleId === 'billing') {
    return canOpenModule(permissions, moduleId, opts);
  }
  return canOpenModule(permissions, moduleId, opts);
}

export function canOpenTechnicalView(
  permissions: UserPermissions,
  viewId: string,
  opts?: { isAdmin?: boolean },
): boolean {
  return canOpenModuleView(permissions, 'technical', viewId, opts);
}

export function canOpenLedgerView(
  permissions: UserPermissions,
  viewId: string,
  opts?: { isAdmin?: boolean },
): boolean {
  return canOpenModuleView(permissions, 'ledger', viewId, opts);
}

export { canOpenModuleView, firstPermittedModuleView, permissionKeyForModuleView };

/** Default ERP/shell view when user lacks access to the module default. */
export function defaultShellViewForModule(
  permissions: UserPermissions,
  moduleId: string,
  opts?: { isAdmin?: boolean },
): string | undefined {
  return firstPermittedModuleView(permissions, moduleId, opts);
}

/** System administration (users, backup, wipe) — stored `settings` flag, not a role name. */
export function hasSettingsAccess(permissions: UserPermissions): boolean {
  return permissions.settings === true;
}

/** True when any module is enabled (view/create/edit or boolean module on). */
export function hasAnyGrantedPermission(permissions: UserPermissions): boolean {
  if (permissions.dashboard || permissions.reports || permissions.settings) return true;
  return CRUD_KEYS.some((key) => {
    const a = moduleAccess(permissions, key);
    return a.view || a.create || a.edit;
  });
}

/** Stored permissions missing — do not fill from role presets. */
export function permissionsNeedBootstrap(raw: unknown, _role?: UserRole): boolean {
  if (raw === undefined || raw === null) return true;
  if (typeof raw !== 'object' || Array.isArray(raw)) return true;
  return Object.keys(raw as Record<string, unknown>).length === 0;
}

/** Resolve stored JSON only — role names never grant modules. */
export function resolvePermissionsFromUserData(data: {
  role?: unknown;
  permissions?: unknown;
}): UserPermissions {
  if (permissionsNeedBootstrap(data.permissions)) {
    return { ...DEFAULT_PERMISSIONS };
  }
  return normalizeUserPermissions(data.permissions);
}

/** First startup module the user may open (avoids opening ledger when only costs is granted). */
export function firstPermittedStartupModule(
  permissions: UserPermissions,
  role: UserRole,
  preferred?: string | null,
  visibleShellModules?: readonly string[] | null,
): string {
  if (isNoDefaultModule(preferred)) return NONE_DEFAULT_MODULE;

  const navOk = (moduleId: string) => isShellModuleNavVisible(moduleId, visibleShellModules);

  if (preferred && preferred !== 'settings') {
    const shellId = LEGACY_SHELL_MODULE_MAP[preferred]?.moduleId ?? preferred;
    if (navOk(shellId)) {
      if (shellId === 'technical' || shellId === 'ledger') {
        if (canOpenShellModule(permissions, shellId)) return shellId;
      } else if (hasModuleView(permissions, shellId as PermissionKey)) {
        return shellId;
      }
    }
  }

  for (const mod of STARTUP_MODULES) {
    if (mod.id === 'settings') continue;
    if (!navOk(mod.id)) continue;
    if (mod.id === 'technical' || mod.id === 'ledger') {
      if (canOpenShellModule(permissions, mod.id)) return mod.id;
    } else if (hasModuleView(permissions, mod.id as PermissionKey)) {
      return mod.id;
    }
  }
  return NONE_DEFAULT_MODULE;
}

export function buildPermissionsForRole(role: UserRole): UserPermissions {
  if (role === 'admin') return { ...FULL_ACCESS };
  if (role === 'projects_manager') {
    const costsView = { view: true, create: false, edit: false };
    return {
      dashboard: true,
      ledger: crudOff(),
      projects: crudOn(),
      boq: crudOn(),
      billing: crudOn(),
      costs: costsView,
      costs_invoice: costsView,
      costs_ipc: costsView,
      costs_custody: costsView,
      suppliers: { view: true, create: false, edit: false },
      banks: crudOff(),
      inventory: { view: true, create: false, edit: true },
      subcontractor: { view: true, create: false, edit: false },
      overhead: crudOn(),
      assets: { view: true, create: false, edit: false },
      payroll: { view: true, create: false, edit: false },
      purchase_requests: { view: true, create: true, edit: true },
      reports: true,
      settings: false,
    };
  }
  if (role === 'project_accountant') {
    return {
      dashboard: true,
      ledger: crudOff(),
      projects: { view: true, create: false, edit: false },
      boq: { view: true, create: false, edit: false },
      billing: { view: true, create: true, edit: true },
      costs: crudOn(),
      costs_invoice: crudOn(),
      costs_ipc: crudOn(),
      costs_custody: crudOn(),
      suppliers: { view: true, create: true, edit: true },
      banks: { view: true, create: false, edit: false },
      inventory: crudOn(),
      subcontractor: crudOn(),
      overhead: { view: true, create: false, edit: false },
      // Needed so Fixed Asset invoice in Actual Costs can create pending_setup register rows
      assets: crudOn(),
      payroll: crudOff(),
      purchase_requests: { view: true, create: true, edit: true },
      reports: true,
      settings: false,
    };
  }
  return {
    dashboard: false,
    ledger: crudOff(),
    projects: crudOff(),
    boq: crudOff(),
    billing: crudOff(),
    costs: crudOff(),
    costs_invoice: crudOff(),
    costs_ipc: crudOff(),
    costs_custody: crudOff(),
    suppliers: crudOff(),
    banks: crudOff(),
    inventory: crudOff(),
    subcontractor: crudOff(),
    overhead: crudOff(),
    assets: crudOff(),
    payroll: crudOff(),
    purchase_requests: { view: true, create: true, edit: false },
    reports: false,
    settings: false,
  };
}
