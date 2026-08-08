/** Calendar day after YYYY-MM-DD (local). Shared by fiscal closing UI. */
export function dayAfterIsoDate(iso: string): string {
  const key = iso.trim().slice(0, 10);
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) throw new Error('Invalid date');
  const dt = new Date(y, m - 1, d + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
