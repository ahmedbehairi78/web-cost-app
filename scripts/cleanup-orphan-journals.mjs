import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../server/data/financial-core.sqlite');
const db = new Database(dbPath);
const now = new Date().toISOString();

const orphans = db.prepare(`
  SELECT t.id
  FROM transactions t
  LEFT JOIN purchase_transactions pt ON pt.transaction_id = t.id
  WHERE t.is_deleted = 0 AND pt.id IS NULL
`).all();

const markDeleted = db.prepare('UPDATE transactions SET is_deleted = 1, updated_at = ? WHERE id = ?');
if (orphans.length > 0) {
  const tx = db.transaction(() => {
    for (const { id } of orphans) markDeleted.run(now, id);
  });
  tx();
  console.log(`Soft-deleted ${orphans.length} orphan journal(s):`, orphans.map((o) => o.id));
} else {
  console.log('No orphan journals to clean.');
}

const updateRef = db.prepare('UPDATE transactions SET reference = ?, updated_at = ? WHERE id = ?');
const pairs = db.prepare(`
  SELECT t.id, pt.reference_number
  FROM transactions t
  INNER JOIN purchase_transactions pt ON pt.transaction_id = t.id
  WHERE t.is_deleted = 0 AND pt.reference_number IS NOT NULL AND pt.reference_number != ''
`).all();

for (const { id, reference_number } of pairs) {
  updateRef.run(`INV-${String(reference_number).trim()}`, now, id);
}
if (pairs.length) console.log(`Updated ${pairs.length} journal reference(s) to INV-{invoiceNo}.`);
