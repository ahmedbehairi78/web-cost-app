import 'dotenv/config';
import { prisma, closeDb } from '../server/src/db.ts';

const projects = await prisma.project.findMany({
  where: { isDeleted: false },
  orderBy: { createdAt: 'asc' },
  select: { projectCode: true, projectName: true },
});
console.log('projects(createdAt asc):', projects.map((p) => p.projectCode).join(' | '));

const demoContracts = await prisma.contract.findMany({
  where: {
    isDeleted: false,
    OR: [
      { contractNumber: { startsWith: 'CRT-DEMO' } },
      { contractNumber: { startsWith: 'CRT-BOQ' } },
      { project: { projectCode: 'PRJ-DEMO-20260812' } },
    ],
  },
  select: { contractNumber: true, projectId: true, isDeleted: true },
});
console.log('demoContracts', demoContracts);

const items = await prisma.boqItem.findMany({
  where: { itemCode: { startsWith: 'DEMO-' }, isDeleted: false },
  select: { itemCode: true, contractId: true, projectId: true },
});
console.log('demoItems', items);

await closeDb();
