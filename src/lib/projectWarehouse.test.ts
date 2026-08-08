import { describe, it, expect } from 'vitest';
import {
  isProjectWarehouseAccount,
  resolveProjectIdForWarehouse,
  resolveWarehouseAccountForProject,
  PROJECT_WAREHOUSE_PARENT,
} from './projectWarehouse';

describe('projectWarehouse', () => {
  it('recognizes 8-digit leaf accounts under 127', () => {
    expect(
      isProjectWarehouseAccount({ accountCode: '12701001', isGroup: false, status: 'active' })
    ).toBe(true);
    expect(
      isProjectWarehouseAccount({ accountCode: '12702001', isGroup: false, status: 'active' })
    ).toBe(true);
    expect(
      isProjectWarehouseAccount({ accountCode: '12701', isGroup: true, status: 'active' })
    ).toBe(false);
    expect(
      isProjectWarehouseAccount({ accountCode: '51101001', isGroup: false, status: 'active' })
    ).toBe(false);
  });

  it('resolves project from COA projectId or inventoryAccountCode', () => {
    const projects = [
      { id: 'p1', inventoryAccountCode: '12701002' },
      { id: 'p2' },
    ];
    expect(
      resolveProjectIdForWarehouse({ accountCode: '12701001', projectId: 'p9' }, projects)
    ).toBe('p9');
    expect(resolveProjectIdForWarehouse({ accountCode: '12701002' }, projects)).toBe('p1');
    expect(resolveProjectIdForWarehouse({ accountCode: '12701003' }, projects)).toBeNull();
  });

  it('uses stable parent prefix', () => {
    expect(PROJECT_WAREHOUSE_PARENT).toBe('127');
  });

  it('resolves warehouse COA from project inventoryAccountCode', () => {
    const accounts = [
      { accountCode: '12701002', isGroup: false, status: 'active' as const, accountName: 'WH B' },
    ];
    const projects = [{ id: 'p1', inventoryAccountCode: '12701002' }];
    expect(resolveWarehouseAccountForProject('p1', accounts, projects)?.accountCode).toBe('12701002');
  });
});
