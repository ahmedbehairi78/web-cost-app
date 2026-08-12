import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const proj = await p.project.findFirst({ where: { projectCode: 'PRJ-DEMO-20260812' } });
console.log('project', proj ? { id: proj.id, code: proj.projectCode } : null);
const contracts = await p.contract.findMany({
  where: { projectId: proj?.id ?? '__none__', isDeleted: false },
  orderBy: { createdAt: 'asc' },
  select: { id: true, contractNumber: true, contractName: true, createdAt: true },
});
console.log('contracts', contracts);
for (const c of contracts) {
  const items = await p.boqItem.findMany({
    where: { contractId: c.id, isDeleted: false },
    select: { itemCode: true, description: true, tenderAmount: true },
    orderBy: { itemCode: 'asc' },
  });
  console.log(c.contractNumber, 'items=', items.length, items.map((i) => i.itemCode));
}
await p.$disconnect();
