/**
 * Promote a Google-sign-in email to admin on Postgres (Railway / local).
 *
 *   npx tsx server/src/scripts/promoteGoogleAdminPg.ts myline78@gmail.com
 *
 * Requires DATABASE_URL in env (Railway public URL when targeting production).
 */
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { ALL_PERMISSIONS } from '../permissions.js';

const email = (process.argv[2] ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
if (!email) {
  console.error('Usage: npx tsx server/src/scripts/promoteGoogleAdminPg.ts <email>');
  process.exit(1);
}

const existing = await prisma.user.findFirst({
  where: { email: { equals: email, mode: 'insensitive' } },
});

if (existing) {
  await prisma.user.update({
    where: { id: existing.id },
    data: {
      role: 'admin',
      permissions: ALL_PERMISSIONS,
      isActive: true,
    },
  });
  console.log(`Updated "${existing.email}" → admin (id: ${existing.id})`);
} else {
  const created = await prisma.user.create({
    data: {
      id: randomUUID(),
      email,
      displayName: 'Admin',
      passwordHash: await bcrypt.hash(randomUUID(), 4),
      role: 'admin',
      permissions: ALL_PERMISSIONS,
      assignedContractIds: [],
      isActive: true,
    },
  });
  console.log(`Created admin "${email}" (id: ${created.id})`);
}

console.log('Log out and sign in again in the app to refresh permissions.');
await prisma.$disconnect();
