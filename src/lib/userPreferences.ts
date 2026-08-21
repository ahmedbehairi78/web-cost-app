import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { DEFAULT_MODULE, NONE_DEFAULT_MODULE } from '../constants/modules';
import { isLocalBackend } from './dataBackend';
import { settingsApi, type UserPreferences } from '../services/local/modulesApi';
import { ensureApiAuthToken } from './authToken';
import { parseDefaultModuleSelectValue } from './shellNavigation';
import { moduleAccess } from './permissions';

export type AppLanguagePreference = 'ar' | 'en';

const DEFAULT_MODULE_STORAGE_KEY = 'app_default_module';

export function isAppLanguagePreference(value: unknown): value is AppLanguagePreference {
  return value === 'ar' || value === 'en';
}

export function readLocalDefaultModule(): string | null {
  try {
    const value = localStorage.getItem(DEFAULT_MODULE_STORAGE_KEY);
    if (!value?.trim()) return null;
    return value.trim();
  } catch {
    return null;
  }
}

export function writeLocalDefaultModule(moduleId: string): void {
  try {
    localStorage.setItem(DEFAULT_MODULE_STORAGE_KEY, moduleId);
  } catch {
    /* private browsing / storage disabled */
  }
}

/** Server/Firestore value wins; fall back to localStorage (mirrors theme persistence). */
export function resolveStoredDefaultModule(
  serverValue: string | null | undefined,
): string | null {
  if (serverValue != null && String(serverValue).trim() !== '') {
    return String(serverValue).trim();
  }
  return readLocalDefaultModule();
}

/**
 * Local API: Express session cookie (password or Google login).
 * Cloud legacy: Firebase user required for Firestore users/{uid} writes.
 */
export function canPersistUserPreferences(): boolean {
  return isLocalBackend || !!auth.currentUser;
}

/** Company-wide print design (`reportPrintProfiles`) — settings, reports, or cash-budget write. */
export function canSaveCompanyPrintDesign(permissions?: {
  settings?: boolean;
  reports?: boolean;
  cash_budget?: { view?: boolean; create?: boolean; edit?: boolean };
} | null): boolean {
  if (!canPersistUserPreferences() || !permissions) return false;
  if (permissions.settings === true || permissions.reports === true) return true;
  const cash = moduleAccess(permissions as import('../types').UserPermissions, 'cash_budget');
  return cash.create || cash.edit;
}

async function mirrorFirestoreUserPrefs(patch: Partial<UserPreferences>): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await updateDoc(doc(db, 'users', user.uid), patch);
  } catch (err) {
    console.warn('[prefs] Firestore mirror failed:', err);
  }
}

function persistDefaultModuleLocally(moduleId: string | null | undefined): void {
  if (moduleId == null || String(moduleId).trim() === '') return;
  writeLocalDefaultModule(String(moduleId).trim());
}

/** Persist theme / default module / language to Postgres (local) or Firestore users doc (cloud). */
export async function saveUserPreferences(patch: Partial<UserPreferences>): Promise<void> {
  if (isLocalBackend) {
    await ensureApiAuthToken();
    const saved = await settingsApi.patchUserPreferences(patch);
    if (patch.defaultModule !== undefined) {
      persistDefaultModuleLocally(
        saved.defaultModule ?? patch.defaultModule ?? NONE_DEFAULT_MODULE,
      );
    }
    await mirrorFirestoreUserPrefs(patch);
    return;
  }
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Authentication required');
  }
  await updateDoc(doc(db, 'users', user.uid), patch);
  if (patch.defaultModule !== undefined) {
    persistDefaultModuleLocally(patch.defaultModule ?? NONE_DEFAULT_MODULE);
  }
}

/** Load saved default startup module for General Settings + login bootstrap. */
export async function loadDefaultModulePreference(): Promise<string> {
  if (isLocalBackend) {
    try {
      await ensureApiAuthToken();
      const prefs = await settingsApi.getUserPreferences();
      const raw = resolveStoredDefaultModule(prefs.defaultModule);
      if (raw != null) {
        persistDefaultModuleLocally(raw);
        return parseDefaultModuleSelectValue(raw);
      }
    } catch (err) {
      console.warn('[prefs] Failed to load default module from API:', err);
    }
  } else if (auth.currentUser) {
    try {
      const snap = await getDoc(doc(db, 'users', auth.currentUser.uid));
      if (snap.exists()) {
        const raw = resolveStoredDefaultModule(snap.data().defaultModule as string | undefined);
        if (raw != null) {
          persistDefaultModuleLocally(raw);
          return parseDefaultModuleSelectValue(raw);
        }
      }
    } catch (err) {
      console.warn('[prefs] Failed to load default module from Firestore:', err);
    }
  }

  const local = readLocalDefaultModule();
  if (local) return parseDefaultModuleSelectValue(local);
  return DEFAULT_MODULE;
}

/** Update UI language and persist for next session (best-effort when signed in). */
export function persistLanguagePreference(
  setLanguage: (lang: AppLanguagePreference) => void,
  lang: AppLanguagePreference,
): void {
  setLanguage(lang);
  void saveUserPreferences({ defaultLanguage: lang }).catch((err) => {
    console.warn('Failed to persist language preference:', err);
  });
}

export type UserPrefsUpdatedDetail = {
  defaultModule?: string;
  /** When true, App reloads visibleShellModules from GET /user-preferences (self). */
  reloadVisibleShellModules?: boolean;
  visibleShellModules?: string[] | null;
};

export const USER_PREFS_UPDATED_EVENT = 'web-cost-user-prefs-updated';

export function emitUserPrefsUpdated(detail: UserPrefsUpdatedDetail): void {
  window.dispatchEvent(new CustomEvent(USER_PREFS_UPDATED_EVENT, { detail }));
}
