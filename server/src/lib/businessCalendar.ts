/** Company operating calendar — Egypt (EGP app). Override via BUSINESS_TIMEZONE. */
export const DEFAULT_BUSINESS_TIMEZONE = 'Africa/Cairo';

export function resolveBusinessTimeZone(
  override?: string | null,
): string {
  const fromEnv = String(process.env.BUSINESS_TIMEZONE || '').trim();
  const tz = String(override || fromEnv || DEFAULT_BUSINESS_TIMEZONE).trim();
  return tz || DEFAULT_BUSINESS_TIMEZONE;
}

/**
 * Calendar "today" in the business timezone from a trusted clock (`now`),
 * not from a client/device local date or UTC `toISOString().slice(0, 10)`.
 */
export function businessTodayYmd(
  timeZone?: string | null,
  now: Date = new Date(),
): string {
  const tz = resolveBusinessTimeZone(timeZone);
  // en-CA → YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** YYYYMMDD for document numbers (CON-/WR-/PR-/…) — always Cairo calendar. */
export function businessTodayCompact(
  timeZone?: string | null,
  now: Date = new Date(),
): string {
  return businessTodayYmd(timeZone, now).replace(/-/g, '');
}

/** Format an instant as YYYY-MM-DD in the business timezone (e.g. recordedAt buckets). */
export function businessYmdFromDate(
  date: Date,
  timeZone?: string | null,
): string {
  return businessTodayYmd(timeZone, date);
}
