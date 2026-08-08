import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDocRef = { id: 'mock-doc-ref' };

const coaSnapAllCodes = (codes: string[]) => ({
  docs: codes.map(accountCode => ({
    id: accountCode,
    data: () => ({ accountCode, isGroup: false, status: 'active' as const }),
  })),
});

const { mockAddDoc, mockUpdateDoc, mockDoc, mockCollection, mockGetDocs } = vi.hoisted(() => ({
  mockAddDoc: vi.fn().mockResolvedValue({ id: 'new-tx-id' }),
  mockUpdateDoc: vi.fn().mockResolvedValue(undefined),
  mockDoc: vi.fn().mockReturnValue({ id: 'mock-doc-ref' }),
  mockCollection: vi.fn().mockReturnValue('mock-collection'),
  mockGetDocs: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: mockCollection,
  addDoc: mockAddDoc,
  updateDoc: mockUpdateDoc,
  doc: mockDoc,
  serverTimestamp: vi.fn().mockReturnValue('SERVER_TS'),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  getDocs: mockGetDocs,
  Timestamp: class {},
}));

vi.mock('../firebase', () => ({
  db: { type: 'mock-db' },
  auth: { currentUser: { uid: 'test-user-uid' } },
}));

import { accountingService, AccountCodes, invalidateCoaCache } from './accountingService';

beforeEach(() => {
  vi.clearAllMocks();
  invalidateCoaCache();
  mockAddDoc.mockResolvedValue({ id: 'new-tx-id' });
  mockUpdateDoc.mockResolvedValue(undefined);
  mockDoc.mockReturnValue(mockDocRef);
  const coaCodes = [
    ...new Set([
      '1101',
      '4100',
      ...(Object.values(AccountCodes) as string[]),
    ]),
  ];
  mockGetDocs.mockResolvedValue(coaSnapAllCodes(coaCodes));
});

// ─── createTransaction ────────────────────────────────────────────────────────

describe('createTransaction', () => {
  it('throws when total debit does not equal total credit', async () => {
    await expect(
      accountingService.createTransaction({
        date: '2024-01-01',
        description: 'Unbalanced',
        entries: [
          { accountCode: '1101', debit: 1000, credit: 0 },
          { accountCode: '4100', debit: 0, credit: 500 }, // off by 500
        ],
      })
    ).rejects.toThrow('not balanced');
  });

  it('allows small imbalance within rounding tolerance', async () => {
    await expect(
      accountingService.createTransaction({
        date: '2024-01-01',
        description: 'Rounding',
        entries: [
          { accountCode: '1101', debit: 100.004, credit: 0 },
          { accountCode: '4100', debit: 0, credit: 100.001 },
        ],
      })
    ).resolves.toBe('new-tx-id');
  });

  it('calls addDoc with isDeleted: false and createdBy from auth', async () => {
    await accountingService.createTransaction({
      date: '2024-01-15',
      description: 'Test JV',
      entries: [
        { accountCode: '1101', debit: 500, credit: 0 },
        { accountCode: '4100', debit: 0, credit: 500 },
      ],
    });

    expect(mockAddDoc).toHaveBeenCalledOnce();
    const payload = mockAddDoc.mock.calls[0][1];
    expect(payload.isDeleted).toBe(false);
    expect(payload.createdBy).toBe('test-user-uid');
    expect(payload.date).toBe('2024-01-15');
  });

  it('auto-generates a reference if none provided', async () => {
    await accountingService.createTransaction({
      date: '2024-01-01',
      description: 'No ref',
      entries: [
        { accountCode: '1101', debit: 100, credit: 0 },
        { accountCode: '4100', debit: 0, credit: 100 },
      ],
    });

    const payload = mockAddDoc.mock.calls[0][1];
    expect(payload.reference).toMatch(/^JV-\d+-[A-Z0-9]+$/);
  });

  it('uses provided reference', async () => {
    await accountingService.createTransaction({
      date: '2024-01-01',
      description: 'Custom ref',
      reference: 'IPC-001',
      entries: [
        { accountCode: '1101', debit: 200, credit: 0 },
        { accountCode: '4100', debit: 0, credit: 200 },
      ],
    });

    const payload = mockAddDoc.mock.calls[0][1];
    expect(payload.reference).toBe('IPC-001');
  });

  it('returns the new document id', async () => {
    const id = await accountingService.createTransaction({
      date: '2024-01-01',
      description: 'ID test',
      entries: [
        { accountCode: '1101', debit: 50, credit: 0 },
        { accountCode: '4100', debit: 0, credit: 50 },
      ],
    });

    expect(id).toBe('new-tx-id');
  });
});

