import { ApiError } from './apiClient';

/** Map server IPC approve validation errors to i18n toast messages. */
export function ipcApproveErrorToastMessage(
  err: unknown,
  t: (key: string) => string,
  fallbackKey = 'doc_registry_approve_failed',
): string {
  if (!(err instanceof ApiError)) return t(fallbackKey);
  const payload = err.payload as Record<string, unknown> | undefined;
  if (err.message === 'ipc_total_qty_exceeds_tender') {
    const count = Number(payload?.exceedCount ?? 1);
    return t('ipc_approve_exceeds_boq').replace('{count}', String(count));
  }
  if (err.message === 'ipc_previous_qty_below_mos_billing') {
    return t('ipc_approve_previous_qty');
  }
  if (err.message === 'ipc_line_qty_mismatch') {
    return t('ipc_approve_line_mismatch');
  }
  return t(fallbackKey);
}
