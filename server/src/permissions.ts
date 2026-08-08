/**
 * Server-side permission model — aligned with `src/types.ts` + `src/lib/permissions.ts`.
 * Postgres `users.permissions` stores the normalized CRUD-shaped JSON (single source of truth).
 */

export type ModuleCrudPermission = {
  view: boolean;
  create: boolean;
  edit: boolean;
};

export type UserRole = 'admin' | 'projects_manager' | 'project_accountant' | 'user';

export type CrudModuleKey =
  | 'ledger'
  | 'projects'
  | 'boq'
  | 'billing'
  | 'costs'
  | 'costs_invoice'
  | 'costs_ipc'
  | 'costs_custody'
  | 'suppliers'
  | 'banks'
  | 'inventory'
  | 'subcontractor'
  | 'overhead'
  | 'assets'
  | 'payroll'
  | 'purchase_requests';

/** App module keys; `transfers` is a legacy alias for inventory (transfer routes). */
export type PermissionKey = CrudModuleKey | 'dashboard' | 'reports' | 'settings' | 'transfers';

export type UserPermissions = {
  dashboard: boolean;
  ledger: ModuleCrudPermission;
  projects: ModuleCrudPermission;
  boq: ModuleCrudPermission;
  billing: ModuleCrudPermission;
  /** Virtual/derived — union of costs_invoice|costs_ipc|costs_custody. Kept for backward-compat route guards. */
  costs: ModuleCrudPermission;
  costs_invoice: ModuleCrudPermission;
  costs_ipc: ModuleCrudPermission;
  costs_custody: ModuleCrudPermission;
  suppliers: ModuleCrudPermission;
  banks: ModuleCrudPermission;
  inventory: ModuleCrudPermission;
  subcontractor: ModuleCrudPermission;
  overhead: ModuleCrudPermission;
  assets: ModuleCrudPermission;
  payroll: ModuleCrudPermission;
  purchase_requests: ModuleCrudPermission;
  reports: boolean;
  settings: boolean;
};

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
] as const satisfies readonly CrudModuleKey[];

const COSTS_SUB_KEYS = ['costs_invoice', 'costs_ipc', 'costs_custody'] as const satisfies readonly CrudModuleKey[];

const BOOL_KEYS = ['dashboard', 'reports', 'settings'] as const;

export function crudOff(): ModuleCrudPermission {
  return { view: false, create: false, edit: false };
}

export function crudOn(): ModuleCrudPermission {
  return { view: true, create: true, edit: true };
}

export const ALL_PERMISSIONS: UserPermissions = {
  dashboard: true,
  ledger: crudOn(),
  projects: crudOn(),
  boq: crudOn(),
  billing: crudOn(),
  costs: crudOn(),
  costs_invoice: crudOn(),
  costs_ipc: crudOn(),
  costs_custody: crudOn(),
  suppliers: crudOn(),
  banks: crudOn(),
  inventory: crudOn(),
  subcontractor: crudOn(),
  overhead: crudOn(),
  assets: crudOn(),
  payroll: crudOn(),
  purchase_requests: crudOn(),
  reports: true,
  settings: true,
};

