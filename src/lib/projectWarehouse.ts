/** Leaf COA accounts under 127… with 8-digit codes = project central warehouse. */
export const PROJECT_WAREHOUSE_PARENT = '127';

export type WarehouseAccountRef = {
  accountCode?: string;
  isGroup?: boolean;
  status?: string;
  projectId?: string;
};

export type ProjectWarehouseLink = {
  id: string;
  projectName?: string;
  projectNameEn?: string;
  inventoryAccountCode?: string;
};

export function warehouseAccountNameCandidates(projectName: string, projectNameEn?: string): string[] {
  const name = String(projectName || '').trim();
  const nameEn = String(projectNameEn || name).trim();
  const out = new Set<string>();
  if (name) {
    out.add(`مخزون مشروع - ${name}`);
    out.add(`مخزن خامات ${name}`);
  }
  if (nameEn) out.add(`Project Inventory - ${nameEn}`);
  return [...out];
}

/** Find 127… leaf linked to a project (explicit link, inventoryAccountCode, or COA naming). */
export function findWarehouseAccountRowForProject<
  T extends WarehouseAccountRef & { accountName?: string; accountNameEn?: string; id?: string },
>(projectId: string, accounts: T[], project?: ProjectWarehouseLink): T | undefined {
  const pid = String(projectId || '').trim();
  if (!pid) return undefined;

  const projectName = String(project?.projectName || '').trim();
  const codeFromProject = String(project?.inventoryAccountCode || '').trim();

  const byProjectId = accounts.find(
    (a) => isProjectWarehouseAccount(a) && String(a.projectId || '').trim() === pid,
  );
  if (byProjectId) return byProjectId;

  if (codeFromProject) {
    const byCode = accounts.find(
      (a) => isProjectWarehouseAccount(a) && String(a.accountCode || '').trim() === codeFromProject,
    );
    if (byCode) return byCode;
  }

  if (projectName) {
    const labels = new Set(warehouseAccountNameCandidates(projectName, project?.projectNameEn));
    const byLabel = accounts.find((a) => {
      if (!isProjectWarehouseAccount(a)) return false;
      const n = String(a.accountName || '').trim();
      const ne = String(a.accountNameEn || '').trim();
      return labels.has(n) || labels.has(ne);
    });
    if (byLabel) return byLabel;

    const byNameContains = accounts.find(
      (a) =>
        isProjectWarehouseAccount(a) &&
        (String(a.accountName || '').includes(projectName) ||
          String(a.accountNameEn || '').includes(projectName)),
    );
    if (byNameContains) return byNameContains;
  }

  return undefined;
}

export function findDisabledProjectWarehouseAccount<
  T extends WarehouseAccountRef & { accountName?: string },
>(projectId: string, accounts: T[], project?: ProjectWarehouseLink): T | undefined {
  const pid = String(projectId || '').trim();
  if (!pid) return undefined;

  const codeFromProject = String(project?.inventoryAccountCode || '').trim();
  const linked = accounts.find((a) => {
    const code = String(a.accountCode || '').trim();
    if (!code.startsWith(PROJECT_WAREHOUSE_PARENT) || code.length !== 8 || a.status !== 'disabled') {
      return false;
    }
    if (String(a.projectId || '').trim() === pid) return true;
    if (codeFromProject && code === codeFromProject) return true;
    return false;
  });
  return linked;
}

export function isProjectWarehouseAccount(account: WarehouseAccountRef | null | undefined): boolean {
  if (!account || account.isGroup || account.status === 'disabled') return false;
  const code = String(account.accountCode || '').trim();
  return code.startsWith(PROJECT_WAREHOUSE_PARENT) && code.length === 8;
}

/** Resolve Firestore project id from warehouse COA row or project.inventoryAccountCode. */
export function resolveProjectIdForWarehouse(
  warehouseAccount: { accountCode: string; projectId?: string },
  projects: ProjectWarehouseLink[]
): string | null {
  const linked = String(warehouseAccount.projectId || '').trim();
  if (linked) return linked;
  const code = String(warehouseAccount.accountCode || '').trim();
  const match = projects.find((p) => String(p.inventoryAccountCode || '').trim() === code);
  return match?.id ?? null;
}

export type WarehouseAccountPick = {
  accountCode: string;
  accountName: string;
  accountNameEn?: string;
};

/** COA leaf under 127 linked to a project (for GL / transfers). */
export function resolveWarehouseAccountForProject(
  projectId: string,
  accounts: Array<WarehouseAccountRef & { accountName?: string; accountNameEn?: string }>,
  projects: ProjectWarehouseLink[],
): WarehouseAccountPick | null {
  const project = projects.find((p) => p.id === projectId);
  const row = findWarehouseAccountRowForProject(projectId, accounts, project ?? { id: projectId });
  if (!row?.accountCode) return null;
  return {
    accountCode: String(row.accountCode),
    accountName: row.accountName || String(row.accountCode),
    accountNameEn: row.accountNameEn,
  };
}
