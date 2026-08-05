import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

export type DbClient = Prisma.TransactionClient | typeof prisma;

import { roundMoney as roundMoneyInt, MONEY_TOLERANCE } from '../lib/money.js';

export const EPSILON = 0.000001;

export function toMoney(value: number): number {
  return roundMoneyInt(value);
}

export { roundMoneyInt as roundMoney, MONEY_TOLERANCE };

/** Unit cost for inventory = purchase price ex-VAT + proportional VAT. */
export function unitCostInclVat(exVatUnitCost: number, vatPct: number): number {
  const pct = Number.isFinite(vatPct) ? vatPct : 0;
  return toMoney(exVatUnitCost * (1 + pct / 100));
}

function dec(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

export function num(v: Prisma.Decimal | number | null | undefined): number {
  return Number(v ?? 0);
}

export function computeContractInventoryBalance(row: {
  quantityIn: Prisma.Decimal | number;
  quantityTransferredIn: Prisma.Decimal | number;
  quantityConsumed: Prisma.Decimal | number;
  quantityTransferredOut: Prisma.Decimal | number;
  quantityReserved: Prisma.Decimal | number;
}): number {
  return toMoney(
    num(row.quantityIn) +
      num(row.quantityTransferredIn) -
      num(row.quantityConsumed) -
      num(row.quantityTransferredOut) -
      num(row.quantityReserved),
  );
}

export function computeProjectInventoryBalance(row: {
  quantityIn: Prisma.Decimal | number;
  quantityIssued: Prisma.Decimal | number;
  quantityReturned: Prisma.Decimal | number;
  quantityReserved: Prisma.Decimal | number;
}): number {
  return toMoney(
    num(row.quantityIn) +
      num(row.quantityReturned) -
      num(row.quantityIssued) -
      num(row.quantityReserved),
  );
}

export function getAssignedContractIds(user: Express.Request['user']): string[] | null {
  if (!user) return null;
  if (user.role === 'admin' || user.role === 'projects_manager') return null;
  if (Array.isArray(user.assignedContractIds)) return user.assignedContractIds;
  try {
    const ids = JSON.parse((user as unknown as Record<string, string>).assignedContractIds ?? '[]');
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

export function assertContractAccess(user: Express.Request['user'], contractId: string): void {
  const assigned = getAssignedContractIds(user);
  if (assigned !== null && !assigned.includes(contractId)) {
    throw new Error('Access denied to this contract');
  }
}

export async function assertProjectAccess(
  client: DbClient,
  user: Express.Request['user'],
  projectId: string,
): Promise<void> {
  const assigned = getAssignedContractIds(user);
  if (assigned === null) return;
  if (assigned.length === 0) throw new Error('Access denied to this project');
  const row = await client.contract.findFirst({
    where: { projectId, id: { in: assigned } },
    select: { id: true },
  });
  if (!row) throw new Error('Access denied to this project');
}

/** Project IDs where the user has at least one assigned contract; null = unrestricted. */
export async function getAccessibleProjectIds(
  client: DbClient,
  user: Express.Request['user'],
): Promise<string[] | null> {
  const assigned = getAssignedContractIds(user);
  if (assigned === null) return null;
  if (assigned.length === 0) return [];
  const rows = await client.contract.findMany({
    where: { id: { in: assigned } },
    select: { projectId: true },
    distinct: ['projectId'],
  });
  return rows.map((r) => r.projectId).filter(Boolean);
}

export type InventoryRow = {
  id: number;
  contractId: string;
  materialCategoryId: number | null;
  itemDescription: string | null;
  unit: string;
  quantityBalance: number;
  quantityReserved: number;
  avgUnitCost: number;
};

export async function getInventoryByContractMaterial(
  client: DbClient,
  contractId: string,
  materialCategoryId: number,
): Promise<InventoryRow | undefined> {
  const row = await client.contractInventory.findFirst({
    where: { contractId, materialCategoryId },
    orderBy: { id: 'asc' },
  });
  if (!row) return undefined;
  return {
    id: row.id,
    contractId: row.contractId,
    materialCategoryId: row.materialCategoryId,
    itemDescription: row.itemDescription,
    unit: row.unit,
    quantityBalance: num(row.quantityBalance),
    quantityReserved: num(row.quantityReserved),
    avgUnitCost: num(row.avgUnitCost),
  };
}

export function getAvailableQuantity(item: { quantityBalance: number }): number {
  return Number(item.quantityBalance ?? 0);
}

export function weightedAvgCost(
  existingQty: number,
  existingCost: number,
  incomingQty: number,
  incomingCost: number,
): number {
  const nextQty = existingQty + incomingQty;
  if (nextQty <= EPSILON) return incomingCost;
  return toMoney((existingQty * existingCost + incomingQty * incomingCost) / nextQty);
}

export async function upsertInventoryReceipt(
  client: DbClient,
  contractId: string,
  materialCategoryId: number,
  categoryName: string,
  unit: string,
  quantity: number,
  unitCost: number,
): Promise<number> {
  const existing = await getInventoryByContractMaterial(client, contractId, materialCategoryId);
  if (!existing) {
    const quantityIn = quantity;
    const quantityBalance = computeContractInventoryBalance({
      quantityIn,
      quantityTransferredIn: 0,
      quantityConsumed: 0,
      quantityTransferredOut: 0,
      quantityReserved: 0,
    });
    const created = await client.contractInventory.create({
      data: {
        contractId,
        materialCategoryId,
        itemDescription: categoryName,
        unit,
        quantityIn: dec(quantityIn),
        avgUnitCost: dec(unitCost),
        quantityBalance: dec(quantityBalance),
      },
    });
    return created.id;
  }

  const full = await client.contractInventory.findUnique({ where: { id: existing.id } });
  if (!full) throw new Error('Inventory item not found');

  const physicalQty =
    num(full.quantityIn) +
    num(full.quantityTransferredIn) -
    num(full.quantityConsumed) -
    num(full.quantityTransferredOut);
  const nextCost = weightedAvgCost(physicalQty, num(full.avgUnitCost), quantity, unitCost);
  const quantityIn = num(full.quantityIn) + quantity;
  const quantityBalance = computeContractInventoryBalance({
    quantityIn,
    quantityTransferredIn: full.quantityTransferredIn,
    quantityConsumed: full.quantityConsumed,
    quantityTransferredOut: full.quantityTransferredOut,
    quantityReserved: full.quantityReserved,
  });

  await client.contractInventory.update({
    where: { id: existing.id },
    data: {
      quantityIn: dec(quantityIn),
      avgUnitCost: dec(nextCost),
      itemDescription: full.itemDescription ?? categoryName,
      quantityBalance: dec(quantityBalance),
    },
  });
  return existing.id;
}

/** Legacy contract inventory keyed by description+unit when materialCategoryId is absent. */
export async function upsertLegacyContractInventoryReceipt(
  client: DbClient,
  contractId: string,
  itemDescription: string,
  unit: string,
  quantity: number,
  unitCost: number,
): Promise<void> {
  const existing = await client.contractInventory.findFirst({
    where: { contractId, materialCategoryId: null, itemDescription, unit },
    orderBy: { id: 'asc' },
  });

  if (!existing) {
    const quantityBalance = computeContractInventoryBalance({
      quantityIn: quantity,
      quantityTransferredIn: 0,
      quantityConsumed: 0,
      quantityTransferredOut: 0,
      quantityReserved: 0,
    });
    await client.contractInventory.create({
      data: {
        contractId,
        materialCategoryId: null,
        itemDescription,
        unit,
        quantityIn: dec(quantity),
        avgUnitCost: dec(unitCost),
        quantityBalance: dec(quantityBalance),
      },
    });
    return;
  }

  const full = await client.contractInventory.findUnique({ where: { id: existing.id } });
  if (!full) throw new Error('Inventory item not found');

  const physicalQty =
    num(full.quantityIn) +
    num(full.quantityTransferredIn) -
    num(full.quantityConsumed) -
    num(full.quantityTransferredOut);
  const nextCost = weightedAvgCost(physicalQty, num(full.avgUnitCost), quantity, unitCost);
  const quantityIn = num(full.quantityIn) + quantity;
  const quantityBalance = computeContractInventoryBalance({
    quantityIn,
    quantityTransferredIn: full.quantityTransferredIn,
    quantityConsumed: full.quantityConsumed,
    quantityTransferredOut: full.quantityTransferredOut,
    quantityReserved: full.quantityReserved,
  });

  await client.contractInventory.update({
    where: { id: existing.id },
    data: {
      quantityIn: dec(quantityIn),
      avgUnitCost: dec(nextCost),
      quantityBalance: dec(quantityBalance),
    },
  });
}

export async function reserveInventory(
  client: DbClient,
  inventoryId: number,
  quantity: number,
): Promise<void> {
  const item = await client.contractInventory.findUnique({ where: { id: inventoryId } });
  if (!item) throw new Error('Inventory item not found');
  const available = num(item.quantityBalance);
  if (quantity > available + EPSILON) {
    throw new Error(`Insufficient balance. Available: ${available.toFixed(2)}`);
  }
  const quantityReserved = num(item.quantityReserved) + quantity;
  const quantityBalance = computeContractInventoryBalance({
    quantityIn: item.quantityIn,
    quantityTransferredIn: item.quantityTransferredIn,
    quantityConsumed: item.quantityConsumed,
    quantityTransferredOut: item.quantityTransferredOut,
    quantityReserved,
  });
  await client.contractInventory.update({
    where: { id: inventoryId },
    data: {
      quantityReserved: dec(quantityReserved),
      quantityBalance: dec(quantityBalance),
    },
  });
}

export async function releaseInventoryReserve(
  client: DbClient,
  inventoryId: number,
  quantity: number,
): Promise<void> {
  const item = await client.contractInventory.findUnique({ where: { id: inventoryId } });
  if (!item) return;
  const quantityReserved = Math.max(0, num(item.quantityReserved) - quantity);
  const quantityBalance = computeContractInventoryBalance({
    quantityIn: item.quantityIn,
    quantityTransferredIn: item.quantityTransferredIn,
    quantityConsumed: item.quantityConsumed,
    quantityTransferredOut: item.quantityTransferredOut,
    quantityReserved,
  });
  await client.contractInventory.update({
    where: { id: inventoryId },
    data: {
      quantityReserved: dec(quantityReserved),
      quantityBalance: dec(quantityBalance),
    },
  });
}

export async function assertBoqMaterialAllowed(
  client: DbClient,
  boqItemId: string,
  materialCategoryId: number,
): Promise<void> {
  const link = await client.boqItemMaterial.findFirst({
    where: { boqItemId, materialCategoryId },
    select: { id: true },
  });
  if (!link) throw new Error('Material is not linked to the selected BOQ item');
}

// ─── Project central warehouse (project_inventory) ───────────────────────────

export type ProjectInventoryRow = {
  id: number;
  projectId: string;
  materialCategoryId: number;
  itemDescription: string | null;
  unit: string;
  quantityIn: number;
  quantityIssued: number;
  quantityReturned: number;
  quantityBalance: number;
  quantityReserved: number;
  quantityUnpriced: number;
  avgUnitCost: number;
};

export async function getProjectInventoryByMaterial(
  client: DbClient,
  projectId: string,
  materialCategoryId: number,
): Promise<ProjectInventoryRow | undefined> {
  const row = await client.projectInventory.findFirst({
    where: { projectId, materialCategoryId },
  });
  if (!row) return undefined;
  return {
    id: row.id,
    projectId: row.projectId,
    materialCategoryId: row.materialCategoryId,
    itemDescription: row.itemDescription,
    unit: row.unit,
    quantityIn: num(row.quantityIn),
    quantityIssued: num(row.quantityIssued),
    quantityReturned: num(row.quantityReturned),
    quantityBalance: num(row.quantityBalance),
    quantityReserved: num(row.quantityReserved),
    quantityUnpriced: num((row as { quantityUnpriced?: Prisma.Decimal }).quantityUnpriced),
    avgUnitCost: num(row.avgUnitCost),
  };
}

export function getProjectAvailableQuantity(item: { quantityBalance: number }): number {
  return Number(item.quantityBalance ?? 0);
}

/** How much of available qty is already priced (avg cost known). */
export function getPricedAvailableQuantity(item: {
  quantityBalance: number;
  quantityUnpriced: number;
}): number {
  return Math.max(0, toMoney(getProjectAvailableQuantity(item) - num(item.quantityUnpriced)));
}

/**
 * True when issuing `quantity` would draw from unpriced stock
 * (or avg is zero while unpriced remains).
 */
export function consumptionTouchesUnpriced(
  item: { quantityBalance: number; quantityUnpriced: number; avgUnitCost: number },
  quantity: number,
): boolean {
  const unpriced = num(item.quantityUnpriced);
  if (unpriced <= EPSILON) return false;
  const pricedAvail = getPricedAvailableQuantity(item);
  if (quantity > pricedAvail + EPSILON) return true;
  if (num(item.avgUnitCost) <= EPSILON && unpriced > EPSILON) return true;
  return false;
}

/** Receive stock without unit cost — increases in + unpriced; avg unchanged. */
export async function receiveUnpricedProjectInventory(
  client: DbClient,
  projectId: string,
  materialCategoryId: number,
  categoryName: string,
  unit: string,
  quantity: number,
  options?: { referenceType?: string; referenceId?: string; notes?: string },
): Promise<number> {
  if (quantity <= EPSILON) throw new Error('Receipt quantity must be greater than zero');
  const existing = await getProjectInventoryByMaterial(client, projectId, materialCategoryId);
  if (!existing) {
    const quantityBalance = computeProjectInventoryBalance({
      quantityIn: quantity,
      quantityIssued: 0,
      quantityReturned: 0,
      quantityReserved: 0,
    });
    const created = await client.projectInventory.create({
      data: {
        projectId,
        materialCategoryId,
        itemDescription: categoryName,
        unit,
        quantityIn: dec(quantity),
        quantityUnpriced: dec(quantity),
        avgUnitCost: dec(0),
        quantityBalance: dec(quantityBalance),
      },
    });
    await logProjectInventoryMovement(client, {
      projectId,
      materialCategoryId,
      movementType: 'receipt',
      quantity,
      referenceType: options?.referenceType,
      referenceId: options?.referenceId,
      notes: options?.notes ?? 'unpriced receipt',
    });
    return created.id;
  }

  const full = await client.projectInventory.findUnique({ where: { id: existing.id } });
  if (!full) throw new Error('Project inventory not found');
  const quantityIn = num(full.quantityIn) + quantity;
  const quantityUnpriced = num((full as { quantityUnpriced?: Prisma.Decimal }).quantityUnpriced) + quantity;
  const quantityBalance = computeProjectInventoryBalance({
    quantityIn,
    quantityIssued: full.quantityIssued,
    quantityReturned: full.quantityReturned,
    quantityReserved: full.quantityReserved,
  });
  await client.projectInventory.update({
    where: { id: existing.id },
    data: {
      quantityIn: dec(quantityIn),
      quantityUnpriced: dec(quantityUnpriced),
      itemDescription: full.itemDescription ?? categoryName,
      quantityBalance: dec(quantityBalance),
    },
  });
  await logProjectInventoryMovement(client, {
    projectId,
    materialCategoryId,
    movementType: 'receipt',
    quantity,
    referenceType: options?.referenceType,
    referenceId: options?.referenceId,
    notes: options?.notes ?? 'unpriced receipt',
  });
  return existing.id;
}

/** Apply unit cost to previously unpriced qty — reduces unpriced, updates weighted avg. */
export async function priceUnpricedProjectInventory(
  client: DbClient,
  projectId: string,
  materialCategoryId: number,
  quantity: number,
  unitCost: number,
  options?: { referenceType?: string; referenceId?: string },
): Promise<void> {
  if (quantity <= EPSILON) throw new Error('Price quantity must be greater than zero');
  if (unitCost < 0) throw new Error('Unit cost cannot be negative');
  const full = await client.projectInventory.findFirst({
    where: { projectId, materialCategoryId },
  });
  if (!full) throw new Error('Project inventory not found');
  const unpriced = num((full as { quantityUnpriced?: Prisma.Decimal }).quantityUnpriced);
  if (quantity > unpriced + EPSILON) {
    throw new Error(
      `Cannot price more than unpriced qty. Unpriced: ${unpriced.toFixed(2)}, requested: ${quantity.toFixed(2)}`,
    );
  }
  const physical = projectPhysicalQty(full);
  const pricedBefore = Math.max(0, physical - unpriced);
  const nextCost =
    pricedBefore <= EPSILON
      ? toMoney(unitCost)
      : weightedAvgCost(pricedBefore, num(full.avgUnitCost), quantity, unitCost);
  const quantityUnpriced = Math.max(0, unpriced - quantity);
  await client.projectInventory.update({
    where: { id: full.id },
    data: {
      quantityUnpriced: dec(quantityUnpriced),
      avgUnitCost: dec(nextCost),
    },
  });
  await logProjectInventoryMovement(client, {
    projectId,
    materialCategoryId,
    movementType: 'receipt',
    quantity,
    unitCost,
    referenceType: options?.referenceType,
    referenceId: options?.referenceId,
    notes: 'price unpriced receipt',
  });
}

/** Reverse an unpriced receipt (reject after submit). */
export async function reverseUnpricedProjectInventory(
  client: DbClient,
  projectId: string,
  materialCategoryId: number,
  quantity: number,
  options?: { referenceType?: string; referenceId?: string },
): Promise<void> {
  if (quantity <= EPSILON) return;
  const full = await client.projectInventory.findFirst({
    where: { projectId, materialCategoryId },
  });
  if (!full) throw new Error('Project inventory not found');
  const unpriced = num((full as { quantityUnpriced?: Prisma.Decimal }).quantityUnpriced);
  if (quantity > unpriced + EPSILON) {
    throw new Error(
      `Cannot reverse more unpriced qty than available. Unpriced: ${unpriced.toFixed(2)}`,
    );
  }
  const quantityIn = num(full.quantityIn) - quantity;
  if (quantityIn < -EPSILON) throw new Error('Cannot reverse receipt: insufficient quantity in');
  const quantityUnpriced = Math.max(0, unpriced - quantity);
  const quantityBalance = computeProjectInventoryBalance({
    quantityIn: Math.max(0, quantityIn),
    quantityIssued: full.quantityIssued,
    quantityReturned: full.quantityReturned,
    quantityReserved: full.quantityReserved,
  });
  if (quantityBalance < -EPSILON) {
    throw new Error(
      'Cannot reject receipt: stock is reserved or issued against this unpriced quantity',
    );
  }
  await client.projectInventory.update({
    where: { id: full.id },
    data: {
      quantityIn: dec(Math.max(0, quantityIn)),
      quantityUnpriced: dec(quantityUnpriced),
      quantityBalance: dec(Math.max(0, quantityBalance)),
    },
  });
  await logProjectInventoryMovement(client, {
    projectId,
    materialCategoryId,
    movementType: 'issue',
    quantity,
    referenceType: options?.referenceType,
    referenceId: options?.referenceId,
    notes: 'reverse unpriced receipt',
  });
}

export async function reserveProjectInventory(
  client: DbClient,
  projectInventoryId: number,
  quantity: number,
): Promise<void> {
  const item = await client.projectInventory.findUnique({ where: { id: projectInventoryId } });
  if (!item) throw new Error('Project inventory item not found');
  const available = getProjectAvailableQuantity({ quantityBalance: num(item.quantityBalance) });
  if (quantity > available + EPSILON) {
    throw new Error(`Insufficient balance. Available: ${available.toFixed(2)}`);
  }
  const quantityReserved = num(item.quantityReserved) + quantity;
  const quantityBalance = computeProjectInventoryBalance({
    quantityIn: item.quantityIn,
    quantityIssued: item.quantityIssued,
    quantityReturned: item.quantityReturned,
    quantityReserved,
  });
  await client.projectInventory.update({
    where: { id: projectInventoryId },
    data: {
      quantityReserved: dec(quantityReserved),
      quantityBalance: dec(quantityBalance),
    },
  });
}

export async function releaseProjectInventoryReserve(
  client: DbClient,
  projectInventoryId: number,
  quantity: number,
): Promise<void> {
  const item = await client.projectInventory.findUnique({ where: { id: projectInventoryId } });
  if (!item) return;
  const quantityReserved = Math.max(0, num(item.quantityReserved) - quantity);
  const quantityBalance = computeProjectInventoryBalance({
    quantityIn: item.quantityIn,
    quantityIssued: item.quantityIssued,
    quantityReturned: item.quantityReturned,
    quantityReserved,
  });
  await client.projectInventory.update({
    where: { id: projectInventoryId },
    data: {
      quantityReserved: dec(quantityReserved),
      quantityBalance: dec(quantityBalance),
    },
  });
}

function projectPhysicalQty(row: {
  quantityIn: Prisma.Decimal | number;
  quantityIssued: Prisma.Decimal | number;
  quantityReturned: Prisma.Decimal | number;
}): number {
  return num(row.quantityIn) + num(row.quantityReturned) - num(row.quantityIssued);
}

export async function logProjectInventoryMovement(
  client: DbClient,
  params: {
    projectId: string;
    materialCategoryId: number;
    movementType: 'receipt' | 'issue' | 'return' | 'reserve' | 'release';
    quantity: number;
    unitCost?: number;
    referenceType?: string;
    referenceId?: string;
    notes?: string;
  },
): Promise<void> {
  await client.projectInventoryMovement.create({
    data: {
      projectId: params.projectId,
      materialCategoryId: params.materialCategoryId,
      movementType: params.movementType,
      quantity: dec(params.quantity),
      unitCost: params.unitCost != null ? dec(params.unitCost) : null,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      notes: params.notes ?? null,
    },
  });
}

/** Inbound transfer at original unit cost (weighted into avg when row exists). */
export async function receiptProjectInventoryTransfer(
  client: DbClient,
  projectId: string,
  materialCategoryId: number,
  categoryName: string,
  unit: string,
  quantity: number,
  unitCost: number,
  options?: { referenceType?: string; referenceId?: string },
): Promise<void> {
  if (quantity <= EPSILON) return;
  const existing = await getProjectInventoryByMaterial(client, projectId, materialCategoryId);
  if (!existing) {
    const quantityBalance = computeProjectInventoryBalance({
      quantityIn: quantity,
      quantityIssued: 0,
      quantityReturned: 0,
      quantityReserved: 0,
    });
    await client.projectInventory.create({
      data: {
        projectId,
        materialCategoryId,
        itemDescription: categoryName,
        unit,
        quantityIn: dec(quantity),
        avgUnitCost: dec(unitCost),
        quantityBalance: dec(quantityBalance),
      },
    });
    await logProjectInventoryMovement(client, {
      projectId,
      materialCategoryId,
      movementType: 'receipt',
      quantity,
      unitCost,
      referenceType: options?.referenceType ?? 'project_transfer',
      referenceId: options?.referenceId,
    });
    return;
  }

  const full = await client.projectInventory.findUnique({ where: { id: existing.id } });
  if (!full) throw new Error('Project inventory not found');

  const physicalQty = projectPhysicalQty(full);
  const nextCost = weightedAvgCost(physicalQty, num(full.avgUnitCost), quantity, unitCost);
  const quantityIn = num(full.quantityIn) + quantity;
  const quantityBalance = computeProjectInventoryBalance({
    quantityIn,
    quantityIssued: full.quantityIssued,
    quantityReturned: full.quantityReturned,
    quantityReserved: full.quantityReserved,
  });

  await client.projectInventory.update({
    where: { id: existing.id },
    data: {
      quantityIn: dec(quantityIn),
      avgUnitCost: dec(nextCost),
      itemDescription: full.itemDescription ?? categoryName,
      quantityBalance: dec(quantityBalance),
    },
  });
  await logProjectInventoryMovement(client, {
    projectId,
    materialCategoryId,
    movementType: 'receipt',
    quantity,
    unitCost,
    referenceType: options?.referenceType ?? 'project_transfer',
    referenceId: options?.referenceId,
  });
}

/** Receipt into project warehouse — weighted avg unit cost (incl VAT). */
export async function upsertProjectInventoryReceipt(
  client: DbClient,
  projectId: string,
  materialCategoryId: number,
  categoryName: string,
  unit: string,
  quantity: number,
  unitCost: number,
  options?: { referenceType?: string; referenceId?: string },
): Promise<number> {
  const existing = await getProjectInventoryByMaterial(client, projectId, materialCategoryId);
  if (!existing) {
    const quantityBalance = computeProjectInventoryBalance({
      quantityIn: quantity,
      quantityIssued: 0,
      quantityReturned: 0,
      quantityReserved: 0,
    });
    const created = await client.projectInventory.create({
      data: {
        projectId,
        materialCategoryId,
        itemDescription: categoryName,
        unit,
        quantityIn: dec(quantity),
        avgUnitCost: dec(unitCost),
        quantityBalance: dec(quantityBalance),
      },
    });
    await logProjectInventoryMovement(client, {
      projectId,
      materialCategoryId,
      movementType: 'receipt',
      quantity,
      unitCost,
      referenceType: options?.referenceType,
      referenceId: options?.referenceId,
    });
    return created.id;
  }

  const full = await client.projectInventory.findUnique({ where: { id: existing.id } });
  if (!full) throw new Error('Project inventory not found');

  const physicalQty = projectPhysicalQty(full);
  const nextCost = weightedAvgCost(physicalQty, num(full.avgUnitCost), quantity, unitCost);
  const quantityIn = num(full.quantityIn) + quantity;
  const quantityBalance = computeProjectInventoryBalance({
    quantityIn,
    quantityIssued: full.quantityIssued,
    quantityReturned: full.quantityReturned,
    quantityReserved: full.quantityReserved,
  });

  await client.projectInventory.update({
    where: { id: existing.id },
    data: {
      quantityIn: dec(quantityIn),
      avgUnitCost: dec(nextCost),
      itemDescription: full.itemDescription ?? categoryName,
      quantityBalance: dec(quantityBalance),
    },
  });
  await logProjectInventoryMovement(client, {
    projectId,
    materialCategoryId,
    movementType: 'receipt',
    quantity,
    unitCost,
    referenceType: options?.referenceType,
    referenceId: options?.referenceId,
  });
  return existing.id;
}

/** Sum of quantities already returned (confirmed) for a consumption line. */
export async function getReturnedQuantityForConsumptionLine(
  client: DbClient,
  consumptionOrderLineId: number,
  excludeReturnOrderId?: number,
): Promise<number> {
  const rows = await client.returnOrderLine.findMany({
    where: {
      consumptionOrderLineId,
      returnOrder: {
        status: 'confirmed',
        ...(excludeReturnOrderId != null ? { id: { not: excludeReturnOrderId } } : {}),
      },
    },
    select: { quantity: true },
  });
  return rows.reduce((sum, r) => sum + num(r.quantity), 0);
}

/** Returnable qty for a confirmed consumption line. */
export async function getReturnableQuantityForConsumptionLine(
  client: DbClient,
  consumptionOrderLineId: number,
): Promise<{ issued: number; returned: number; returnable: number }> {
  const line = await client.consumptionOrderLine.findUnique({
    where: { id: consumptionOrderLineId },
    include: { order: { select: { status: true } } },
  });
  if (!line) throw new Error('Consumption line not found');
  if (line.order.status !== 'confirmed') {
    return { issued: 0, returned: 0, returnable: 0 };
  }
  const issued = num(line.quantity);
  const returned = await getReturnedQuantityForConsumptionLine(client, consumptionOrderLineId);
  const returnable = Math.max(0, issued - returned);
  return { issued, returned, returnable };
}

/** Return to project warehouse — increases quantity_returned. */
export async function returnProjectInventory(
  client: DbClient,
  projectId: string,
  materialCategoryId: number,
  quantity: number,
  options?: { referenceType?: string; referenceId?: string },
): Promise<void> {
  if (quantity <= EPSILON) return;
  const inv = await getProjectInventoryByMaterial(client, projectId, materialCategoryId);
  if (!inv) throw new Error('No project inventory for this material');
  const full = await client.projectInventory.findUnique({ where: { id: inv.id } });
  if (!full) throw new Error('No project inventory for this material');

  const quantityReturned = num(full.quantityReturned) + quantity;
  const quantityBalance = computeProjectInventoryBalance({
    quantityIn: full.quantityIn,
    quantityIssued: full.quantityIssued,
    quantityReturned,
    quantityReserved: full.quantityReserved,
  });

  await client.projectInventory.update({
    where: { id: inv.id },
    data: {
      quantityReturned: dec(quantityReturned),
      quantityBalance: dec(quantityBalance),
    },
  });
  await logProjectInventoryMovement(client, {
    projectId,
    materialCategoryId,
    movementType: 'return',
    quantity,
    unitCost: num(inv.avgUnitCost),
    referenceType: options?.referenceType,
    referenceId: options?.referenceId,
  });
}

/** Issue from project warehouse — validates available balance. */
export async function issueProjectInventory(
  client: DbClient,
  projectId: string,
  materialCategoryId: number,
  quantity: number,
  options?: { referenceType?: string; referenceId?: string },
): Promise<void> {
  if (quantity <= EPSILON) return;
  const inv = await getProjectInventoryByMaterial(client, projectId, materialCategoryId);
  if (!inv) throw new Error('No project inventory for this material');
  const available = getProjectAvailableQuantity(inv);
  if (quantity > available + EPSILON) {
    throw new Error(`Insufficient project warehouse balance. Available: ${available.toFixed(2)}`);
  }

  const full = await client.projectInventory.findUnique({ where: { id: inv.id } });
  if (!full) throw new Error('No project inventory for this material');

  const quantityIssued = num(full.quantityIssued) + quantity;
  const quantityBalance = computeProjectInventoryBalance({
    quantityIn: full.quantityIn,
    quantityIssued,
    quantityReturned: full.quantityReturned,
    quantityReserved: full.quantityReserved,
  });

  await client.projectInventory.update({
    where: { id: inv.id },
    data: {
      quantityIssued: dec(quantityIssued),
      quantityBalance: dec(quantityBalance),
    },
  });
  await logProjectInventoryMovement(client, {
    projectId,
    materialCategoryId,
    movementType: 'issue',
    quantity,
    unitCost: num(inv.avgUnitCost),
    referenceType: options?.referenceType,
    referenceId: options?.referenceId,
  });
}
