/**
 * Set password for a Postgres user (local / Railway).
 *
 *   npm run local:set-user-password -- myline78@gmail.com 'MySecurePass123'          # local DATABASE_URL
 *   npm run prod:set-user-password  -- myline78@gmail.com 'MySecurePass123'          # Railway (PRODUCTION_DATABASE_URL)
 *
 * Local run uses DATABASE_URL; --production uses PRODUCTION_DATABASE_URL / DATABASE_PUBLIC_URL from .env.
 */
import 'dotenv/config';

const args = process.argv.slice(2).filter((a) => a !== '--');
const useProduction = args.includes('--production');
const positional = args.filter((a) => !a.startsWith('--'));

const email = (positional[0] ?? '').trim().toLowerCase();
const password = positional[1] ?? '';

if (!email || password.length < 8) {
  console.error('Usage: npm run local:set-user-password -- <email> <password> [--production]');
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

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
  console.error('DATABASE_URL is not a valid postgres:// URL. Current value looks like a placeholder or is malformed:');
  console.error(`  ${targetUrl.slice(0, 60)}${targetUrl.length > 60 ? '…' : ''}`);
  console.error('Fix it in .env, or clear a stale shell override with: Remove-Item Env:\\DATABASE_URL');
  process.exit(1);
}

const targetHost = targetUrl ? new URL(targetUrl).host : 'localhost:5432 (default)';
console.log(`Target database: ${useProduction ? 'PRODUCTION (Railway)' : 'local'} — ${targetHost}`);

// Import after DATABASE_URL is finalized — db.js builds the Prisma client at import time.
const { prisma } = await import('../db.js');
const { hashLoginPassword } = await import('../auth/passwordHelpers.js');

const existing = await prisma.user.findFirst({
  where: { email: { equals: email, mode: 'insensitive' } },
});

if (!existing) {
  console.error(`No user found for email: ${email}`);
  console.error('Create the user in Settings first, or use local:set-user-role to create a role row.');
  process.exit(1);
}

await prisma.user.update({
  where: { id: existing.id },
  data: {
    passwordHash: await hashLoginPassword(password),
    isActive: true,
  },
});

console.log(`Password updated for "${existing.email}" (id: ${existing.id})`);
console.log('User can sign in via the Password tab on the login screen.');

await prisma.$disconnect();
