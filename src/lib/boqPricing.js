/**
 * BOQ pricing helpers (aligned with web-cost-app-local).
 */
export const BOQ_DEFAULT_OVERHEAD_PCT = 10;
export const BOQ_DEFAULT_PROFIT_PCT = 12;
function toN(v) {
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'bigint')
        return Number(v);
    if (v == null || v === '')
        return 0;
    if (typeof v === 'string') {
        const n = Number(v.replace(/,/g, '').trim());
        return Number.isFinite(n) ? n : 0;
    }
    if (typeof v === 'object' && v !== null && 'toString' in v) {
        const n = Number(String(v));
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}
export function computeBoqUnitRate(input) {
    const { rateMaterials, rateLabour, rateEquipment, rateOverheadPct, rateProfitPct } = input;
    const direct = rateMaterials + rateLabour + rateEquipment;
    const ohFactor = 1 + rateOverheadPct / 100;
    const profitFactor = 1 + rateProfitPct / 100;
    const unitRateTotal = direct * ohFactor * profitFactor;
    const overheadAmt = direct * (rateOverheadPct / 100);
    const subtotalAfterOverhead = direct * ohFactor;
    const profitAmt = subtotalAfterOverhead * (rateProfitPct / 100);
    return { direct, unitRateTotal, overheadAmt, subtotalAfterOverhead, profitAmt };
}
function resolveProfitPctForCostBudget(rateProfitPct) {
    return rateProfitPct > 0 ? rateProfitPct : BOQ_DEFAULT_PROFIT_PCT;
}
/** Tender amount ex contractor profit (after overhead), for cost-budget vs actual. */
export function tenderAmountExcludingProfit(item) {
    const qty = toN(item.tenderQty);
    const profitPct = resolveProfitPctForCostBudget(toN(item.rateProfitPct));
    const mats = toN(item.rateMaterials);
    const lab = toN(item.rateLabour);
    const eq = toN(item.rateEquipment);
    const oh = toN(item.rateOverheadPct);
    const pf = 1 + profitPct / 100;
    if (mats !== 0 || lab !== 0 || eq !== 0) {
        const { subtotalAfterOverhead } = computeBoqUnitRate({
            rateMaterials: mats,
            rateLabour: lab,
            rateEquipment: eq,
            rateOverheadPct: oh,
            rateProfitPct: profitPct,
        });
        const amount = subtotalAfterOverhead * qty;
        if (amount !== 0)
            return amount;
    }
    const ta = toN(item.tenderAmount);
    const unit = toN(item.unitRateTotal);
    if (unit !== 0)
        return (unit / pf) * qty;
    if (qty !== 0 && ta !== 0)
        return ta / pf;
    return ta;
}
