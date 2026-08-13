/**
 * Full Postgres snapshot (same payload as GET /api/settings/backup-export).
 *
 *   npm run local:export-backup
 *   npm run prod:export-backup
 *
 * Writes JSON under ../backups/<stamp>/  (next to web-cost-app).
 * Includes users.role, users.permissions, users.passwordHash (bcrypt — not plaintext).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((a) => a !== '--');
const useProduction = args.includes('--production');

if (useProduction) {
  const prodUrl = (process.env.PRODUCTION_DATABASE_URL || process.env.DATABASE_PUBLIC_URL || '').trim();
  if (!prodUrl) {
    console.error('--production requires PRODUCTION_DATABASE_URL (or DATABASE_PUBLIC_URL) in .env.');
    process.exit(1);
  }
  process.env.DATABASE_URL = prodUrl;
}

const targetUrl = (process.env.DATABASE_URL || '').trim();
if (targetUrl && !/^postgres(ql)?:\/\//i.test(targetUrl)) {
  console.error('DATABASE_URL is not a valid postgres:// URL.');
  process.exit(1);
}

const targetHost = targetUrl ? new URL(targetUrl).host : 'localhost:5432 (default)';
const sourceLabel = useProduction ? 'production' : 'local';
console.log(`Target database: ${useProduction ? 'PRODUCTION (Railway)' : 'local'} — ${targetHost}`);

const { prisma } = await import('../db.js');
const { buildPostgresBackup } = await import('../migration/buildPostgresBackup.js');
const { POSTGRES_BACKUP_COLLECTIONS } = await import('../migration/backupCollections.js');

const payload = await buildPostgresBackup();
const collections = payload.collections ?? {};

const missingKeys = POSTGRES_BACKUP_COLLECTIONS.filter((name) => !(name in collections));
if (missingKeys.length > 0) {
  console.error(`Backup missing collections: ${missingKeys.join(', ')}`);
  await prisma.$disconnect();
  process.exit(1);
}

const users = (collections.users ?? []) as Array<{
  email?: string;
  role?: string;
  permissions?: unknown;
  passwordHash?: string;
  password_hash?: string;
}>;
const usersWithHash = users.filter((u) => Boolean(String(u.passwordHash || u.password_hash || '').trim()));
const usersWithPermissions = users.filter((u) => u.permissions != null && u.permissions !== '');

const counts: Record<string, number> = {};
let totalRecords = 0;
for (const name of POSTGRES_BACKUP_COLLECTIONS) {
  const n = Array.isArray(collections[name]) ? collections[name].length : 0;
  counts[name] = n;
  totalRecords += n;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const backupsRoot = path.join(repoRoot, '..', 'backups');
const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
const outDir = path.join(backupsRoot, `${stamp}-${sourceLabel}`);
fs.mkdirSync(outDir, { recursive: true });

const backupFile = path.join(outDir, `postgres-full-${sourceLabel}.json`);
const summaryFile = path.join(outDir, `postgres-full-${sourceLabel}.summary.json`);

fs.writeFileSync(backupFile, JSON.stringify(payload, null, 2), 'utf8');
fs.writeFileSync(
  summaryFile,
  JSON.stringify(
    {
      exportedAt: payload.exportedAt,
      source: sourceLabel,
      host: targetHost,
      version: payload.version,
      collections: POSTGRES_BACKUP_COLLECTIONS.length,
      totalRecords,
      users: {
        count: users.length,
        withPasswordHash: usersWithHash.length,
        withPermissions: usersWithPermissions.length,
        emails: users.map((u) => ({ email: u.email ?? '', role: u.role ?? '' })),
      },
      excluded: ['sessions', 'idempotency_keys'],
      notes: [
        'passwordHash is bcrypt (not plaintext). Replace-restore restores the same login passwords.',
        'User preferences (theme/language/visible modules) live in settings as user_prefs:* keys.',
      ],
      counts,
    },
    null,
    2,
  ),
  'utf8',
);

const sizeMb = (fs.statSync(backupFile).size / (1024 * 1024)).toFixed(2);
console.log(`Wrote ${backupFile}`);
console.log(`Wrote ${summaryFile}`);
console.log(
  `Collections ${POSTGRES_BACKUP_COLLECTIONS.length} · records ${totalRecords} · users ${users.length} (passwordHash ${usersWithHash.length}/${users.length}) · ${sizeMb} MB`,
);

if (users.length > 0 && usersWithHash.length !== users.length) {
  console.warn(`WARNING: ${users.length - usersWithHash.length} user(s) have no passwordHash`);
}

await prisma.$disconnect();
