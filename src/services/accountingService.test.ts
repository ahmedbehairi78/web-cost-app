import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDocRef = { id: 'mock-doc-ref' };
const { mockAddDoc, mockUpdateDoc, mockDoc, mockCollection } = vi.hoisted(() => ({
  mockAddDoc: vi.fn().mockResolvedValue({ id: 'new-tx-id' }),
  mockUpdateDoc: vi.fn().mockResolvedValue(undefined),
  mockDoc: vi.fn().mockReturnValue({ id: 'mock-doc-ref' }),
  mockCollection: vi.fn().mockReturnValue('mock-collection'),
}));

vi.mock('firebase/firestore', () => ({
  collection: mockCollection,
  addDoc: mockAddDoc,
  updateDoc: mockUpdateDoc,
  doc: mockDoc,
  serverTimestamp: vi.fn().mockReturnValue('SERVER_TS'),
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn(),
  getDocs: vi.fn(),
  Timestamp: class {},
}));

vi.mock('../firebase', () => ({
  db: { type: 'mock-db' },
  auth: { currentUser: { uid: 'test-user-uid' } },
}));

import { accountingService, AccountCodes } from './accountingService';

beforeEach(() => {
  vi.clearAllMocks();
  mockAddDoc.mockResolvedValue({ id: 'new-tx-id' });
  mockUpdateDoc.mockResolvedValue(undefined);
  mockDoc.mockReturnValue(mockDocRef);
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

  it('allows entries within 0.1 rounding tolerance', async () => {
    await expect(
      accountingService.createTransaction({
        date: '2024-01-01',
        description: 'Rounding',
        entries: [
          { accountCode: '1101', debit: 100.05, credit: 0 },
          { accountCode: '4100', debit: 0, credit: 100.00 },
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
    expect(payload.reference).toMatch(/^JV-\d+$/);
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
