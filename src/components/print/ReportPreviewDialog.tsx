import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileDown, Printer, Save, SlidersHorizontal, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import { SHELL_REPORT_PREVIEW_Z } from '../../lib/shellTheme';
import {
  resolveReportPrintProfile,
  type ReportPrintId,
  type ReportPrintProfile,
  type StoredReportPrintProfiles,
} from '../../lib/reportPrintProfiles';
import { persistReportPrintProfiles } from '../../lib/reportPrintProfilesPersistence';
import { openReportDocument, renderReportDocumentHtml, type ReportDocument } from '../../lib/reportDocument';
import { ReportFormatToolbar } from '../reports/ReportFormatToolbar';

export type ReportPreviewDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Design profile slot for this document type. */
  reportId: ReportPrintId;
  /**
   * Build the printable document for the current (possibly edited) profile.
   * Return null when data is not ready — dialog shows an empty state.
   */
  buildDocument: (profile: ReportPrintProfile) => ReportDocument | null;
  language: 'ar' | 'en';
  t: (key: string) => string;
  formatMoney: (n: number) => string;
  /** Company-stored design overrides (`company_info.reportPrintProfiles`). */
  storedProfiles?: StoredReportPrintProfiles;
  /** May persist design changes for the whole company (admin / settings). */
  canSaveDesign?: boolean;
  /** Called with the merged profiles map after a successful save. */
  onProfilesSaved?: (profiles: StoredReportPrintProfiles) => void;
};

/** Neutral light tokens — the toolbar strip is always light regardless of app theme. */
const TOOLBAR_UI = {
  card: 'bg-white text-slate-900',
  borderSoft: 'border-slate-200',
  mutedText: 'text-slate-500',
  input: 'bg-white border-slate-300 text-slate-900',
  btnGhost: 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200',
};

/**
 * Unified print preview for every module: live iframe preview of the exact
 * print HTML + embedded format toolbar + print / PDF actions.
 */
