/** Normalize Egyptian / international phone to E.164 (+2010…). */
export function normalizePhoneE164(raw: string): string | null {
  const trimmed = raw.trim().replace(/[\s\-()]/g, '');
  if (!trimmed) return null;

  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed;

  if (trimmed.startsWith('00')) {
    const rest = trimmed.slice(2);
    if (/^[1-9]\d{7,14}$/.test(rest)) return `+${rest}`;
  }

  // +020… typo or 01… Egyptian mobile → E.164
  if (/^\+?0?20(1\d{9})$/.test(trimmed)) {
    const m = trimmed.match(/^(?:\+?0?)?20(1\d{9})$/);
    if (m) return `+20${m[1]}`;
  }

  if (/^01\d{9}$/.test(trimmed)) return `+20${trimmed.slice(1)}`;
  if (/^1\d{9}$/.test(trimmed)) return `+20${trimmed}`;

  return null;
}

export function isValidPhoneE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}
