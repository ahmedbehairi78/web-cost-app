import { useCallback, useState } from 'react';
import { ReportPreviewDialog } from '../components/print/ReportPreviewDialog';
import { useLanguage } from '../context/LanguageContext';
import { buildIpcCertificateDocument } from '../lib/reportDocument';
import type { CompanyPrintInfo, IpcPrintData } from '../lib/ipcPrintData';
import type { IpcPrintProfileId, ReportPrintProfile, StoredReportPrintProfiles } from '../lib/reportPrintProfiles';
import { canPersistUserPreferences } from '../lib/userPreferences';

type PendingPrint = {
  data: IpcPrintData;
  printId: IpcPrintProfileId;
  companyInfo: CompanyPrintInfo;
  printReportDate: string;
  scopeLabel?: string;
  /** Cover sheet only (single A4 portrait) — no quantities. */
  coverOnly?: boolean;
};

type PrintLabels = {
  title: string;
  hint: string;
  print: string;
  cancel: string;
};

export type IpcPrintRequestOptions = {
  coverOnly?: boolean;
};

/** IPC certificate print — opens the unified report preview dialog. */
export function useIpcPrintPreview(
  language: 'ar' | 'en',
  formatMoney: (value: number) => string,
  _labels: PrintLabels,
) {
  const { t } = useLanguage();
  const [pending, setPending] = useState<PendingPrint | null>(null);
  const [savedProfiles, setSavedProfiles] = useState<StoredReportPrintProfiles | null>(null);

  const requestPrint = useCallback(
    (
      data: IpcPrintData,
      printId: IpcPrintProfileId,
      companyInfo: CompanyPrintInfo,
      printReportDate: string,
      scopeLabel?: string,
      options?: IpcPrintRequestOptions,
    ) => {
      setPending({
        data,
        printId,
        companyInfo,
        printReportDate,
        scopeLabel,
        coverOnly: options?.coverOnly === true,
      });
    },
    [],
  );

  const buildDocument = useCallback(
    (profile: ReportPrintProfile) => {
      if (!pending) return null;
      return buildIpcCertificateDocument({
        data: pending.data,
        printId: pending.printId,
        language,
        company: pending.companyInfo,
        storedProfiles: { [pending.printId]: profile },
        formatMoney,
        dateLabel: pending.printReportDate,
        scopeLabel: pending.scopeLabel,
        coverOnly: pending.coverOnly,
      });
    },
    [pending, language, formatMoney],
  );

  const PrintHost = pending ? (
    <ReportPreviewDialog
      open
      onClose={() => setPending(null)}
      reportId={pending.printId}
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
