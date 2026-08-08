import { describe, expect, it } from 'vitest';
import { billingFocusFromNotification, boqFocusFromNotification } from '../../src/lib/shellNavigation';

describe('billingFocusFromNotification', () => {
  it('maps MOS draft notification to billing focus', () => {
    expect(
      billingFocusFromNotification({
        type: 'mos_draft',
        entityId: 'mos-1',
        contractId: 'c-1',
        projectId: 'p-1',
      }),
    ).toEqual({
      contractId: 'c-1',
      projectId: 'p-1',
      docType: 'mos',
      entityId: 'mos-1',
    });
  });

  it('maps IPC submitted notification to billing focus', () => {
    expect(
      billingFocusFromNotification({
        type: 'billing_submitted',
        entityId: 'ipc-1',
        contractId: 'c-2',
      }),
    ).toEqual({
      contractId: 'c-2',
      projectId: undefined,
      docType: 'ipc',
      entityId: 'ipc-1',
    });
  });

  it('returns null when contractId missing', () => {
    expect(
      billingFocusFromNotification({
        type: 'billing_review',
        entityId: 'ipc-1',
      }),
    ).toBeNull();
  });
});

describe('boqFocusFromNotification', () => {
  it('maps VO submitted notification to BOQ focus', () => {
    expect(
      boqFocusFromNotification({
        type: 'vo_submitted',
        entityId: 'vo-1',
        contractId: 'c-1',
        projectId: 'p-1',
      }),
    ).toEqual({
      contractId: 'c-1',
      projectId: 'p-1',
      variationOrderId: 'vo-1',
    });
  });
});