// ─── recordIPC ────────────────────────────────────────────────────────────────

describe('recordIPC', () => {
  const baseParams = {
    worksValue: 100_000,
    vatAmount: 14_000,
    netPayable: 98_000,  // worksValue + vat - execGuarantee - wht - insurance - levy = 114k - 16k
    execGuarantee: 10_000,
    whtAmount: 3_000,
    labourInsurance: 1_000,
    manpowerLevy: 2_000,
    advancePaymentRecovery: 0,
    description: 'IPC No 1',
    projectId: 'proj-1',
    contractId: 'contract-1',
    date: '2024-03-01',
    contractName: 'Highway Project',
  };

  it('creates a balanced transaction', async () => {
    await accountingService.recordIPC(baseParams);

    const payload = mockAddDoc.mock.calls[0][1];
    const totalDebit = payload.entries.reduce((s: number, e: { debit: number }) => s + e.debit, 0);
    const totalCredit = payload.entries.reduce((s: number, e: { credit: number }) => s + e.credit, 0);
    expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
  });

  it('credits revenue account with worksValue', async () => {
    await accountingService.recordIPC(baseParams);

    const payload = mockAddDoc.mock.calls[0][1];
    const revenueEntry = payload.entries.find((e: { accountCode: string }) => e.accountCode === AccountCodes.REVENUE);
    expect(revenueEntry?.credit).toBe(100_000);
  });

  it('credits VAT account with vatAmount', async () => {
    await accountingService.recordIPC(baseParams);

    const payload = mockAddDoc.mock.calls[0][1];
    const vatEntry = payload.entries.find((e: { accountCode: string }) => e.accountCode === AccountCodes.VAT_OUTPUT);
    expect(vatEntry?.credit).toBe(14_000);
  });

  it('debits receivables with netPayable', async () => {
    await accountingService.recordIPC(baseParams);

    const payload = mockAddDoc.mock.calls[0][1];
    const entry = payload.entries.find((e: { accountCode: string }) => e.accountCode === AccountCodes.RECEIVABLES);
    expect(entry?.debit).toBe(98_000);
  });

  it('does NOT add advance payment entry when advancePaymentRecovery is 0', async () => {
    await accountingService.recordIPC({ ...baseParams, advancePaymentRecovery: 0 });

    const payload = mockAddDoc.mock.calls[0][1];
    const advEntry = payload.entries.find((e: { accountCode: string }) => e.accountCode === AccountCodes.ADVANCE_PAYMENT);
    expect(advEntry).toBeUndefined();
  });

  it('adds advance payment debit entry when advancePaymentRecovery > 0', async () => {
    await accountingService.recordIPC({ ...baseParams, netPayable: 93_000, advancePaymentRecovery: 5_000 });

    const payload = mockAddDoc.mock.calls[0][1];
    const advEntry = payload.entries.find((e: { accountCode: string }) => e.accountCode === AccountCodes.ADVANCE_PAYMENT);
    expect(advEntry?.debit).toBe(5_000);
  });

  it('calls updateDoc when transactionId is provided', async () => {
    await accountingService.recordIPC({ ...baseParams, transactionId: 'existing-tx-id' });

    expect(mockUpdateDoc).toHaveBeenCalledOnce();
    expect(mockAddDoc).not.toHaveBeenCalled();
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'transactions', 'existing-tx-id');
  });

  it('returns the transactionId when updating', async () => {
    const result = await accountingService.recordIPC({ ...baseParams, transactionId: 'existing-tx-id' });
    expect(result).toBe('existing-tx-id');
  });

  it('returns new doc id when creating', async () => {
    const result = await accountingService.recordIPC(baseParams);
    expect(result).toBe('new-tx-id');
  });
});

