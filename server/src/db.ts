import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from './env.js';
import { pgConnectionOptions } from './pgConnection.js';

const adapter = new PrismaPg(pgConnectionOptions(env.databaseUrl));
export const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export async function closeDb() {
  await prisma.$disconnect();
}
