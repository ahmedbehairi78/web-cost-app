/**
 * SampleDataGeneratorPanel.tsx
 * Settings → بيانات تجريبية
 *
 * Admin-only panel for generating sample Excel files for module testing.
 * Files are generated in-memory and downloaded as blobs — nothing is stored
 * on the server or in the public/ folder.
 */

import { useState } from 'react';
import { Download, FileSpreadsheet, ChevronDown, ChevronRight, CheckSquare, Square, FlaskConical, AlertCircle } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { cn } from '../../lib/utils';
import type { AppTheme } from '../../lib/shellTheme';
import { isSoftLikeTheme, isAppTheme } from '../../lib/shellTheme';
import { SAMPLE_MODULES, type SampleModuleDef, type SampleFileSpec } from '../../lib/sampleData';

interface Props {
  theme: AppTheme | string;
}

export function SampleDataGeneratorPanel({ theme }: Props) {
  const { t, language } = useLanguage();
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  const isDark = theme === 'dark';
  const resolvedTheme: AppTheme = isAppTheme(theme) ? theme : 'soft';
  const isSoft = isSoftLikeTheme(resolvedTheme);

  // Which module cards are expanded
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['hr']));
  // Which individual file IDs are checked (default: all checked)
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(SAMPLE_MODULES.flatMap((m) => m.files.map((f) => f.id)))
  );
  // Track which files are downloading (for spinner state)
  const [downloading, setDownloading] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleFile = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleModule = (mod: SampleModuleDef) => {
    const allChecked = mod.files.every((f) => checked.has(f.id));
    setChecked((prev) => {
      const next = new Set(prev);
      mod.files.forEach((f) => (allChecked ? next.delete(f.id) : next.add(f.id)));
      return next;
    });
  };

  const downloadFile = async (file: SampleFileSpec) => {
    setDownloading((prev) => new Set(prev).add(file.id));
    try {
      file.generate();
    } finally {
      // Small delay so the button flash is visible
      setTimeout(() => setDownloading((prev) => { const n = new Set(prev); n.delete(file.id); return n; }), 600);
    }
  };

  const downloadModule = async (mod: SampleModuleDef) => {
    for (const file of mod.files.filter((f) => checked.has(f.id))) {
      await downloadFile(file);
      // Small gap between multiple downloads in same module
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  const downloadAll = async () => {
    for (const mod of SAMPLE_MODULES) {
      await downloadModule(mod);
    }
  };

  const totalChecked = SAMPLE_MODULES.flatMap((m) => m.files).filter((f) => checked.has(f.id)).length;

  const card = cn(
    'rounded-xl border transition-colors',
    isDark
      ? 'bg-gray-900/60 border-gray-700/60'
      : isSoft
        ? 'bg-white border-gray-200'
        : 'bg-white border-gray-200',
  );

  const subtle = isDark ? 'text-gray-400' : 'text-gray-500';
  const heading = isDark ? 'text-gray-100' : 'text-gray-900';
  const divider = isDark ? 'border-gray-700/50' : 'border-gray-100';

  const btnPrimary = cn(
    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
    'bg-blue-600 hover:bg-blue-700 text-white',
    'disabled:opacity-40 disabled:cursor-not-allowed',
  );
  const btnSecondary = cn(
    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all border',
    isDark
      ? 'border-gray-600 hover:bg-gray-700 text-gray-300'
      : 'border-gray-300 hover:bg-gray-50 text-gray-700',
  );

  return (
    <div dir={dir} className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 rounded-xl text-amber-500">
            <FlaskConical size={22} />
          </div>
          <div>
            <h3 className={cn('text-xl font-bold', heading)}>
              {language === 'ar' ? 'بيانات تجريبية للاختبار' : 'Sample Data for Testing'}
            </h3>
            <p className={cn('text-sm mt-0.5', subtle)}>
              {language === 'ar'
                ? 'ملفات Excel جاهزة للاستيراد في موديولات التطبيق — تُنزَّل مباشرة ولا تُخزَّن في الخادم'
                : 'Ready-to-import Excel files for app modules — downloaded directly, not stored on server'}
            </p>
          </div>
        </div>

        {/* Download all */}
        <button
          onClick={downloadAll}
          disabled={totalChecked === 0}
          className={btnPrimary}
          title={language === 'ar' ? 'تنزيل كل الملفات المحددة' : 'Download all selected files'}
        >
          <Download size={16} />
          {language === 'ar'
            ? `تنزيل الكل (${totalChecked})`
            : `Download All (${totalChecked})`}
        </button>
      </div>

      {/* Notice */}
      <div className={cn(
        'flex gap-3 p-3 rounded-lg text-sm border',
        isDark ? 'bg-amber-900/10 border-amber-700/40 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-700',
      )}>
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <span>
          {language === 'ar'
            ? 'هذه البيانات للاختبار فقط. لا تستخدمها في بيانات إنتاج فعلية. الملفات تُنتَج فورياً في المتصفح دون حفظ على الخادم.'
            : 'For testing purposes only. Do not use as real production data. Files are generated instantly in the browser with no server storage.'}
        </span>
      </div>

      {/* Module list */}
      <div className="space-y-3">
        {SAMPLE_MODULES.map((mod) => {
          const isOpen = expanded.has(mod.id);
          const modCheckedCount = mod.files.filter((f) => checked.has(f.id)).length;
          const modAllChecked = modCheckedCount === mod.files.length;
          const modSomeChecked = modCheckedCount > 0 && !modAllChecked;

          return (
            <div key={mod.id} className={card}>
              {/* Module header row — not a <button> (nested buttons are invalid HTML) */}
              <div
                className={cn('w-full flex items-center gap-3 p-4 text-start', isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50', 'rounded-xl transition-colors')}
              >
                {/* Expand chevron */}
                <button
                  type="button"
                  className={cn(subtle, 'shrink-0 p-0.5 rounded')}
                  onClick={() => toggleExpanded(mod.id)}
                  aria-expanded={isOpen}
                  title={language === 'ar' ? (isOpen ? 'طي' : 'توسيع') : (isOpen ? 'Collapse' : 'Expand')}
                >
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>

                {/* Module checkbox */}
                <button
                  type="button"
                  className={cn(mod.colorClass, 'shrink-0')}
                  onClick={() => toggleModule(mod)}
                  title={language === 'ar' ? 'تحديد / إلغاء المجموعة' : 'Select / deselect group'}
                >
                  {modAllChecked
                    ? <CheckSquare size={18} />
                    : modSomeChecked
                      ? <CheckSquare size={18} className="opacity-50" />
                      : <Square size={18} />}
                </button>

                {/* Label — click expands */}
                <button
                  type="button"
                  className="flex-1 min-w-0 text-start"
                  onClick={() => toggleExpanded(mod.id)}
                >
                  <p className={cn('font-semibold text-sm', heading)}>
                    {language === 'ar' ? mod.labelAr : mod.labelEn}
                  </p>
                  <p className={cn('text-xs mt-0.5 truncate', subtle)}>
                    {language === 'ar' ? mod.descAr : mod.descEn}
                  </p>
                </button>

                {/* Badge */}
                <span className={cn('text-xs px-2 py-0.5 rounded-full shrink-0',
                  isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600')}>
                  {modCheckedCount}/{mod.files.length}
                </span>

                {/* Download module */}
                <button
                  type="button"
                  className={cn(btnSecondary, 'shrink-0')}
                  onClick={() => void downloadModule(mod)}
                  disabled={modCheckedCount === 0}
                  title={language === 'ar' ? 'تنزيل ملفات هذا الموديول' : 'Download this module\'s files'}
                >
                  <Download size={14} />
                  {language === 'ar' ? 'تنزيل' : 'Download'}
                </button>
              </div>

              {/* File list */}
              {isOpen && (
                <div className={cn('border-t px-4 pb-3', divider)}>
                  {mod.files.map((file, idx) => (
                    <FileRow
                      key={file.id}
                      file={file}
                      isChecked={checked.has(file.id)}
                      isDownloading={downloading.has(file.id)}
                      language={language as 'ar' | 'en'}
                      isDark={isDark}
                      isLast={idx === mod.files.length - 1}
                      onToggle={() => toggleFile(file.id)}
                      onDownload={() => downloadFile(file)}
                      heading={heading}
                      subtle={subtle}
                      divider={divider}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── FileRow sub-component ─────────────────────────────────────────────────────

interface FileRowProps {
  file: SampleFileSpec;
  isChecked: boolean;
  isDownloading: boolean;
  language: 'ar' | 'en';
  isDark: boolean;
  isLast: boolean;
  onToggle: () => void;
  onDownload: () => void;
  heading: string;
  subtle: string;
  divider: string;
}

function FileRow({ file, isChecked, isDownloading, language, isDark, isLast, onToggle, onDownload, heading, subtle, divider }: FileRowProps) {
  return (
    <div className={cn('flex items-center gap-3 py-3', !isLast && `border-b ${divider}`)}>
      {/* Checkbox */}
      <button onClick={onToggle} className={cn('shrink-0', isChecked ? 'text-blue-500' : isDark ? 'text-gray-600' : 'text-gray-300')}>
        {isChecked ? <CheckSquare size={16} /> : <Square size={16} />}
      </button>

      {/* Icon */}
      <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>
        <FileSpreadsheet size={15} />
      </span>

      {/* Label + desc */}
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-medium', heading)}>
          {language === 'ar' ? file.labelAr : file.labelEn}
        </p>
        <p className={cn('text-xs mt-0.5', subtle)}>
          {language === 'ar' ? file.descAr : file.descEn}
        </p>
      </div>

      {/* Individual download button */}
      <button
        onClick={onDownload}
        disabled={isDownloading}
        className={cn(
          'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
          isDownloading
            ? isDark ? 'bg-green-900/30 border-green-700/50 text-green-400' : 'bg-green-50 border-green-300 text-green-600'
            : isDark ? 'border-gray-600 hover:bg-gray-700 text-gray-300' : 'border-gray-300 hover:bg-gray-50 text-gray-700',
        )}
      >
        <Download size={13} className={isDownloading ? 'animate-bounce' : ''} />
        {isDownloading
          ? (language === 'ar' ? 'جارٍ...' : 'Saving…')
          : (language === 'ar' ? 'تنزيل' : 'Download')}
      </button>
    </div>
  );
}
