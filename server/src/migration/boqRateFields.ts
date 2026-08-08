/** Map Firestore / backup BOQ doc fields → Postgres rate breakdown scalars. */
export function boqRateFieldsFromSource(doc: Record<string, unknown>): {
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

export function boqHasRateBreakdown(fields: ReturnType<typeof boqRateFieldsFromSource>): boolean {
  return (
    fields.rateMaterials !== 0
    || fields.rateLabour !== 0
    || fields.rateEquipment !== 0
    || fields.rateDirect !== 0
  );
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
