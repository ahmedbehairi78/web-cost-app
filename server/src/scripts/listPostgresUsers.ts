import { prisma } from '../db.js';

const users = await prisma.user.findMany({
  select: { id: true, email: true, role: true, permissions: true, isActive: true },
});
console.log(JSON.stringify(users, null, 2));
await prisma.$disconnect();
