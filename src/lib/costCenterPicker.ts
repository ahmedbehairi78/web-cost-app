/** Indirect service-center codes: HO-001, HO-002, … */
export const INDIRECT_COST_CENTER_PREFIX = 'HO-';

export type CostCenterSelectContract = {
  id: string;
  projectId?: string;
  contractName?: string;
  contractNameEn?: string | null;
  contractNumber?: string;
};

export type CostCenterSelectProject = {
  id: string;
  projectName?: string;
  projectNameEn?: string | null;
};

export type CostCenterSelectIndirect = {
  id: string;
  code: string;
  name: string;
  nameEn?: string | null;
};

export type CostCenterSelectOption = {
  value: string;
  label: string;
  secondary?: string;
  kind: 'direct' | 'indirect';
};

export function buildCostCenterSelectOptions(
  contracts: CostCenterSelectContract[],
  projects: CostCenterSelectProject[],
  indirectCenters: CostCenterSelectIndirect[],
  language: 'ar' | 'en',
): CostCenterSelectOption[] {
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const contractOpts: CostCenterSelectOption[] = contracts.map((c) => {
    const p = c.projectId ? projectMap.get(c.projectId) : undefined;
    const cLab = language === 'ar' ? c.contractName : c.contractNameEn?.trim() || c.contractName;
    const pLab =
      language === 'ar'
        ? p?.projectName || ''
        : p?.projectNameEn?.trim() || p?.projectName || '';
    return {
      value: c.id,
      secondary: c.contractNumber,
      label: pLab ? `${cLab} — ${pLab}` : String(cLab || c.contractNumber || c.id),
      kind: 'direct',
    };
  });
  const indirectOpts: CostCenterSelectOption[] = indirectCenters
    .filter((c) => c.id)
    .map((c) => ({
      value: c.id,
      secondary: c.code,
      label: `${language === 'ar' ? '[غير مباشر]' : '[Indirect]'} ${c.code} — ${
        language === 'ar' ? c.name : c.nameEn || c.name
      }`,
      kind: 'indirect',
    }));
  return [...contractOpts, ...indirectOpts];
}

export function isDirectCostCenterId(
  id: string,
  contracts: Array<{ id: string }>,
): boolean {
  return contracts.some((c) => c.id === id);
}

export function isIndirectCostCenterId(
  id: string,
  indirectCenters: Array<{ id: string }>,
): boolean {
  return indirectCenters.some((c) => c.id === id);
}

/** Resolve project + cost center for journal header (contract id or indirect center id). */
export function resolveCostCenterSelection(
  contracts: CostCenterSelectContract[],
  indirectCenters: CostCenterSelectIndirect[],
  projectId: string,
  costCenterId: string,
): { projectId: string; costCenterId: string } {
  let pid = projectId.trim();
  const cid = costCenterId.trim();
  if (!cid) return { projectId: pid, costCenterId: '' };
  if (isIndirectCostCenterId(cid, indirectCenters)) {
    return { projectId: '', costCenterId: cid };
  }
  const row = contracts.find((x) => x.id === cid);
  if (!row) throw new Error('Invalid cost center');
  if (pid && pid !== row.projectId) throw new Error('Contract does not belong to selected project');
  if (!pid) pid = row.projectId;
  return { projectId: pid, costCenterId: cid };
}

export function shouldClearCostCenterOnProjectChange(
  costCenterId: string,
  projectId: string,
  contracts: CostCenterSelectContract[],
  indirectCenters: CostCenterSelectIndirect[],
): boolean {
  const cid = costCenterId.trim();
  if (!cid || isIndirectCostCenterId(cid, indirectCenters)) return false;
  const pid = projectId.trim();
  return !contracts.some((c) => c.id === cid && (!pid || c.projectId === pid));
}

export function resolveCostCenterDisplay(
  costCenterId: string | null | undefined,
  contracts: CostCenterSelectContract[],
  projects: CostCenterSelectProject[],
  indirectCenters: CostCenterSelectIndirect[],
  language: 'ar' | 'en',
): string {
  const id = String(costCenterId ?? '').trim();
  if (!id) return '-';
  const indirect = indirectCenters.find((c) => c.id === id);
  if (indirect) {
    const name = language === 'ar' ? indirect.name : indirect.nameEn || indirect.name;
    return `${indirect.code} — ${name}`;
  }
  const c = contracts.find((x) => x.id === id);
  if (!c) return `#${id.slice(0, 8)}`;
  const p = c.projectId ? projects.find((pr) => pr.id === c.projectId) : undefined;
  const cname =
    language === 'ar' ? c.contractName : c.contractNameEn?.trim() || c.contractName;
  const pname =
    language === 'ar' ? p?.projectName : p?.projectNameEn?.trim() || p?.projectName;
  return pname ? `${cname} (${pname})` : String(cname || c.contractNumber || id);
}