export const DEFAULT_PERMISSIONS: UserPermissions = {
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

function resolveModuleKey(key: PermissionKey): keyof UserPermissions {
  if (key === 'transfers') return 'inventory';
  return key;
}

export function moduleAccess(permissions: unknown, key: PermissionKey): ModuleCrudPermission {
  const normalized = normalizeUserPermissions(permissions);
  const moduleKey = resolveModuleKey(key);
  const v = normalized[moduleKey];
  if (typeof v === 'boolean') {
    return { view: v, create: v, edit: v };
  }
  return {
    view: v.view === true,
    create: v.create === true,
    edit: v.edit === true,
  };
}

/** Module window / sidebar — `view` only. */
export function hasModuleView(permissions: unknown, key: PermissionKey): boolean {
  if (key === 'dashboard' || key === 'reports' || key === 'settings') {
    const normalized = normalizeUserPermissions(permissions);
    return normalized[key] === true;
  }
  return moduleAccess(permissions, key).view;
}

/**
 * Reference read — any of view|create|edit (e.g. COA picker in Actual Costs without ledger.view).
 * This is the default gate for GET /api/* reference endpoints.
 */
export function hasReferenceRead(permissions: unknown, key: PermissionKey): boolean {
  if (key === 'dashboard' || key === 'reports' || key === 'settings') {
    const normalized = normalizeUserPermissions(permissions);
    return normalized[key] === true;
  }
  const access = moduleAccess(permissions, key);
  return access.view || access.create || access.edit;
}

/** Write — create or edit on a CRUD module; boolean modules require the flag itself. */
export function hasModuleWrite(permissions: unknown, key: PermissionKey): boolean {
  if (key === 'dashboard' || key === 'reports' || key === 'settings') {
    const normalized = normalizeUserPermissions(permissions);
    return normalized[key] === true;
  }
  const access = moduleAccess(permissions, key);
  return access.create || access.edit;
}

/** @deprecated alias — use `hasReferenceRead`. */
export function hasPermission(permissions: unknown, key: PermissionKey): boolean {
  return hasReferenceRead(permissions, key);
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

export function normalizeUserPermissions(raw: unknown): UserPermissions {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const result: UserPermissions = { ...ALL_PERMISSIONS };

  for (const k of BOOL_KEYS) {
    result[k] = typeof o[k] === 'boolean' ? o[k] : false;
  }

  for (const k of CRUD_KEYS) {
    result[k] = parseCrud(o[k]);
  }

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

  // Derive the virtual `costs` umbrella as the union of sub-keys (for backward-compat route guards).
  result['costs'] = {
    view: COSTS_SUB_KEYS.some((k) => result[k].view),
    create: COSTS_SUB_KEYS.some((k) => result[k].create),
    edit: COSTS_SUB_KEYS.some((k) => result[k].edit),
  };

  return result;
}

export function permissionsNeedBootstrap(raw: unknown, role?: UserRole): boolean {
  if (raw === undefined || raw === null) return true;
  if (typeof raw !== 'object' || Array.isArray(raw)) return true;
  if (Object.keys(raw as Record<string, unknown>).length === 0) return true;
  const r = role ?? 'user';
  if (r === 'projects_manager' || r === 'project_accountant') {
    const normalized = normalizeUserPermissions(raw);
    if (!hasAnyGrantedPermission(normalized)) return true;
  }
  return false;
}

export function hasAnyGrantedPermission(permissions: UserPermissions): boolean {
  if (permissions.dashboard || permissions.reports || permissions.settings) return true;
  return CRUD_KEYS.some((key) => {
    const a = moduleAccess(permissions, key);
    return a.view || a.create || a.edit;
  });
}

export function buildPermissionsForRole(role: UserRole): UserPermissions {
  if (role === 'admin') return { ...ALL_PERMISSIONS };
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
  return { ...DEFAULT_PERMISSIONS };
}

/** Resolve stored JSON or role preset (same rules as client `resolvePermissionsFromUserData`). */
export function resolvePermissionsFromUserData(data: {
  role?: unknown;
  permissions?: unknown;
}): UserPermissions {
  const role = String(data.role ?? 'user') as UserRole;
  if (role === 'admin') return { ...ALL_PERMISSIONS };
  if (permissionsNeedBootstrap(data.permissions, role)) {
    return buildPermissionsForRole(role);
  }
  return normalizeUserPermissions(data.permissions);
}

/** @deprecated — use `buildPermissionsForRole`. */
export const PROJECT_ACCOUNTANT_PERMISSIONS = buildPermissionsForRole('project_accountant');
export const PROJECTS_MANAGER_PERMISSIONS = buildPermissionsForRole('projects_manager');
