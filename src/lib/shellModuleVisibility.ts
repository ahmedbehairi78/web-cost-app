/**
 * UI-only shell module visibility (admin-configured per user).
 * Does not affect permissions, openWindow, notifications, or API access.
 */

/** Modules that can be toggled in the nav / purchase-requests footer entry. */
export const VISIBLE_SHELL_MODULE_IDS = [
  'dashboard',
  'ledger',
  'technical',
  'costs',
  'inventory',
  'assets',
  'payroll',
  'banks',
  'reports',
  'settings',
  'purchase_requests',
] as const;

export type VisibleShellModuleId = (typeof VISIBLE_SHELL_MODULE_IDS)[number];

const VISIBLE_SHELL_MODULE_ID_SET = new Set<string>(VISIBLE_SHELL_MODULE_IDS);

/** Shell utilities always stay in the footer / ERP utilities — never filtered. */
export const ALWAYS_VISIBLE_SHELL_MODULE_IDS = [
  'general',
  'display',
  'calculator',
  'manual',
] as const;

const ALWAYS_VISIBLE_SET = new Set<string>(ALWAYS_VISIBLE_SHELL_MODULE_IDS);

export function isVisibleShellModuleId(value: unknown): value is VisibleShellModuleId {
  return typeof value === 'string' && VISIBLE_SHELL_MODULE_ID_SET.has(value);
}

/**
 * Normalize API / Firestore payload.
 * - null / undefined / missing → null (show all permitted)
 * - invalid entries dropped
 * - empty after filter → empty whitelist (hide all toggleable modules)
 */
export function normalizeVisibleShellModules(
  raw: unknown,
): VisibleShellModuleId[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const out: VisibleShellModuleId[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isVisibleShellModuleId(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * Whether a module id should appear in Sidebar / TopNav / purchase-requests menu.
 * Utilities always return true. null whitelist → all toggleable modules visible.
 */
export function isShellModuleNavVisible(
  moduleId: string,
  visibleShellModules: readonly string[] | null | undefined,
): boolean {
  if (ALWAYS_VISIBLE_SET.has(moduleId)) return true;
  if (visibleShellModules == null) return true;
  return visibleShellModules.includes(moduleId);
}

/** True when every toggleable module is selected (persist as null). */
export function isFullVisibleShellModulesWhitelist(
  selected: readonly string[] | null | undefined,
): boolean {
  if (selected == null) return true;
  if (selected.length !== VISIBLE_SHELL_MODULE_IDS.length) return false;
  return VISIBLE_SHELL_MODULE_IDS.every((id) => selected.includes(id));
}
