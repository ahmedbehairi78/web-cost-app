/**
 * Shared persistence for per-report print design profiles.
 * Local backend: Postgres `company_info.reportPrintProfiles` (reports permission).
 * Cloud legacy: Firestore `settings/company_info`.
 */
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { isLocalBackend } from './dataBackend';
import { settingsApi } from '../services/local/modulesApi';
import type { StoredReportPrintProfiles } from './reportPrintProfiles';

export async function persistReportPrintProfiles(
  profiles: StoredReportPrintProfiles,
): Promise<void> {
  if (isLocalBackend) {
    await settingsApi.patchReportPrintProfiles(profiles);
    return;
  }
  const ref = doc(db, 'settings', 'company_info');
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, { reportPrintProfiles: profiles });
  } else {
    await setDoc(ref, { reportPrintProfiles: profiles }, { merge: true });
  }
}
