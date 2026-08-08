/** Keep in sync with src/lib/shellTheme.ts APP_THEME_IDS */
export const APP_THEME_IDS = ['dark', 'light', 'soft', 'erp'] as const;
export type AppTheme = (typeof APP_THEME_IDS)[number];

export const LEGACY_ERP_THEME_ID = 'odoo';

export function normalizeStoredTheme(value: string): string {
  return value === LEGACY_ERP_THEME_ID ? 'erp' : value;
}

export function isAppTheme(value: string): value is AppTheme {
  return (APP_THEME_IDS as readonly string[]).includes(value)
    || value === LEGACY_ERP_THEME_ID;
}
