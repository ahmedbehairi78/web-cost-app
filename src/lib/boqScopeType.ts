import { roundMoney } from './money';

/** BOQ line scope — primary (basic) vs optional (may not be executed). */
export type BoqScopeType = 'basic' | 'optional';

export const BOQ_SCOPE_BASIC: BoqScopeType = 'basic';
export const BOQ_SCOPE_OPTIONAL: BoqScopeType = 'optional';

const OPTIONAL_ALIASES = new Set([
  'optional',
  'opt',
  'o',
  'اختياري',
  'اختيارى',
  'نطاق اختياري',
  'نطاق اختيارى',
]);

const BASIC_ALIASES = new Set([
  'basic',
  'primary',
  'b',
  'أساسي',
  'اساسي',
  'أساسى',
  'اساسى',
  'نطاق اساسي',
  'نطاق أساسي',
  'نطاق اساسى',
  'نطاق أساسى',
]);

export function normalizeBoqScopeType(raw: unknown): BoqScopeType {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!s) return BOQ_SCOPE_BASIC;
  if (OPTIONAL_ALIASES.has(s)) return BOQ_SCOPE_OPTIONAL;
  if (BASIC_ALIASES.has(s)) return BOQ_SCOPE_BASIC;
  // Arabic without normalization edge cases
  const compact = s.replace(/\s/g, '');
  if (compact.includes('اختيار')) return BOQ_SCOPE_OPTIONAL;
  if (compact.includes('اساس') || compact.includes('أساس')) return BOQ_SCOPE_BASIC;
  return BOQ_SCOPE_BASIC;
}

/** Parse Excel / import column «نوع النطاق» (ar/en). */
export function parseBoqScopeTypeFromImport(raw: unknown): BoqScopeType {
  return normalizeBoqScopeType(raw);
}

export function boqScopeTypeLabel(scope: BoqScopeType, language: string): string {
  if (scope === BOQ_SCOPE_OPTIONAL) {
    return language === 'ar' ? 'اختياري' : 'Optional';
  }
  return language === 'ar' ? 'أساسي' : 'Basic';
}

export function boqScopeTypeExportLabel(scope: BoqScopeType): string {
  return scope === BOQ_SCOPE_OPTIONAL ? 'اختياري' : 'أساسي';
}

export type BoqScopeTotals = {
  basicSum: number;
  optionalSum: number;
  totalSum: number;
};

type BoqScopeAmountRow = {
  id?: string;
  tenderAmount?: number | null;
  scopeType?: unknown;
};

/** Sum contract BOQ by scope (excludes VO-created rows when ids provided). */
export function sumBoqContractScopeTotals(
  items: BoqScopeAmountRow[],
  excludeItemIds?: ReadonlySet<string>,
): BoqScopeTotals {
  let basicSum = 0;
  let optionalSum = 0;
  for (const item of items) {
    const id = item.id ? String(item.id) : '';
    if (id && excludeItemIds?.has(id)) continue;
    const amt = roundMoney(Number(item.tenderAmount ?? 0));
    if (normalizeBoqScopeType(item.scopeType) === BOQ_SCOPE_OPTIONAL) {
      optionalSum = roundMoney(optionalSum + amt);
    } else {
      basicSum = roundMoney(basicSum + amt);
    }
  }
  return {
    basicSum,
    optionalSum,
    totalSum: roundMoney(basicSum + optionalSum),
  };
}

export function buildBoqScopeByItemId(
  items: Array<{ id: string; scopeType?: unknown }>,
): Map<string, BoqScopeType> {
  const map = new Map<string, BoqScopeType>();
  for (const item of items) {
    if (!item.id) continue;
    map.set(String(item.id), normalizeBoqScopeType(item.scopeType));
  }
  return map;
}
