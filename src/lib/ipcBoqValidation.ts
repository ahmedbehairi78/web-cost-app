/** Tolerance for qty compare (floating BOQ / MOS rounding). */
export const IPC_BOQ_QTY_TOLERANCE = 0.01;

export type IpcBoqExceedRow = {
  boqItemId: string;
  itemCode?: string;
  description?: string;
  tenderQty: number;
  totalQty: number;
  overBy: number;
};

export type IpcBoqLineInput = {
  boqItemId?: string;
  itemCode?: string;
  description?: string;
  tenderQty?: number;
  totalQty?: number;
};

/** Lines where cumulative IPC qty exceeds BOQ tender qty (after VO updates). */
export function findIpcItemsExceedingTender(
  items: IpcBoqLineInput[],
  tolerance = IPC_BOQ_QTY_TOLERANCE,
): IpcBoqExceedRow[] {
  const out: IpcBoqExceedRow[] = [];
  for (const item of items) {
    const tenderQty = Number(item.tenderQty ?? 0);
    const totalQty = Number(item.totalQty ?? 0);
    if (tenderQty <= tolerance) continue;
    if (totalQty <= tenderQty + tolerance) continue;
    out.push({
      boqItemId: String(item.boqItemId ?? ''),
      itemCode: item.itemCode,
      description: item.description,
      tenderQty,
      totalQty,
      overBy: totalQty - tenderQty,
    });
  }
  return out;
}
