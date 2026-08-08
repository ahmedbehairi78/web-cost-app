/**
 * Set role + permissions (+ optional assigned contracts) on Postgres (Railway / local).
 *
 *   npx tsx server/src/scripts/setUserRolePg.ts momamo242@gmail.com project_accountant
 *   npx tsx server/src/scripts/setUserRolePg.ts user@x.com project_accountant --contracts id1,id2
 *
 * Requires DATABASE_URL (Railway DATABASE_PUBLIC_URL when targeting production).
 */
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import {
  ALL_PERMISSIONS,
  buildPermissionsForRole,
  type UserRole,
} from '../permissions.js';

const ROLES: UserRole[] = ['admin', 'projects_manager', 'project_accountant', 'user'];

function parseArgs(argv: string[]) {
  const email = (argv[0] ?? '').trim().toLowerCase();
  const roleRaw = (argv[1] ?? '').trim();
  let contractIds: string[] = [];
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--contracts' && argv[i + 1]) {
      contractIds = argv[i + 1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      break;
    }
  }
  return { email, role: roleRaw as UserRole, contractIds };
}

const { email, role, contractIds } = parseArgs(process.argv.slice(2));

if (!email || !ROLES.includes(role)) {
  console.error('Usage: npx tsx server/src/scripts/setUserRolePg.ts <email> <role> [--contracts id1,id2]');
  console.error(`Roles: ${ROLES.join(', ')}`);
  process.exit(1);
}

const permissions = role === 'admin' ? ALL_PERMISSIONS : buildPermissionsForRole(role);

const existing = await prisma.user.findFirst({
  where: { email: { equals: email, mode: 'insensitive' } },
});

if (existing) {
  await prisma.user.update({
    where: { id: existing.id },
    data: {
      role,
      permissions,
      assignedContractIds: contractIds.length > 0 ? contractIds : existing.assignedContractIds,
      isActive: true,
    },
  });
  console.log(`Updated "${existing.email}" → ${role} (id: ${existing.id})`);
  if (contractIds.length > 0) {
    console.log(`  assignedContractIds: ${contractIds.join(', ')}`);
  }
} else {
  const created = await prisma.user.create({
    data: {
      id: randomUUID(),
      email,
      displayName: role.replace(/_/g, ' '),
      passwordHash: await bcrypt.hash(randomUUID(), 4),
      role,
      permissions,
      assignedContractIds: contractIds,
      isActive: true,
    },
  });
  console.log(`Created ${role} "${email}" (id: ${created.id})`);
}

console.log('Log out and sign in again in the app to refresh permissions.');
await prisma.$disconnect();
