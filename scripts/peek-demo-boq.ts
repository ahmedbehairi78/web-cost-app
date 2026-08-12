import 'dotenv/config';
import { prisma, closeDb } from '../server/src/db.ts';

const proj = await prisma.project.findFirst({ where: { projectCode: 'PRJ-DEMO-20260812' } });
console.log('project', proj ? { id: proj.id, code: proj.projectCode } : null);
const contracts = await prisma.contract.findMany({
  where: { projectId: proj?.id ?? '__none__', isDeleted: false },
  orderBy: { createdAt: 'asc' },
  select: { id: true, contractNumber: true, contractName: true, createdAt: true },
});
console.log('contracts', JSON.stringify(contracts, null, 2));
for (const c of contracts) {
  const items = await prisma.boqItem.findMany({
    where: { contractId: c.id, isDeleted: false },
    select: { itemCode: true, description: true, tenderAmount: true },
    orderBy: { itemCode: 'asc' },
  });
  console.log(
    c.contractNumber,
    'items=',
    items.length,
    items.map((i) => `${i.itemCode}:${i.tenderAmount}`),
  );
}
await closeDb();
