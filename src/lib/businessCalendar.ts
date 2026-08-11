/** Company operating calendar — Egypt (EGP app). Mirror of server helper for display/defaults. */
export const BUSINESS_TIMEZONE = 'Africa/Cairo';

/**
 * Calendar day in the business timezone (Africa/Cairo).
 * Prefer the server `GET /api/gl/business-today` when posting — device clocks can be wrong;
 * this helper is for UI defaults and client-side fallbacks (never use UTC `toISOString().slice(0, 10)`).
 */
export function businessTodayYmd(
  timeZone: string = BUSINESS_TIMEZONE,
  now: Date = new Date(),
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** YYYYMMDD for client-side labels / export filenames tied to the business day. */
export function businessTodayCompact(
  timeZone: string = BUSINESS_TIMEZONE,
  now: Date = new Date(),
): string {
  return businessTodayYmd(timeZone, now).replace(/-/g, '');
}
