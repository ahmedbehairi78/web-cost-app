import { useCallback, useMemo, useState } from 'react';
import type { CompanyPrintInfo } from '../lib/ipcPrintData';
import type { ReportPrintProfile, StoredReportPrintProfiles } from '../lib/reportPrintProfiles';
import { buildTableReportDocument, type BuildTableDocInput } from '../lib/reportDocument';
import { canPersistUserPreferences } from '../lib/userPreferences';
import { ReportPreviewDialog } from '../components/print/ReportPreviewDialog';

/** Everything the consumer provides — layout comes from the live profile in the dialog. */
export type ReportDocPreviewRequest = Omit<BuildTableDocInput, 'language' | 'company' | 'storedProfiles'>;

type UseReportDocumentPreviewOptions = {
  language: 'ar' | 'en';
  t: (key: string) => string;
  formatMoney: (n: number) => string;
  companyInfo: CompanyPrintInfo;
  /** Override design-save gate (defaults to session persist capability). */
  canSaveDesign?: boolean;
};

/**
 * Unified document print/preview for any module screen.
 * `openDocPreview({ reportId, title, columns, rows | sections, filename, … })`
 * opens the shared ReportPreviewDialog (live format toolbar + print + PDF).
 * Render `ReportPreviewHost` once in the component tree.
 */
export function useReportDocumentPreview({
  language,
  t,
  formatMoney,
  companyInfo,
  canSaveDesign,
}: UseReportDocumentPreviewOptions) {
  const [request, setRequest] = useState<ReportDocPreviewRequest | null>(null);
  const [savedProfiles, setSavedProfiles] = useState<StoredReportPrintProfiles | null>(null);

  const openDocPreview = useCallback((req: ReportDocPreviewRequest) => {
    setRequest(req);
  }, []);

  const closeDocPreview = useCallback(() => setRequest(null), []);

  const storedProfiles = savedProfiles ?? companyInfo.reportPrintProfiles;

  const buildDocument = useCallback(
    (profile: ReportPrintProfile) => {
      if (!request) return null;
      return buildTableReportDocument({
        ...request,
        language,
        company: companyInfo,
        // The edited profile always wins while the dialog is open.
        storedProfiles: { [request.reportId]: profile },
      });
    },
    [request, language, companyInfo],
  );

  const allowSave = canSaveDesign ?? canPersistUserPreferences();

  const ReportPreviewHost = useMemo(() => {
    if (!request) return null;
    return (
      <ReportPreviewDialog
        open
        onClose={closeDocPreview}
        reportId={request.reportId}
        buildDocument={buildDocument}
        language={language}
        t={t}
        formatMoney={formatMoney}
        storedProfiles={storedProfiles}
        canSaveDesign={allowSave}
        onProfilesSaved={setSavedProfiles}
      />
    );
  }, [request, closeDocPreview, buildDocument, language, t, formatMoney, storedProfiles, allowSave]);

  return { openDocPreview, closeDocPreview, ReportPreviewHost };
}
