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
 * not from a client/device local date.
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
