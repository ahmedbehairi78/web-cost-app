import {
  sortedBackupImportSkipped,
  totalBackupImportSkipped,
} from './backupImportSkipLabels';

export const LAST_BACKUP_IMPORT_REPORT_KEY = 'web_cost_last_backup_import_report';

export type BackupImportResultSummary = {
  savedAt: string;
  mode: 'merge' | 'replace';
  recordsProcessed: number;
  collectionsProcessed: number;
  counts: Record<string, number>;
  skipped: Record<string, number>;
  unbalancedIds: string[];
};

export function saveLastBackupImportReport(report: Omit<BackupImportResultSummary, 'savedAt'>): BackupImportResultSummary {
  const full: BackupImportResultSummary = {
    ...report,
    savedAt: new Date().toISOString(),
  };
  try {
    sessionStorage.setItem(LAST_BACKUP_IMPORT_REPORT_KEY, JSON.stringify(full));
  } catch {
    /* ignore quota / private mode */
  }
  return full;
}

export function readLastBackupImportReport(): BackupImportResultSummary | null {
  try {
    const raw = sessionStorage.getItem(LAST_BACKUP_IMPORT_REPORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BackupImportResultSummary;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
      mode: parsed.mode === 'replace' ? 'replace' : 'merge',
      recordsProcessed: Number(parsed.recordsProcessed) || 0,
      collectionsProcessed: Number(parsed.collectionsProcessed) || 0,
      counts: parsed.counts && typeof parsed.counts === 'object' ? parsed.counts : {},
      skipped: parsed.skipped && typeof parsed.skipped === 'object' ? parsed.skipped : {},
      unbalancedIds: Array.isArray(parsed.unbalancedIds) ? parsed.unbalancedIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

export function clearLastBackupImportReport(): void {
  try {
    sessionStorage.removeItem(LAST_BACKUP_IMPORT_REPORT_KEY);
  } catch {
    /* ignore */
  }
}

export function sortedBackupImportCounts(counts: Record<string, number>): Array<{ key: string; count: number }> {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export { sortedBackupImportSkipped, totalBackupImportSkipped };