export function ReportPreviewDialog({
  open,
  onClose,
  reportId,
  buildDocument,
  language,
  t,
  formatMoney,
  storedProfiles,
  canSaveDesign = false,
  onProfilesSaved,
}: ReportPreviewDialogProps) {
  const isAr = language === 'ar';
  const [profile, setProfile] = useState<ReportPrintProfile>(() =>
    resolveReportPrintProfile(storedProfiles, reportId),
  );
  const [showFormat, setShowFormat] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Re-seed the working profile each time the dialog opens (or the doc type changes).
  useEffect(() => {
    if (!open) return;
    setProfile(resolveReportPrintProfile(storedProfiles, reportId));
    setDirty(false);
    // storedProfiles intentionally read only at open time — edits live in local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reportId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const docResult = useMemo(() => {
    if (!open) return null;
    try {
      return buildDocument(profile);
    } catch (err) {
      console.error(err);
      return null;
    }
  }, [open, buildDocument, profile]);

  const previewHtml = useMemo(() => {
    if (!docResult) return '';
    try {
      return renderReportDocumentHtml(docResult, formatMoney);
    } catch (err) {
      console.error(err);
      return '';
    }
  }, [docResult, formatMoney]);

  const patchProfile = useCallback((patch: Partial<ReportPrintProfile>) => {
    setProfile((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  }, []);

  const resetProfile = useCallback(() => {
    setProfile(resolveReportPrintProfile(undefined, reportId));
    setDirty(true);
  }, [reportId]);

  const handlePrint = useCallback(() => {
    if (!docResult) return;
    void openReportDocument(docResult, 'print', formatMoney);
  }, [docResult, formatMoney]);

  const handlePdf = useCallback(async () => {
    if (!docResult || exporting) return;
    setExporting(true);
    try {
      await openReportDocument(docResult, 'pdf', formatMoney);
    } catch (err) {
      console.error(err);
      toast.error(
        isAr
          ? 'فشل تصدير PDF. تأكد أنك تستخدم تطبيق سطح المكتب أو استخدم الطباعة → حفظ PDF.'
          : 'PDF export failed. Use the desktop app, or Print → Save as PDF.',
      );
    } finally {
      setExporting(false);
    }
  }, [docResult, exporting, formatMoney, isAr]);

  const handleSaveDesign = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const next: StoredReportPrintProfiles = {
        ...(storedProfiles || {}),
        [reportId]: { ...profile },
      };
      await persistReportPrintProfiles(next);
      onProfilesSaved?.(next);
      setDirty(false);
      toast.success(t('report_fmt_saved'));
    } catch (err) {
      console.error(err);
      toast.error(t('report_fmt_save_failed'));
    } finally {
      setSaving(false);
    }
  }, [saving, storedProfiles, reportId, profile, onProfilesSaved, t]);

  if (!open) return null;

  const frameWidth = profile.orientation === 'landscape'
    ? (profile.pageSize === 'A3' ? '420mm' : '297mm')
    : (profile.pageSize === 'A3' ? '297mm' : '210mm');

  return createPortal(
    <div
      className={cn('fixed inset-0 flex flex-col bg-slate-500/95', SHELL_REPORT_PREVIEW_Z)}
      role="dialog"
      aria-modal="true"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      {/* Chrome bar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-slate-900 text-slate-100 shrink-0">
        <div className="min-w-0">
          <p className="m-0 font-bold text-sm truncate">
            {docResult?.title || t('report_print_preview_title')}
          </p>
          <p className="m-0 text-[11px] text-slate-400">
            {isAr
              ? 'معاينة مطابقة للطباعة — عدّل التنسيق ثم اطبع أو صدّر PDF'
              : 'Exact print preview — adjust the format, then print or export PDF'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 ms-auto">
          <button
            type="button"
            onClick={() => setShowFormat((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold border border-slate-600',
              showFormat ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700',
            )}
          >
            <SlidersHorizontal size={14} />
            {t('report_fmt_toolbar')}
          </button>
          {canSaveDesign ? (
            <button
              type="button"
              onClick={handleSaveDesign}
              disabled={!dirty || saving}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold',
                dirty && !saving
                  ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed',
              )}
            >
              <Save size={14} />
              {t('report_fmt_save')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={handlePdf}
            disabled={!docResult || exporting}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold bg-teal-700 text-white hover:bg-teal-600 disabled:opacity-50"
          >
            <FileDown size={14} />
            {exporting ? (isAr ? 'جاري…' : '…') : 'PDF'}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!docResult}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
          >
            <Printer size={14} />
            {t('report_print_action')}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('cancel')}
            className="inline-flex items-center justify-center rounded-lg size-8 bg-slate-800 text-slate-300 hover:bg-slate-700"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Format toolbar strip */}
      {showFormat ? (
        <div className="px-4 pt-3 bg-slate-200 shrink-0 [&>div]:mb-3" dir={isAr ? 'rtl' : 'ltr'}>
          <ReportFormatToolbar
            profile={profile}
            onChange={patchProfile}
            onReset={resetProfile}
            language={language}
            t={t}
            ui={TOOLBAR_UI}
          />
        </div>
      ) : null}

      {/* Preview viewport */}
      <div className="flex-1 min-h-0 overflow-auto p-5">
        {previewHtml ? (
          <iframe
            title={docResult?.title || 'preview'}
            srcDoc={previewHtml}
            className="block mx-auto bg-white border-0 shadow-2xl"
            style={{ width: `min(100%, ${frameWidth})`, minHeight: '80vh' }}
            onLoad={(e) => {
              // Grow to full document height so all sheets are visible in the scroll area.
              const frame = e.currentTarget;
              try {
                const d = frame.contentDocument;
                const h = d?.documentElement?.scrollHeight || d?.body?.scrollHeight || 0;
                if (h > 0) frame.style.height = `${h + 24}px`;
              } catch {
                /* ignore */
              }
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-100 text-sm font-semibold">
            {isAr ? 'لا توجد بيانات للمعاينة' : 'Nothing to preview'}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
