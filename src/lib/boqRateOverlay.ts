/** Merge BOQ rate breakdown from Firestore / backup docs when Postgres rows only have totals. */

export function boqRateFieldsFromRecord(doc: Record<string, unknown>): {
  rateMaterials: number;
  rateLabour: number;
  rateEquipment: number;
  rateDirect: number;
  rateOverheadPct: number;
  rateProfitPct: number;
} {
  const rateMaterials = num(doc.rateMaterials);
  const rateLabour = num(doc.rateLabour);
  const rateEquipment = num(doc.rateEquipment);
  const rateDirect = num(doc.rateDirect) || rateMaterials + rateLabour + rateEquipment;
  const ohRaw = doc.rateOverheadPct;
  const profitRaw = doc.rateProfitPct;
  return {
    rateMaterials,
    rateLabour,
    rateEquipment,
    rateDirect,
    rateOverheadPct: ohRaw != null && ohRaw !== '' ? num(ohRaw) : 10,
    rateProfitPct: profitRaw != null && profitRaw !== '' ? num(profitRaw) : 12,
  };
}

export function boqHasRateBreakdown(fields: ReturnType<typeof boqRateFieldsFromRecord>): boolean {
  return (
    fields.rateMaterials !== 0
    || fields.rateLabour !== 0
    || fields.rateEquipment !== 0
    || fields.rateDirect !== 0
  );
}

export function boqRowNeedsRateOverlay(row: Record<string, unknown>): boolean {
  const m = num(row.rateMaterials);
  const l = num(row.rateLabour);
  const e = num(row.rateEquipment);
  if (m !== 0 || l !== 0 || e !== 0) return false;
  return num(row.unitRateTotal) > 0 || num(row.tenderAmount) > 0;
}

export function mergeBoqRowWithRateSource(
  apiRow: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  if (!boqRowNeedsRateOverlay(apiRow)) return apiRow;
  const rates = boqRateFieldsFromRecord(source);
  if (!boqHasRateBreakdown(rates)) return apiRow;
  return {
    ...apiRow,
    rateMaterials: rates.rateMaterials,
    rateLabour: rates.rateLabour,
    rateEquipment: rates.rateEquipment,
    rateDirect: rates.rateDirect,
    rateOverheadPct: rates.rateOverheadPct,
    rateProfitPct: rates.rateProfitPct,
  };
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
