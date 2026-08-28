import { normalizeDate } from '../../lib/utils';
import { type BoqScopeType, boqScopeTypeLabel, normalizeBoqScopeType } from '../../lib/boqScopeType';

export type BoqWorkStatus = 'done' | 'not_started' | 'late' | 'running' | 'none';

export type BoqRowViewModel = {
  id: string;
  index: number;
  itemCode: string;
  description: string;
  unit: string;
  tenderQty: number;
  chapterCode: string;
  chapterName: string;
  sectionCode: string;
  sectionName: string;
  workTypeCode: string;
  startDateKey: string;
  expectedDuration: number;
  endDateLabel: string;
  endDateClass: string;
  progressPct: number;
  status: BoqWorkStatus;
  rateMaterials: number;
  rateLabour: number;
  rateEquipment: number;
  rateOverheadPct: number;
  rateProfitPct: number;
  unitRateTotal: number;
  tenderAmount: number;
  scopeType: BoqScopeType;
  scopeLabel: string;
  projectId: string;
  contractId: string;
  actualConsumed: number;
  inventoryBalance: number | null;
};

type BoqRowSource = {
  id: string;
  projectId?: string;
  contractId?: string;
  chapterCode?: string;
  chapterName?: string;
  workTypeCode?: string;
  sectionCode?: string;
  sectionName?: string;
  itemCode: string;
  description: string;
  unit: string;
  tenderQty: number;
  rateMaterials?: number;
  rateLabour?: number;
  rateEquipment?: number;
  rateOverheadPct?: number;
  rateProfitPct?: number;
  unitRateTotal?: number;
  tenderAmount?: number;
  startDate?: string;
  expectedDuration?: number;
  scopeType?: unknown;
};

export function buildBoqRowViewModel(
  item: BoqRowSource,
  index: number,
  progressQty: number,
  locale: string,
  language: string,
  now: Date,
  actualConsumed: number,
  inventoryBalance: number | null,
): BoqRowViewModel {
  const tenderQty = Number(item.tenderQty || 0);
  const progressPct = tenderQty > 0 ? (progressQty / tenderQty) * 100 : 0;
  const duration = Number(item.expectedDuration || 0);
  const startKey = item.startDate ? normalizeDate(item.startDate) : '';

  let endDateLabel = '-';
  let endDateClass = 'text-gray-500';
  let status: BoqWorkStatus = 'none';

  if (startKey && duration > 0) {
    const [sy, sm, sd] = startKey.split('-').map(Number);
    const start = new Date(sy, sm - 1, sd);
    const end = new Date(sy, sm - 1, sd + duration);
    endDateLabel = end.toLocaleDateString(locale);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const isCompleted = progressPct >= 99.9;
    const notStarted = start > today;
    const isDelayed = end < today && !isCompleted;
    endDateClass = isDelayed ? 'text-red-500' : 'text-blue-500';
    if (isCompleted) status = 'done';
    else if (notStarted) status = 'not_started';
    else if (isDelayed) status = 'late';
    else status = 'running';
  }

  const scopeType = normalizeBoqScopeType(item.scopeType);

  return {
    id: item.id,
    index,
    itemCode: item.itemCode,
    description: item.description,
    unit: item.unit,
    tenderQty,
    chapterCode: item.chapterCode || '',
    chapterName: item.chapterName || '',
    sectionCode: item.sectionCode || '',
    sectionName: item.sectionName || '',
    workTypeCode: item.workTypeCode || '',
    startDateKey: startKey,
    expectedDuration: duration,
    endDateLabel,
    endDateClass,
    progressPct,
    status,
    rateMaterials: Number(item.rateMaterials ?? 0),
    rateLabour: Number(item.rateLabour ?? 0),
    rateEquipment: Number(item.rateEquipment ?? 0),
    rateOverheadPct: Number(item.rateOverheadPct ?? 0),
    rateProfitPct: Number(item.rateProfitPct ?? 0),
    unitRateTotal: Number(item.unitRateTotal ?? 0),
    tenderAmount: Number(item.tenderAmount ?? 0),
    scopeType,
    scopeLabel: boqScopeTypeLabel(scopeType, language),
    projectId: item.projectId || '',
    contractId: item.contractId || '',
    actualConsumed,
    inventoryBalance,
  };
}
