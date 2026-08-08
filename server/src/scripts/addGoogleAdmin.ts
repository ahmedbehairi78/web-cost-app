/**
 * Adds (or updates) a local SQLite admin user that matches a Google/Firebase email.
 * Run from the project root with Node v24 (the same version that serves the API):
 *
 *   npx tsx server/src/scripts/addGoogleAdmin.ts myline78@gmail.com
 *
 * If the user already exists their role and permissions are upgraded to admin.
 */
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { initSqliteCore } from '../sqlite/core.js';
import { getSqliteCoreDb } from '../sqlite/core.js';
import { ALL_PERMISSIONS } from '../permissions.js';

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!email) {
  console.error('Usage: npx tsx server/src/scripts/addGoogleAdmin.ts <email>');
  process.exit(1);
}

initSqliteCore();
const db = getSqliteCoreDb();

const now = new Date().toISOString();
const existing = db
  .prepare('SELECT id, email, role FROM users WHERE lower(trim(email)) = ?')
  .get(email) as { id: string; email: string; role: string } | undefined;

if (existing) {
  db.prepare(
    `UPDATE users SET role = 'admin', permissions = ?, is_active = 1, updated_at = ? WHERE id = ?`
  ).run(JSON.stringify(ALL_PERMISSIONS), now, existing.id);
  console.log(`✓ Updated existing user "${existing.email}" (id: ${existing.id}) → role=admin, isActive=true`);
} else {
  // Firebase users don't need a password for local login; set a random unusable hash.
  const unusableHash = await bcrypt.hash(randomUUID(), 4);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, role, permissions, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'admin', ?, 1, ?, ?)`
  ).run(id, email, 'Google Admin', unusableHash, JSON.stringify(ALL_PERMISSIONS), now, now);
  console.log(`✓ Created new admin user "${email}" (id: ${id})`);
}

console.log('Done. Restart the local API server (npm run local:api) for changes to take effect.');