// ─── deleteTransaction ────────────────────────────────────────────────────────

describe('deleteTransaction', () => {
  it('soft-deletes by setting isDeleted: true', async () => {
    await accountingService.deleteTransaction('tx-123');

    expect(mockUpdateDoc).toHaveBeenCalledWith(mockDocRef, { isDeleted: true });
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'transactions', 'tx-123');
  });

  it('handles object with .id property', async () => {
    await accountingService.deleteTransaction({ id: 'tx-456' });

    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'transactions', 'tx-456');
  });

  it('does nothing when id is undefined', async () => {
    await accountingService.deleteTransaction(undefined);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

// ─── reverseJournalByReference / undoJournalReversalByReference ───────────────

describe('reverseJournalByReference', () => {
  it('posts inverted lines and sets reversesReference', async () => {
    const origEntries = [
      { accountCode: '1101', accountName: 'a', debit: 100, credit: 0 },
      { accountCode: '4100', accountName: 'b', debit: 0, credit: 100 },
    ];
    const coaCodes = [
      ...new Set(['1101', '4100', ...(Object.values(AccountCodes) as string[])]),
    ];
    mockGetDocs
      .mockResolvedValueOnce({
        empty: false,
        size: 1,
        docs: [
          {
            id: 'orig-id',
            data: () => ({
              reference: 'REF-ORIG',
              isDeleted: false,
              projectId: 'p1',
              costCenterId: 'c1',
              entries: origEntries,
            }),
          },
        ],
      })
      .mockResolvedValueOnce({ empty: true, size: 0, docs: [] })
      .mockResolvedValue(coaSnapAllCodes(coaCodes));

    await accountingService.reverseJournalByReference('REF-ORIG');

    expect(mockAddDoc).toHaveBeenCalledOnce();
    const payload = mockAddDoc.mock.calls[0][1];
    expect(payload.reversesReference).toBe('REF-ORIG');
    expect(payload.entries).toEqual([
      { accountCode: '1101', accountName: 'a', debit: 0, credit: 100 },
      { accountCode: '4100', accountName: 'b', debit: 100, credit: 0 },
    ]);
  });
});

describe('undoJournalReversalByReference', () => {
  it('requires a reversing entry (reversesReference)', async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'x',
          data: () => ({
            reference: 'JV-ONLY',
            isDeleted: false,
            reversesReference: '',
            projectId: 'p',
            costCenterId: 'c',
            entries: [
              { accountCode: '1101', debit: 50, credit: 0 },
              { accountCode: '4100', debit: 0, credit: 50 },
            ],
          }),
        },
      ],
    });

    await expect(accountingService.undoJournalReversalByReference('JV-ONLY')).rejects.toThrow(
      /لا يخص قيداً عكسياً|not a reversing/i,
    );
  });
});

// ─── recordExpense ────────────────────────────────────────────────────────────

