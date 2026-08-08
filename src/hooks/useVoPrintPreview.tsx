import { useCallback, useState } from 'react';
import { ReportPreviewDialog } from '../components/print/ReportPreviewDialog';
import { useLanguage } from '../context/LanguageContext';
import { buildVoCertificateDocument } from '../lib/reportDocument';
import type { CompanyPrintInfo } from '../lib/ipcPrintData';
import type { VoPrintData } from '../lib/voPrintData';
import type { ReportPrintProfile, StoredReportPrintProfiles } from '../lib/reportPrintProfiles';
import { canPersistUserPreferences } from '../lib/userPreferences';

type PendingPrint = {
  data: VoPrintData;
  companyInfo: CompanyPrintInfo;
  printReportDate: string;
  scopeLabel?: string;
};

type PrintLabels = {
  title: string;
  hint: string;
  print: string;
  cancel: string;
};

/** Variation order print — opens the unified report preview dialog. */
export function useVoPrintPreview(
  language: 'ar' | 'en',
  formatMoney: (value: number) => string,
  _labels: PrintLabels,
) {
  const { t } = useLanguage();
  const [pending, setPending] = useState<PendingPrint | null>(null);
  const [savedProfiles, setSavedProfiles] = useState<StoredReportPrintProfiles | null>(null);

  const requestPrint = useCallback(
    (
      data: VoPrintData,
      companyInfo: CompanyPrintInfo & { reportPrintProfiles?: Record<string, unknown> },
      printReportDate: string,
      scopeLabel?: string,
    ) => {
      setPending({ data, companyInfo, printReportDate, scopeLabel });
    },
    [],
  );

  const buildDocument = useCallback(
    (profile: ReportPrintProfile) => {
      if (!pending) return null;
      return buildVoCertificateDocument({
        data: pending.data,
        language,
        company: pending.companyInfo,
        storedProfiles: { variation_order: profile },
        formatMoney,
        dateLabel: pending.printReportDate,
        scopeLabel: pending.scopeLabel,
      });
    },
    [pending, language, formatMoney],
  );

  const PrintHost = pending ? (
    <ReportPreviewDialog
      open
      onClose={() => setPending(null)}
      reportId="variation_order"
      buildDocument={buildDocument}
      language={language}
      t={t}
      formatMoney={formatMoney}
      storedProfiles={savedProfiles ?? pending.companyInfo.reportPrintProfiles}
      canSaveDesign={canPersistUserPreferences()}
      onProfilesSaved={setSavedProfiles}
    />
  ) : null;

  return { requestPrint, PrintHost };
}
