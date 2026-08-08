import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../env.js';
import { prisma } from '../db.js';
import { pgConnectionOptions } from '../pgConnection.js';
import { buildPostgresBackup } from './buildPostgresBackup.js';
import { importPostgresBackup, type PostgresImportReport } from './importPostgresBackup.js';

export type PushPreview = {
  configured: boolean;
  local: { transactions: number; transactions2026: number };
  remote: { transactions: number; transactions2026: number } | null;
  missingOnRemote: number;
  targetHost: string | null;
};

function fiscalYearWhere(year: number) {
  return {
    isDeleted: false,
    date: { gte: `${year}-01-01`, lte: `${year}-12-31` },
  };
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function createRemotePrisma(url: string): PrismaClient {
  const adapter = new PrismaPg(pgConnectionOptions(url));
  return new PrismaClient({ adapter, log: ['error'] });
}

export function isPushToProductionEnabled(): boolean {
  return env.nodeEnv !== 'production' && Boolean(env.productionDatabaseUrl);
}

export async function previewPushToProduction(fiscalYear = new Date().getFullYear()): Promise<PushPreview> {
  const url = env.productionDatabaseUrl;
  if (!url) {
    const localCount = await prisma.transaction.count({ where: { isDeleted: false } });
    const localYear = await prisma.transaction.count({ where: fiscalYearWhere(fiscalYear) });
    return {
      configured: false,
      local: { transactions: localCount, transactions2026: localYear },
      remote: null,
      missingOnRemote: 0,
      targetHost: null,
    };
  }

  const localTx = await prisma.transaction.findMany({
    where: { isDeleted: false },
    select: { id: true, date: true },
  });
  const localYear = localTx.filter((t) => String(t.date).startsWith(String(fiscalYear))).length;

  const remote = createRemotePrisma(url);
  try {
    const remoteTx = await remote.transaction.findMany({
      where: { isDeleted: false },
      select: { id: true, date: true },
    });
    const remoteIds = new Set(remoteTx.map((t) => t.id));
    const missingOnRemote = localTx.filter((t) => !remoteIds.has(t.id)).length;
    const remoteYear = remoteTx.filter((t) => String(t.date).startsWith(String(fiscalYear))).length;

    return {
      configured: true,
      local: { transactions: localTx.length, transactions2026: localYear },
      remote: { transactions: remoteTx.length, transactions2026: remoteYear },
      missingOnRemote,
      targetHost: hostFromUrl(url),
    };
  } finally {
    await remote.$disconnect();
  }
}

export async function pushLocalToProduction(): Promise<{
  preview: PushPreview;
  report: PostgresImportReport;
}> {
  const url = env.productionDatabaseUrl;
  if (!url) {
    throw new Error('PRODUCTION_DATABASE_URL is not configured on this API server.');
  }
  if (env.nodeEnv === 'production') {
    throw new Error('Push to production is disabled on production servers.');
  }

  const preview = await previewPushToProduction();
  const backup = await buildPostgresBackup();
  const remote = createRemotePrisma(url);

  try {
    const report = await importPostgresBackup(backup, {
      mode: 'merge',
      targetDb: remote,
      skipCollections: ['users'],
    });
    return { preview, report };
  } finally {
    await remote.$disconnect();
  }
}
