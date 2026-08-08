import { Prisma } from '@prisma/client';

/**
 * Recursively converts a Prisma query result into a JSON-friendly shape that
 * matches what the frontend used to receive from the SQLite backend:
 *  - `Prisma.Decimal` → `number` (frontend does arithmetic on these).
 *  - `Date` → ISO string (frontend reads dates via `normalizeDate`).
 *  - `bigint` → `number`.
 * Everything else (booleans, parsed JSON columns, plain objects/arrays) passes
 * through unchanged. Always run results through this before `res.json(...)`.
 */
export function serialize<T>(value: T): unknown {
  if (value === null || value === undefined) return value;

  if (Prisma.Decimal.isDecimal(value as object)) {
    return (value as unknown as Prisma.Decimal).toNumber();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return Number(value);

  if (Array.isArray(value)) return value.map((v) => serialize(v));

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serialize(v);
    }
    return out;
  }

  return value;
}
