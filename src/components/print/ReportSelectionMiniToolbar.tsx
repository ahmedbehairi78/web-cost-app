import React, { useMemo, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Underline,
  PaintBucket,
  Paintbrush,
  Square,
  Type,
  Undo2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  PRINT_BODY_FONT_SIZES,
  PRINT_FONT_FAMILIES,
  PRINT_TABLE_BORDERS,
  PRINT_TABLE_SHADE_PRESETS,
  type PrintBodyFontSize,
  type PrintFontFamily,
  type PrintTableBorder,
} from '../../lib/reportPrintProfiles';
import {
  applySelectionAlign,
  applySelectionBorder,
  applySelectionColor,
  applySelectionFontFamily,
  applySelectionFontSize,
  applySelectionShade,
  applySelectionUnderline,
  canSelectionUndo,
  hasNonEmptySelection,
  readSelectionFormatState,
  toggleSelectionBold,
  toggleSelectionItalic,
  undoSelectionFormat,
  type FormatPainterClipboard,
  type SelectionAlign,
  type SelectionUnderline,
} from '../../lib/reportDocument/selectionFormat';

export type MiniToolbarPosition = { top: number; left: number };

type ReportSelectionMiniToolbarProps = {
  /** Live preview iframe document (designMode). */
  previewDoc: Document;
  textDir: 'rtl' | 'ltr';
  language: 'ar' | 'en';
  t: (key: string) => string;
  position: MiniToolbarPosition;
  /** Called after a successful format / undo so parent can mark HTML dirty. */
  onFormatted: () => void;
  formatPainterArmed: boolean;
  onFormatPainterArmedChange: (armed: boolean, clipboard: FormatPainterClipboard | null) => void;
};

const btnBase =
  'inline-flex items-center justify-center size-7 rounded border border-transparent text-slate-700 hover:bg-slate-100 disabled:opacity-40';
const btnActive = 'bg-slate-200 border-slate-300';
const selectCls =
  'h-7 max-w-[7.5rem] rounded border border-slate-300 bg-white px-1 text-[11px] font-semibold text-slate-800';

function ToggleBtn({
  active,
  title,
  onClick,
  disabled,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active === true}
      disabled={disabled}
      onClick={onClick}
      className={cn(btnBase, active && btnActive)}
    >
      {children}
    </button>
  );
}

/**
 * Word-like floating strip for print preview selection.
 * Formats only the selected text / nearest cell — not the whole report profile.
 */
