import 'dotenv/config';
import { prisma, closeDb } from '../server/src/db.ts';

const a = await prisma.project.findUnique({ where: { id: 'NblI7EyrC0nFTGSm84Yy' } });
const b = await prisma.project.findUnique({ where: { id: '10f5ad86-621b-49eb-8926-7593264a5313' } });
console.log('id NblI…', a ? { code: a.projectCode, name: a.projectName, deleted: a.isDeleted } : null);
console.log('id 10f5…', b ? { code: b.projectCode, name: b.projectName, deleted: b.isDeleted } : null);

const byCode = await prisma.project.findMany({
  where: { projectCode: 'PRJ-DEMO-20260812' },
  select: { id: true, projectCode: true, isDeleted: true },
});
console.log('by code', byCode);

const contractsOnUuid = await prisma.contract.findMany({
  where: { projectId: '10f5ad86-621b-49eb-8926-7593264a5313', isDeleted: false },
  select: { contractNumber: true, id: true },
});
console.log('contracts on uuid project', contractsOnUuid);

const contractsOnNbl = await prisma.contract.findMany({
  where: { projectId: 'NblI7EyrC0nFTGSm84Yy', isDeleted: false },
  select: { contractNumber: true, id: true },
});
console.log('contracts on Nbl project', contractsOnNbl);

await closeDb();