describe('recordExpense', () => {
  const baseExpense = {
    amount: 5_000,
    description: 'Site materials',
    projectId: 'proj-1',
    category: 'materials' as const,
    date: '2024-02-01',
  };

  it('debits the materials expense account', async () => {
    await accountingService.recordExpense(baseExpense);

    const payload = mockAddDoc.mock.calls[0][1];
    const entry = payload.entries.find((e: { accountCode: string }) => e.accountCode === AccountCodes.EXPENSE_MATERIALS);
    expect(entry?.debit).toBe(5_000);
  });

  it('credits the bank account', async () => {
    await accountingService.recordExpense(baseExpense);

    const payload = mockAddDoc.mock.calls[0][1];
    const entry = payload.entries.find((e: { accountCode: string }) => e.accountCode === AccountCodes.BANK);
    expect(entry?.credit).toBe(5_000);
  });

  it('debits labour expense account for labour category', async () => {
    await accountingService.recordExpense({ ...baseExpense, category: 'labour' });

    const payload = mockAddDoc.mock.calls[0][1];
    const entry = payload.entries.find((e: { accountCode: string }) => e.accountCode === AccountCodes.EXPENSE_LABOUR);
    expect(entry?.debit).toBe(5_000);
  });

  it('updates existing transaction when transactionId provided', async () => {
    await accountingService.recordExpense({ ...baseExpense, transactionId: 'existing-tx' });

    expect(mockUpdateDoc).toHaveBeenCalledOnce();
    expect(mockAddDoc).not.toHaveBeenCalled();
  });
});

describe('recordPurchaseToProjectInventory', () => {
  it('debits project inventory (12701…) incl VAT without cost center', async () => {
    await accountingService.recordPurchaseToProjectInventory({
      baseAmount: 1_000_000,
      vatAmount: 140_000,
      whtAmount: 30_000,
      totalAmount: 1_110_000,
      supplierName: 'Steel Co',
      inventoryAccountCode: AccountCodes.PROJECT_INVENTORY,
      inventoryAccountName: 'مخزون مشروع',
      description: 'Purchase to warehouse',
      projectId: 'proj-1',
      date: '2024-03-01',
    });

    const payload = mockAddDoc.mock.calls[0][1];
    expect(payload.projectId).toBe('proj-1');
    expect(payload.costCenterId).toBeUndefined();
    const dr = payload.entries.find(
      (e: { accountCode: string }) => e.accountCode === AccountCodes.PROJECT_INVENTORY
    );
    expect(dr?.debit).toBe(1_140_000);
    const expense = payload.entries.find((e: { accountCode: string }) =>
      String(e.accountCode).startsWith('5')
    );
    expect(expense).toBeUndefined();
  });

  it('credits custody/cash account when supplierAccountCode is 12102…', async () => {
    await accountingService.recordPurchaseToProjectInventory({
      baseAmount: 100_000,
      vatAmount: 14_000,
      whtAmount: 0,
      totalAmount: 114_000,
      supplierName: 'عهدة نقدية',
      supplierAccountCode: AccountCodes.CASH,
      inventoryAccountCode: AccountCodes.PROJECT_INVENTORY,
      inventoryAccountName: 'مخزون مشروع',
      description: 'Cash purchase to warehouse',
      projectId: 'proj-1',
      date: '2024-03-01',
    });

    const payload = mockAddDoc.mock.calls[0][1];
    const cashCr = payload.entries.find(
      (e: { accountCode: string }) => e.accountCode === AccountCodes.CASH,
    );
    expect(cashCr?.credit).toBe(114_000);
    const supplierCr = payload.entries.find(
      (e: { accountCode: string }) => e.accountCode === AccountCodes.SUPPLIERS,
    );
    expect(supplierCr).toBeUndefined();
  });
});

