/**
 * One-shot: seed FA groups if empty + sync orphan 11… GL debits into fixed_assets register.
 * Usage: npx tsx server/src/scripts/syncFixedAssetsFromGl.ts
 */
import {
  bootstrapFixedAssetGroupsIfEmpty,
  syncFixedAssetsFromGl,
} from '../accounting/fixedAssetGlSync.js';
import { closeDb } from '../db.js';

async function main() {
  await bootstrapFixedAssetGroupsIfEmpty();
  const result = await syncFixedAssetsFromGl();
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
