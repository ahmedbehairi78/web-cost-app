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
  type StoredReportPrintProfiles,
} from './reportPrintProfiles';

async function loadStoredProfiles(): Promise<StoredReportPrintProfiles> {
  if (isLocalBackend) {
    const res = await settingsApi.getCompanyInfo();
    return res.value?.reportPrintProfiles ?? {};
  }
  const snap = await getDoc(doc(db, 'settings', 'company_info'));
  if (!snap.exists()) return {};
  const data = snap.data() as { reportPrintProfiles?: StoredReportPrintProfiles };
  return data.reportPrintProfiles ?? {};
}

export async function persistReportPrintProfiles(
  profiles: StoredReportPrintProfiles,
): Promise<StoredReportPrintProfiles> {
  const existing = await loadStoredProfiles();
  const merged = mergeStoredReportPrintProfiles(existing, profiles);
  if (isLocalBackend) {
    await settingsApi.patchReportPrintProfiles(merged);
    return merged;
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
