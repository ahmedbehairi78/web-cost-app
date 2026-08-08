import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

function num(v: unknown): number {
  return Number(v ?? 0);
}

type DbClient = Prisma.TransactionClient | typeof prisma;

/** Approved MOS cumulative equivalent + supplied per BOQ item (certificates + legacy extracts). */
export async function buildMosPriorMaps(
  contractId: string,
  client: DbClient = prisma,
): Promise<{ equivalent: Record<string, number>; supplied: Record<string, number> }> {
  const equivalent: Record<string, number> = {};
  const supplied: Record<string, number> = {};

  const approvedCerts = await client.mosCertificate.findMany({
    where: { contractId, status: 'approved' },
    orderBy: { sequenceNo: 'asc' },
    include: { lines: true },
  });
  for (const cert of approvedCerts) {
    for (const line of cert.lines) {
      equivalent[line.boqItemId] = num(line.equivalentCumulative);
      supplied[line.boqItemId] = num(line.suppliedQtyCumulative);
    }
  }

  const legacy = await client.materialOnSiteExtract.findMany({
    where: { contractId, status: 'approved' },
  });
  for (const row of legacy) {
    equivalent[row.boqItemId] = (equivalent[row.boqItemId] ?? 0) + num(row.equivalentQuantity);
    supplied[row.boqItemId] = (supplied[row.boqItemId] ?? 0) + num(row.suppliedQuantity);
  }

  return { equivalent, supplied };
}
