/**
 * Shared persistence for per-report print design profiles.
 * Local backend: Postgres `company_info.reportPrintProfiles` (reports or settings).
 * Cloud legacy: Firestore `settings/company_info`.
 */
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { isLocalBackend } from './dataBackend';
import { settingsApi } from '../services/local/modulesApi';
import {
  mergeStoredReportPrintProfiles,
  REPORT_PRINT_DEFAULTS,
  sanitizeProfile,
  type ReportPrintId,
  type StoredReportPrintProfiles,
} from './reportPrintProfiles';

export function profilesFromCompanyValue(value: unknown): StoredReportPrintProfiles {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const o = value as Record<string, unknown>;
  const raw = o.reportPrintProfiles ?? o.report_print_profiles;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as StoredReportPrintProfiles;
}

function sanitizeStoredMap(profiles: StoredReportPrintProfiles): StoredReportPrintProfiles {
  const out: StoredReportPrintProfiles = {};
  for (const [id, patch] of Object.entries(profiles)) {
    const key = id as ReportPrintId;
    const fallback = REPORT_PRINT_DEFAULTS[key] ?? REPORT_PRINT_DEFAULTS.income;
    out[key] = sanitizeProfile(fallback, patch);
  }
  return out;
}

async function loadStoredProfiles(): Promise<StoredReportPrintProfiles> {
  if (isLocalBackend) {
    const res = await settingsApi.getCompanyInfo();
    return profilesFromCompanyValue(res.value);
  }
  const snap = await getDoc(doc(db, 'settings', 'company_info'));
  if (!snap.exists()) return {};
  return profilesFromCompanyValue(snap.data());
}

export async function persistReportPrintProfiles(
  profiles: StoredReportPrintProfiles,
): Promise<StoredReportPrintProfiles> {
  const existing = await loadStoredProfiles();
  const merged = sanitizeStoredMap(mergeStoredReportPrintProfiles(existing, profiles));
  if (isLocalBackend) {
    const res = await settingsApi.patchReportPrintProfiles(merged);
    const fromServer = profilesFromCompanyValue({ reportPrintProfiles: res.reportPrintProfiles });
    return Object.keys(fromServer).length > 0 ? fromServer : merged;
  }
  const ref = doc(db, 'settings', 'company_info');
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, { reportPrintProfiles: merged });
  } else {
    await setDoc(ref, { reportPrintProfiles: merged }, { merge: true });
  }
  return merged;
}
