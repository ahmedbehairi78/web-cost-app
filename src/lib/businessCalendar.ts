/** Company operating calendar — Egypt (EGP app). Mirror of server helper for display/defaults. */
export const BUSINESS_TIMEZONE = 'Africa/Cairo';

/**
 * Calendar day in the business timezone.
 * Prefer the server `GET /api/gl/business-today` when posting — device clocks can be wrong;
 * this helper is only for UI defaults when the API is unavailable.
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