export function ReportSelectionMiniToolbar({
  previewDoc,
  textDir,
  language,
  t,
  position,
  onFormatted,
  formatPainterArmed,
  onFormatPainterArmedChange,
}: ReportSelectionMiniToolbarProps) {
  const isAr = language === 'ar';
  const AlignStartIcon = isAr ? AlignRight : AlignLeft;
  const AlignEndIcon = isAr ? AlignLeft : AlignRight;
  const [tick, setTick] = useState(0);

  const state = useMemo(() => readSelectionFormatState(previewDoc), [previewDoc, tick]);
  const undoReady = useMemo(() => canSelectionUndo(previewDoc), [previewDoc, tick]);

  const refresh = () => {
    setTick((n) => n + 1);
    onFormatted();
  };

  const run = (fn: () => boolean) => {
    if (fn()) refresh();
  };

  const handleFormatPainter = () => {
    if (formatPainterArmed) {
      // Second click on the brush cancels paint mode (Word-like).
      onFormatPainterArmedChange(false, null);
      return;
    }
    if (!hasNonEmptySelection(previewDoc)) return;
    const clip = readSelectionFormatState(previewDoc);
    onFormatPainterArmedChange(true, clip);
  };

  const fontValue = state.fontFamily ?? 'calibri';
  const sizeValue = (state.fontSizePt &&
  PRINT_BODY_FONT_SIZES.includes(state.fontSizePt as PrintBodyFontSize)
    ? state.fontSizePt
    : 11) as PrintBodyFontSize;
  const colorValue = state.color && /^#[0-9a-fA-F]{6}$/.test(state.color) ? state.color : '#0f172a';
  const shadeValue = state.shade && /^#[0-9a-fA-F]{6}$/.test(state.shade) ? state.shade : '';

  return (
    <div
      role="toolbar"
      aria-label={t('report_fmt_mini_toolbar')}
      dir={isAr ? 'rtl' : 'ltr'}
      className="fixed z-[10200] flex flex-col gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 shadow-xl"
      style={{
        top: Math.max(8, position.top),
        left: Math.max(8, position.left),
      }}
      onMouseDown={(e) => {
        const el = e.target as HTMLElement | null;
        if (el?.closest('select, input, textarea, option')) return;
        e.preventDefault();
      }}
    >
      <div className="flex flex-wrap items-center gap-1">
        <ToggleBtn
          title={t('report_fmt_mini_undo')}
          disabled={!undoReady}
          onClick={() => {
            if (undoSelectionFormat(previewDoc)) refresh();
          }}
        >
          <Undo2 size={14} />
        </ToggleBtn>
        <ToggleBtn
          title={
            formatPainterArmed
              ? t('report_fmt_mini_format_painter_armed')
              : t('report_fmt_mini_format_painter')
          }
          active={formatPainterArmed}
          onClick={handleFormatPainter}
        >
          <Paintbrush size={14} />
        </ToggleBtn>
        <span className="w-px h-5 bg-slate-200 mx-0.5" aria-hidden />
        <label className="inline-flex items-center gap-1" title={t('report_fmt_font')}>
          <Type size={12} className="text-slate-500 shrink-0" />
          <select
            className={selectCls}
            value={fontValue}
            onChange={(e) =>
              run(() => applySelectionFontFamily(previewDoc, e.target.value as PrintFontFamily))
            }
          >
            {PRINT_FONT_FAMILIES.map((f) => (
              <option key={f} value={f}>
                {f === 'calibri'
                  ? 'Calibri'
                  : f === 'segoe'
                    ? 'Segoe UI'
                    : f === 'tahoma'
                      ? 'Tahoma'
                      : 'Arial'}
              </option>
            ))}
          </select>
        </label>
        <select
          className={cn(selectCls, 'max-w-[4.5rem]')}
          value={sizeValue}
          title={t('report_fmt_mini_font_size')}
          onChange={(e) => {
            const n = Number(e.target.value) as PrintBodyFontSize;
            if (n === 0) return;
            run(() => applySelectionFontSize(previewDoc, n));
          }}
        >
          {PRINT_BODY_FONT_SIZES.filter((n) => n > 0).map((n) => (
            <option key={n} value={n}>
              {String(n)}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-0.5" title={t('report_fmt_mini_font_color')}>
          <span className="text-[10px] font-bold text-slate-500">A</span>
          <input
            type="color"
            className="size-7 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
            value={colorValue}
            onChange={(e) => run(() => applySelectionColor(previewDoc, e.target.value))}
          />
        </label>
        <span className="w-px h-5 bg-slate-200 mx-0.5" aria-hidden />
        <ToggleBtn
          title={t('report_fmt_mini_bold')}
          active={state.bold}
          onClick={() => run(() => toggleSelectionBold(previewDoc))}
        >
          <Bold size={14} />
        </ToggleBtn>
        <ToggleBtn
          title={t('report_fmt_mini_italic')}
          active={state.italic}
          onClick={() => run(() => toggleSelectionItalic(previewDoc))}
        >
          <Italic size={14} />
        </ToggleBtn>
        <ToggleBtn
          title={t('report_fmt_mini_underline')}
          active={state.underline === 'single'}
          onClick={() =>
            run(() =>
              applySelectionUnderline(
                previewDoc,
                state.underline === 'single' ? 'none' : 'single',
              ),
            )
          }
        >
          <Underline size={14} />
        </ToggleBtn>
        <ToggleBtn
          title={t('report_fmt_mini_double_underline')}
          active={state.underline === 'double'}
          onClick={() =>
            run(() =>
              applySelectionUnderline(
                previewDoc,
                (state.underline === 'double' ? 'none' : 'double') as SelectionUnderline,
              ),
            )
          }
        >
          <span className="relative inline-flex flex-col items-center leading-none">
            <Underline size={14} />
            <span className="absolute bottom-0 left-0.5 right-0.5 border-b border-current" />
          </span>
        </ToggleBtn>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <ToggleBtn
          title={t('print_align_start')}
          active={state.align === 'start'}
          onClick={() => run(() => applySelectionAlign(previewDoc, 'start' as SelectionAlign, textDir))}
        >
          <AlignStartIcon size={14} />
        </ToggleBtn>
        <ToggleBtn
          title={t('print_align_center')}
          active={state.align === 'center'}
          onClick={() => run(() => applySelectionAlign(previewDoc, 'center', textDir))}
        >
          <AlignCenter size={14} />
        </ToggleBtn>
        <ToggleBtn
          title={t('print_align_end')}
          active={state.align === 'end'}
          onClick={() => run(() => applySelectionAlign(previewDoc, 'end', textDir))}
        >
          <AlignEndIcon size={14} />
        </ToggleBtn>
        <span className="w-px h-5 bg-slate-200 mx-0.5" aria-hidden />
        <label className="inline-flex items-center gap-0.5" title={t('report_fmt_mini_shade')}>
          <PaintBucket size={14} className="text-slate-600" />
          <select
            className={cn(selectCls, 'max-w-[5.5rem]')}
            value={shadeValue}
            onChange={(e) => run(() => applySelectionShade(previewDoc, e.target.value))}
          >
            {PRINT_TABLE_SHADE_PRESETS.map((c) => (
              <option key={c || 'none'} value={c}>
                {c === '' ? t('report_fmt_mini_shade_none') : c}
              </option>
            ))}
          </select>
          <input
            type="color"
            className="size-7 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
            value={shadeValue || '#fef9c3'}
            title={t('report_fmt_mini_shade')}
            onChange={(e) => run(() => applySelectionShade(previewDoc, e.target.value))}
          />
        </label>
        <label className="inline-flex items-center gap-0.5" title={t('report_fmt_mini_border')}>
          <Square size={14} className="text-slate-600" />
          <select
            className={cn(selectCls, 'max-w-[5.5rem]')}
            defaultValue="light"
            onChange={(e) =>
              run(() => applySelectionBorder(previewDoc, e.target.value as PrintTableBorder))
            }
          >
            {PRINT_TABLE_BORDERS.map((b) => (
              <option key={b} value={b}>
                {t(`report_fmt_mini_border_${b}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
