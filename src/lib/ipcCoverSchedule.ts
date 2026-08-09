/**
 * Contract timeline fields for IPC Cover-JLL layout.
 * Uses available contract dates; missing fields still render as "—".
 */

export type IpcCoverSchedule = {
  loaDate: string;
  commencementDate: string;
  durationLabel: string;
  timeExtensionLabel: string;
  completionDate: string;
};

function dash(language: string): string {
  return '—';
}

/** Calendar days between ISO dates (inclusive span as Excel-style duration). */
export function formatContractCalendarDuration(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  language: string,
): string {
  const start = String(startDate || '').trim();
  const end = String(endDate || '').trim();
  if (!start || !end) return dash(language);
  const a = new Date(`${start}T12:00:00`);
  const b = new Date(`${end}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return dash(language);
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  if (days < 0) return dash(language);
  if (language === 'ar') return `${days} يوم تقويمي`;
  return `${days} Calendar day${days === 1 ? '' : 's'}`;
}

export function buildIpcCoverSchedule(input: {
  /** Best available: contract start (LOA signing not stored separately yet). */
  startDate?: string | null;
  endDate?: string | null;
  /** Optional explicit LOA / extension when added to contract later. */
  loaDate?: string | null;
  timeExtensionDays?: number | null;
  language: string;
}): IpcCoverSchedule {
  const start = String(input.startDate || '').trim();
  const end = String(input.endDate || '').trim();
  const loa = String(input.loaDate || '').trim() || start;
  const ext = input.timeExtensionDays;
  const timeExtensionLabel =
    ext != null && Number.isFinite(ext) && ext > 0
      ? input.language === 'ar'
        ? `${ext} يوم`
        : `${ext} day${ext === 1 ? '' : 's'}`
      : dash(input.language);

  return {
    loaDate: loa || dash(input.language),
    commencementDate: start || dash(input.language),
    durationLabel: formatContractCalendarDuration(start, end, input.language),
    timeExtensionLabel,
    completionDate: end || dash(input.language),
  };
}
