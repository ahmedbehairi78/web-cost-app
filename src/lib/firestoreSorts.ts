function compareText(a: unknown, b: unknown) {
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function getDateValue(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

export function sortByTextField<T extends object>(items: T[], field: string) {
  return [...items].sort((a, b) =>
    compareText(
      (a as Record<string, unknown>)[field],
      (b as Record<string, unknown>)[field]
    )
  );
}

export function sortByDateFieldDesc<T extends object>(items: T[], field: string) {
  return [...items].sort((a, b) =>
    getDateValue((b as Record<string, unknown>)[field]) -
    getDateValue((a as Record<string, unknown>)[field])
  );
}
