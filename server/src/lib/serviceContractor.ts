/** Subcontractor service classification (still COA 21102). Mirrors src/lib/serviceContractor.ts */

export const SERVICE_KINDS = ['works', 'labour', 'equipment', 'vehicles', 'housing'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

export const SERVICE_IPC_KINDS = ['labour', 'equipment', 'vehicles', 'housing'] as const;
export type ServiceIpcKind = (typeof SERVICE_IPC_KINDS)[number];

export const SERVICE_IPC_TYPE = 'service_ipc';

export function isServiceIpcKind(value: unknown): value is ServiceIpcKind {
  return typeof value === 'string' && (SERVICE_IPC_KINDS as readonly string[]).includes(value);
}

export type ServiceIpcLine = {
  id?: string;
  contractId: string;
  projectId?: string;
  chapterCode?: string;
  chapterName?: string;
  description: string;
  unit: string;
  rate: number;
  previousQty: number;
  currentQty: number;
};

export function periodLineAmount(line: { currentQty?: number; rate?: number }): number {
  return Number(line.currentQty || 0) * Number(line.rate || 0);
}
