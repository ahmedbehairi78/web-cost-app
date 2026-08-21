import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CompanyPrintInfo } from '../lib/ipcPrintData';
import type { ReportPrintProfile, StoredReportPrintProfiles } from '../lib/reportPrintProfiles';
import { mergeStoredReportPrintProfiles } from '../lib/reportPrintProfiles';
import { buildTableReportDocument, type BuildTableDocInput } from '../lib/reportDocument';
import { canSaveCompanyPrintDesign } from '../lib/userPreferences';
import { profilesFromCompanyValue } from '../lib/reportPrintProfilesPersistence';
import { isLocalBackend } from '../lib/dataBackend';
import { settingsApi } from '../services/local/modulesApi';
import { useOptionalPermissions } from '../context/PermissionsContext';
import { ReportPreviewDialog } from '../components/print/ReportPreviewDialog';

/** Everything the consumer provides — layout comes from the live profile in the dialog. */
export type ReportDocPreviewRequest = Omit<BuildTableDocInput, 'language' | 'company' | 'storedProfiles'>;

type UseReportDocumentPreviewOptions = {
  language: 'ar' | 'en';
  t: (key: string) => string;
  formatMoney: (n: number) => string;
  companyInfo: CompanyPrintInfo;
  /** Override design-save gate (defaults to settings/reports + session). */
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
  const perms = useOptionalPermissions();

  const openDocPreview = useCallback((req: ReportDocPreviewRequest) => {
    setRequest(req);
  }, []);

  const closeDocPreview = useCallback(() => setRequest(null), []);

  useEffect(() => {
    if (!request) return;
    if (!isLocalBackend) return;
    let cancelled = false;
    void settingsApi
      .getCompanyInfo()
      .then((res) => {
        const fromServer = profilesFromCompanyValue(res.value);
        if (cancelled || Object.keys(fromServer).length === 0) return;
        setSavedProfiles((prev) => mergeStoredReportPrintProfiles(fromServer, prev ?? undefined));
      })
      .catch(() => {
        /* keep in-memory / companyInfo */
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  const storedProfiles = useMemo(
    () => mergeStoredReportPrintProfiles(companyInfo.reportPrintProfiles, savedProfiles ?? undefined),
    [companyInfo.reportPrintProfiles, savedProfiles],
  );

  const buildDocument = useCallback(
    (profile: ReportPrintProfile) => {
      if (!request) return null;
      return buildTableReportDocument({
        ...request,
        language,
        company: companyInfo,
        storedProfiles: { [request.reportId]: profile },
      });
    },
    [request, language, companyInfo],
  );

  const allowSave = canSaveDesign ?? canSaveCompanyPrintDesign(perms?.permissions);

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
