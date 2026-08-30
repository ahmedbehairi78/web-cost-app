import { SERVICE_IPC_TYPE } from './serviceContractor.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the stored ref is empty or a raw UUID (not a human document number). */
export function needsServiceIpcNumber(type: unknown, referenceNumber: unknown): boolean {
  if (String(type ?? '') !== SERVICE_IPC_TYPE) return false;
  const ref = String(referenceNumber ?? '').trim();
  return !ref || UUID_RE.test(ref);
}

/** Accepts `6`, `06`, or legacy `SIPC-0006`. */
export function parseServiceIpcSeq(referenceNumber: string): number {
  const raw = String(referenceNumber || '').trim();
  const sipc = raw.match(/^SIPC-(\d+)$/i);
  if (sipc) return parseInt(sipc[1], 10);
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return 0;
}

export function formatServiceIpcNumber(seq: number): string {
  const n = Number.isFinite(seq) && seq > 0 ? Math.floor(seq) : 1;
  return String(n);
}

export function nextServiceIpcNumberFromExisting(existing: Array<string | null | undefined>): string {
  let max = 0;
  for (const raw of existing) {
    const seq = parseServiceIpcSeq(String(raw || ''));
    if (seq > max) max = seq;
  }
  return formatServiceIpcNumber(max + 1);
}
