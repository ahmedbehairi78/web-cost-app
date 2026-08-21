import React from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Underline,
  PaintBucket,
  Square,
  Type,
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
  type PrintTableCellAlign,
  type ReportPrintProfile,
} from '../../lib/reportPrintProfiles';

export type MiniToolbarPosition = { top: number; left: number };

type ReportSelectionMiniToolbarProps = {
  profile: ReportPrintProfile;
  onChange: (patch: Partial<ReportPrintProfile>) => void;
  language: 'ar' | 'en';
  t: (key: string) => string;
  position: MiniToolbarPosition;
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
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active === true}
      onClick={onClick}
      className={cn(btnBase, active && btnActive)}
    >
      {children}
    </button>
  );
}

/**
 * Word-like floating strip for print preview selection.
 * Patches the whole report print profile (not selection-local edits).
 */
export function ReportSelectionMiniToolbar({
  profile,
  onChange,
  language,
  t,
  position,
}: ReportSelectionMiniToolbarProps) {
  const isAr = language === 'ar';
  const AlignStartIcon = isAr ? AlignRight : AlignLeft;
  const AlignEndIcon = isAr ? AlignLeft : AlignRight;

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
        // Keep iframe selection while clicking icon buttons.
        e.preventDefault();
      }}
    >
      <div className="flex flex-wrap items-center gap-1">
        <label className="inline-flex items-center gap-1" title={t('report_fmt_font')}>
          <Type size={12} className="text-slate-500 shrink-0" />
          <select
            className={selectCls}
            value={profile.fontFamily}
            onChange={(e) => onChange({ fontFamily: e.target.value as PrintFontFamily })}
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
          value={profile.bodyFontSize}
          title={t('report_fmt_mini_font_size')}
          onChange={(e) => onChange({ bodyFontSize: Number(e.target.value) as PrintBodyFontSize })}
        >
          {PRINT_BODY_FONT_SIZES.map((n) => (
            <option key={n} value={n}>
              {n === 0 ? t('report_fmt_mini_font_size_auto') : String(n)}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-0.5" title={t('report_fmt_mini_font_color')}>
          <span className="text-[10px] font-bold text-slate-500">A</span>
          <input
            type="color"
            className="size-7 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
            value={profile.bodyTextColor}
            onChange={(e) => onChange({ bodyTextColor: e.target.value })}
          />
        </label>
        <span className="w-px h-5 bg-slate-200 mx-0.5" aria-hidden />
        <ToggleBtn
          title={t('report_fmt_mini_bold')}
          active={profile.bodyBold}
          onClick={() => onChange({ bodyBold: !profile.bodyBold })}
        >
          <Bold size={14} />
        </ToggleBtn>
        <ToggleBtn
          title={t('report_fmt_mini_italic')}
          active={profile.bodyItalic}
          onClick={() => onChange({ bodyItalic: !profile.bodyItalic })}
        >
          <Italic size={14} />
        </ToggleBtn>
        <ToggleBtn
          title={t('report_fmt_mini_underline')}
          active={profile.bodyUnderline === 'single'}
          onClick={() =>
            onChange({
              bodyUnderline: profile.bodyUnderline === 'single' ? 'none' : 'single',
            })
          }
        >
          <Underline size={14} />
        </ToggleBtn>
        <ToggleBtn
          title={t('report_fmt_mini_double_underline')}
          active={profile.bodyUnderline === 'double'}
          onClick={() =>
            onChange({
              bodyUnderline: profile.bodyUnderline === 'double' ? 'none' : 'double',
            })
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
          active={profile.tableCellAlign === 'start'}
          onClick={() => onChange({ tableCellAlign: 'start' })}
        >
          <AlignStartIcon size={14} />
        </ToggleBtn>
        <ToggleBtn
          title={t('print_align_center')}
          active={profile.tableCellAlign === 'center'}
          onClick={() => onChange({ tableCellAlign: 'center' })}
        >
          <AlignCenter size={14} />
        </ToggleBtn>
        <ToggleBtn
          title={t('print_align_end')}
          active={profile.tableCellAlign === 'end'}
          onClick={() => onChange({ tableCellAlign: 'end' })}
        >
          <AlignEndIcon size={14} />
        </ToggleBtn>
        <ToggleBtn
          title={t('report_fmt_table_align_auto')}
          active={profile.tableCellAlign === 'auto'}
          onClick={() => onChange({ tableCellAlign: 'auto' as PrintTableCellAlign })}
        >
          <span className="text-[10px] font-black">A</span>
        </ToggleBtn>
        <span className="w-px h-5 bg-slate-200 mx-0.5" aria-hidden />
        <label className="inline-flex items-center gap-0.5" title={t('report_fmt_mini_shade')}>
          <PaintBucket size={14} className="text-slate-600" />
          <select
            className={cn(selectCls, 'max-w-[5.5rem]')}
            value={profile.tableShade}
            onChange={(e) => onChange({ tableShade: e.target.value })}
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
            value={profile.tableShade && /^#[0-9a-fA-F]{6}$/.test(profile.tableShade) ? profile.tableShade : '#f8fafc'}
            title={t('report_fmt_mini_shade')}
            onChange={(e) => onChange({ tableShade: e.target.value })}
          />
        </label>
        <label className="inline-flex items-center gap-0.5" title={t('report_fmt_mini_border')}>
          <Square size={14} className="text-slate-600" />
          <select
            className={cn(selectCls, 'max-w-[5.5rem]')}
            value={profile.tableBorder}
            onChange={(e) => onChange({ tableBorder: e.target.value as PrintTableBorder })}
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
