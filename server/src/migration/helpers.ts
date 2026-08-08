import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

export type ImportCounts = Record<string, number>;

export function dec(n: unknown): Prisma.Decimal {
  const v = Number(n ?? 0);
  return new Prisma.Decimal(Number.isFinite(v) ? v : 0);
}

export function num(n: unknown): number {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v : 0;
}

export function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

export function nullIfEmpty(v: unknown): string | null {
  const s = str(v);
  return s || null;
}

export function bool(v: unknown, fallback = false): boolean {
  return v === true || v === 'true' || v === 1 || (fallback && v !== false && v !== 0 && v !== 'false');
}

export function parseJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((id): id is string => typeof id === 'string');
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v) as unknown;
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function makeCounter() {
  const counts: ImportCounts = {};
  const skipped: ImportCounts = {};
  const bump = (key: string, n = 1) => {
    counts[key] = (counts[key] ?? 0) + n;
  };
  const skip = (key: string, n = 1) => {
    skipped[key] = (skipped[key] ?? 0) + n;
  };
  return { counts, skipped, bump, skip };
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Human-readable unique-field hint from a Prisma P2002 error (for import logs). */
export function uniqueViolationFields(error: unknown): string {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return '';
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.map(String).join(', ');
  if (typeof target === 'string') return target;
  return '';
}

/** Keep Postgres serial sequences aligned after explicit-id imports (integer serial PK only). */
export async function resetPgSequence(tableName: string, column = 'id'): Promise<void> {
  const safeTable = tableName.replace(/"/g, '""');
  const safeColumn = column.replace(/"/g, '""');

  const seqRows = await prisma.$queryRawUnsafe<Array<{ seq: string | null }>>(
    `SELECT pg_get_serial_sequence($1, $2) AS seq`,
    `public.${safeTable}`,
    safeColumn,
  );
  const sequenceName = seqRows[0]?.seq;
  if (!sequenceName) return;

  const safeSeq = sequenceName.replace(/'/g, "''");
  await prisma.$executeRawUnsafe(
    `SELECT setval('${safeSeq}', COALESCE((SELECT MAX("${safeColumn}") FROM "${safeTable}"), 1)::bigint, true)`,
  );
}