describe('recordConsumptionIssue', () => {
  it('debits expense on contract and credits project inventory', async () => {
    await accountingService.recordConsumptionIssue({
      totalCost: 456_000,
      inventoryAccountCode: AccountCodes.PROJECT_INVENTORY,
      inventoryAccountName: 'مخزون مشروع',
      description: 'Issue to contract',
      projectId: 'proj-1',
      contractId: 'contract-a',
      date: '2024-03-02',
      reference: 'CON-20240302-0001',
    });

    const payload = mockAddDoc.mock.calls[0][1];
    expect(payload.projectId).toBe('proj-1');
    expect(payload.costCenterId).toBe('contract-a');
    const dr = payload.entries.find(
      (e: { accountCode: string }) => e.accountCode === AccountCodes.EXPENSE_MATERIALS
    );
    const cr = payload.entries.find(
      (e: { accountCode: string }) => e.accountCode === AccountCodes.PROJECT_INVENTORY
    );
    expect(dr?.debit).toBe(456_000);
    expect(cr?.credit).toBe(456_000);
  });

  it('uses the expense account chosen by the user', async () => {
    await accountingService.recordConsumptionIssue({
      totalCost: 12_500,
      expenseAccountCode: AccountCodes.EXPENSE_EQUIPMENT,
      expenseAccountName: 'معدات وآلات',
      inventoryAccountCode: AccountCodes.PROJECT_INVENTORY,
      inventoryAccountName: 'مخزون مشروع',
      description: 'Issue equipment',
      projectId: 'proj-1',
      contractId: 'contract-a',
      date: '2024-03-02',
      reference: 'CON-20240302-0002',
    });

    const payload = mockAddDoc.mock.calls[0][1];
    const dr = payload.entries.find(
      (e: { accountCode: string }) => e.accountCode === AccountCodes.EXPENSE_EQUIPMENT
    );
    expect(dr?.debit).toBe(12_500);
    expect(dr?.accountName).toBe('معدات وآلات');
  });
});

describe('recordProjectWarehouseTransfer', () => {
  it('debits destination warehouse and credits source warehouse', async () => {
    invalidateCoaCache();
    mockGetDocs.mockResolvedValue(
      coaSnapAllCodes([...(Object.values(AccountCodes) as string[]), '12701002']),
    );
    await accountingService.recordProjectWarehouseTransfer({
      totalCost: 100_000,
      fromInventoryAccountCode: '12701001',
      fromInventoryAccountName: 'مخزون بيل',
      toInventoryAccountCode: '12701002',
      toInventoryAccountName: 'مخزون كايرو',
      fromProjectName: 'بيل',
      toProjectName: 'كايرو',
      description: 'تحويل مخزن',
      fromProjectId: 'proj-a',
      date: '2026-05-31',
      reference: 'PTRF-20260531-0001',
    });

    const payload = mockAddDoc.mock.calls[0][1];
    expect(payload.reference).toBe('PTRF-20260531-0001');
    expect(payload.projectId).toBe('proj-a');
    const dr = payload.entries.find((e: { accountCode: string }) => e.accountCode === '12701002');
    const cr = payload.entries.find((e: { accountCode: string }) => e.accountCode === '12701001');
    expect(dr?.debit).toBe(100_000);
    expect(cr?.credit).toBe(100_000);
  });
});

describe('recordReturnToWarehouse', () => {
  it('debits project inventory and credits contract expense', async () => {
    await accountingService.recordReturnToWarehouse({
      totalCost: 57_000,
      inventoryAccountCode: AccountCodes.PROJECT_INVENTORY,
      inventoryAccountName: 'مخزون مشروع',
      description: 'Return from site',
      projectId: 'proj-1',
      contractId: 'contract-a',
      date: '2024-03-03',
      reference: 'RET-20240303-0001',
    });

    const payload = mockAddDoc.mock.calls[0][1];
    expect(payload.projectId).toBe('proj-1');
    expect(payload.costCenterId).toBe('contract-a');
    const dr = payload.entries.find(
      (e: { accountCode: string }) => e.accountCode === AccountCodes.PROJECT_INVENTORY
    );
    const cr = payload.entries.find(
      (e: { accountCode: string }) => e.accountCode === AccountCodes.EXPENSE_MATERIALS
    );
    expect(dr?.debit).toBe(57_000);
    expect(cr?.credit).toBe(57_000);
  });
});
