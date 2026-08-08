import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { ALL_PERMISSIONS } from '../permissions.js';

const email = process.env.ADMIN_EMAIL || 'admin@local.app';
const password = process.env.ADMIN_PASSWORD || 'admin12345';

const existing = await prisma.user.findUnique({ where: { email } });
if (existing) {
  console.log(`Admin already exists: ${email}`);
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.user.create({
  data: {
    id: randomUUID(),
    email,
    displayName: 'Local Admin',
    role: 'admin',
    passwordHash: await bcrypt.hash(password, 12),
    permissions: ALL_PERMISSIONS,
    assignedContractIds: [],
  },
});

console.log(`Admin created: ${email}`);
console.log('Change the default password immediately.');
await prisma.$disconnect();
