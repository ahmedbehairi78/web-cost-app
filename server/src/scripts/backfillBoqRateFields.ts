/**
 * Restore BOQ rate breakdown (materials / labour / equipment / OH% / profit%) on Postgres
 * from Firestore backup JSON or live Firestore.
 *
 * Usage:
 *   npx prisma migrate deploy
 *   npm run local:backfill-boq-rates -- path/to/backup.json
 *   npm run local:backfill-boq-rates -- --live
 *
 * Requires FIREBASE_SERVICE_ACCOUNT_* when using --live.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../db.js';
import { runBoqRateBackfill } from '../migration/backfillBoqRates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const backupArg = args.find((a) => a !== '--live');
  const backupPath = backupArg ? path.resolve(backupArg) : undefined;

  const report = await runBoqRateBackfill({ live, backupPath });
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
