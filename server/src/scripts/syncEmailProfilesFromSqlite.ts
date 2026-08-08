/**
 * One-time / maintenance sync: Postgres users → Firestore email_profiles.
 * Requires FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH.
 *
 *   npm run local:sync-email-profiles
 */
import { listActiveUsers } from '../auth/users.js';
import { syncAllEmailProfilesToFirestore } from '../firestore/emailProfileSync.js';

const users = await listActiveUsers();

if (users.length === 0) {
  console.log('No active users in Postgres.');
  process.exit(0);
}

const result = await syncAllEmailProfilesToFirestore(
  users.map((user) => ({
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    assignedContractIds: user.assignedContractIds ?? [],
  })),
);

console.log(`Done. configured=${result.configured} synced=${result.synced} skipped=${result.skipped}`);

if (!result.configured) {
  console.log('Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH on the API server.');
  process.exit(1);
}

if (result.skipped > 0) {
  process.exit(1);
}
