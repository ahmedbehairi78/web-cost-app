import { prisma } from '../db.js';

export type ProjectMirrorHints = {
  projectCode?: string;
  projectName?: string;
  clientName?: string;
};

/** Ensures projects(id) exists so inventory / transfer FKs succeed (Firestore may be ahead of Postgres). */
export async function ensureProjectExists(
  projectId: string,
  hints: ProjectMirrorHints = {},
): Promise<void> {
  const id = String(projectId || '').trim();
  if (!id) throw new Error('projectId is required');

  const existing = await prisma.project.findFirst({
    where: { id, isDeleted: false },
    select: { id: true },
  });
  if (existing) return;

  let projectCode = String(hints.projectCode || '').trim() || `PRJ-${id.slice(0, 8)}`;
  const projectName = String(hints.projectName || '').trim() || id;
  const clientName = String(hints.clientName || '').trim() || projectName;

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await prisma.project.create({
        data: {
          id,
          projectCode,
          projectName,
          clientName,
          status: 'active',
          budget: 0,
        },
      });
      return;
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: string }).code)
          : '';
      if (code === 'P2002') {
        projectCode = `${projectCode}-${attempt + 2}`;
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Could not mirror project ${id} in local database`);
}
