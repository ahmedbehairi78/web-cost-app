import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  ReportSelectionMiniToolbar,
  type MiniToolbarPosition,
} from './ReportSelectionMiniToolbar';

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

const MINI_BAR_W = 420;
const MINI_BAR_H = 78;

function clampMiniBarPosition(top: number, left: number): MiniToolbarPosition {
  const maxLeft = Math.max(8, window.innerWidth - MINI_BAR_W - 8);
  const maxTop = Math.max(8, window.innerHeight - MINI_BAR_H - 8);
  return {
    top: Math.min(Math.max(8, top), maxTop),
    left: Math.min(Math.max(8, left), maxLeft),
  };
}

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
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const [previewObjectUrl, setPreviewObjectUrl] = useState('');
  const [miniBar, setMiniBar] = useState<MiniToolbarPosition | null>(null);
  const selectionCleanupRef = useRef<(() => void) | null>(null);

  const hideMiniBar = useCallback(() => setMiniBar(null), []);

  const closePreview = useCallback(() => {
    hideMiniBar();
    selectionCleanupRef.current?.();
    selectionCleanupRef.current = null;
    const frame = previewFrameRef.current;
    if (frame) {
      frame.removeAttribute('src');
      frame.removeAttribute('srcdoc');
    }
    onClose();
  }, [onClose, hideMiniBar]);

  // Re-seed the working profile each time the dialog opens (or the doc type changes).
  useEffect(() => {
    if (!open) return;
    setProfile(resolveReportPrintProfile(storedProfiles, reportId));
    setDirty(false);
    hideMiniBar();
    // storedProfiles intentionally read only at open time — edits live in local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reportId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (miniBar) {
        hideMiniBar();
        return;
      }
      closePreview();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, closePreview, miniBar, hideMiniBar]);

  // Rebuild clears iframe selection — hide the floating strip.
  useEffect(() => {
    hideMiniBar();
  }, [previewObjectUrl, hideMiniBar]);

  const attachSelectionListeners = useCallback(
    (frame: HTMLIFrameElement) => {
      selectionCleanupRef.current?.();
      selectionCleanupRef.current = null;
      let doc: Document | null = null;
      try {
        doc = frame.contentDocument;
      } catch {
        return;
      }
      if (!doc) return;

      const syncFromSelection = () => {
        try {
          const sel = doc!.getSelection?.() || frame.contentWindow?.getSelection();
          if (!sel || sel.isCollapsed || !sel.rangeCount) {
            hideMiniBar();
            return;
          }
          const text = sel.toString().replace(/\s+/g, ' ').trim();
          if (!text) {
            hideMiniBar();
            return;
          }
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          if (!rect || (rect.width === 0 && rect.height === 0)) {
            hideMiniBar();
            return;
          }
          const frameRect = frame.getBoundingClientRect();
          const top = frameRect.top + rect.top - MINI_BAR_H - 10;
          const left = frameRect.left + rect.left + rect.width / 2 - MINI_BAR_W / 2;
          setMiniBar(clampMiniBarPosition(top, left));
        } catch {
          hideMiniBar();
        }
      };

      const onSel = () => {
        window.requestAnimationFrame(syncFromSelection);
      };

      doc.addEventListener('selectionchange', onSel);
      doc.addEventListener('mouseup', onSel);
      doc.addEventListener('keyup', onSel);

      selectionCleanupRef.current = () => {
        doc!.removeEventListener('selectionchange', onSel);
        doc!.removeEventListener('mouseup', onSel);
        doc!.removeEventListener('keyup', onSel);
      };
    },
    [hideMiniBar],
  );

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

  // Blob URL + sandbox: unsandboxed srcDoc can navigate the Electron main frame to
  // about:blank on unmount, which retries loadURL as a cold start (login screen).
  useEffect(() => {
    if (!open || !previewHtml) {
      setPreviewObjectUrl('');
      return;
    }
    const url = URL.createObjectURL(new Blob([previewHtml], { type: 'text/html;charset=utf-8' }));
    setPreviewObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [open, previewHtml]);

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
            onClick={closePreview}
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
        {previewObjectUrl ? (
          <iframe
            ref={previewFrameRef}
            title={docResult?.title || 'preview'}
            src={previewObjectUrl}
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            className="block mx-auto bg-white border-0 shadow-2xl"
            style={{ width: `min(100%, ${frameWidth})`, minHeight: '80vh' }}
            onLoad={(e) => {
              const frame = e.currentTarget;
              try {
                const d = frame.contentDocument;
                const h = d?.documentElement?.scrollHeight || d?.body?.scrollHeight || 0;
                if (h > 0) frame.style.height = `${h + 24}px`;
              } catch {
                /* ignore */
              }
              attachSelectionListeners(frame);
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-100 text-sm font-semibold">
            {isAr ? 'لا توجد بيانات للمعاينة' : 'Nothing to preview'}
          </div>
        )}
      </div>

      {miniBar ? (
        <ReportSelectionMiniToolbar
          profile={profile}
          onChange={patchProfile}
          language={language}
          t={t}
          position={miniBar}
        />
      ) : null}
    </div>,
    document.body,
  );
}
