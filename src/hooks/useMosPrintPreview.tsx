import { useCallback, useState } from 'react';
import { ReportPreviewDialog } from '../components/print/ReportPreviewDialog';
import { useLanguage } from '../context/LanguageContext';
import { buildMosCertificateDocument } from '../lib/reportDocument';
import type { CompanyPrintInfo } from '../lib/ipcPrintData';
import type { MosPrintData } from '../lib/mosPrintData';
import type { ReportPrintProfile, StoredReportPrintProfiles } from '../lib/reportPrintProfiles';
import { mergeStoredReportPrintProfiles } from '../lib/reportPrintProfiles';

type PendingPrint = {
  data: MosPrintData;
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

/** MOS certificate print — opens the unified report preview dialog. */
export function useMosPrintPreview(
  language: 'ar' | 'en',
  formatMoney: (value: number) => string,
  _labels: PrintLabels,
) {
  const { t } = useLanguage();
  const [pending, setPending] = useState<PendingPrint | null>(null);
  const [savedProfiles, setSavedProfiles] = useState<StoredReportPrintProfiles | null>(null);

  const requestPrint = useCallback(
    (data: MosPrintData, companyInfo: CompanyPrintInfo, printReportDate: string, scopeLabel?: string) => {
      setPending({ data, companyInfo, printReportDate, scopeLabel });
    },
    [],
  );

  const buildDocument = useCallback(
    (profile: ReportPrintProfile) => {
      if (!pending) return null;
      return buildMosCertificateDocument({
        data: pending.data,
        language,
        company: pending.companyInfo,
        storedProfiles: { mos: profile },
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
      reportId="mos"
      buildDocument={buildDocument}
      language={language}
      t={t}
      formatMoney={formatMoney}
      storedProfiles={mergeStoredReportPrintProfiles(pending.companyInfo.reportPrintProfiles, savedProfiles ?? undefined)}
      onProfilesSaved={setSavedProfiles}
    />
  ) : null;

  return { requestPrint, PrintHost };
}
