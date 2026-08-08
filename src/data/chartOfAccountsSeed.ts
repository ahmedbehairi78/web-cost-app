import { collection, getDocs, serverTimestamp, writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebase';

export { CHART_OF_ACCOUNTS_SEED, type SeedAccount } from './chartOfAccountsSeedData';

import { CHART_OF_ACCOUNTS_SEED } from './chartOfAccountsSeedData';

/**
 * Seeds the chart of accounts into Firestore if the collection is empty.
 * Uses batched writes (500 docs per batch) for reliability.
 * Safe to call on every app start — skips if data already exists.
 */
export async function seedChartOfAccounts(): Promise<{ seeded: boolean; count: number }> {
  const colRef = collection(db, 'chart_of_accounts');
  const existing = await getDocs(colRef);
  if (!existing.empty) return { seeded: false, count: 0 };

  const BATCH_SIZE = 400;
  let written = 0;

  for (let i = 0; i < CHART_OF_ACCOUNTS_SEED.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = CHART_OF_ACCOUNTS_SEED.slice(i, i + BATCH_SIZE);
    chunk.forEach(account => {
      const docRef = doc(colRef);
      batch.set(docRef, { ...account, createdAt: serverTimestamp() });
    });
    await batch.commit();
    written += chunk.length;
  }

  return { seeded: true, count: written };
}
