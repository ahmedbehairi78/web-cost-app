import React from 'react';
import { RotateCcw } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  PRINT_EXTRA_TEXT_MAX,
  PRINT_FIT_PAGE_COUNTS,
  type PrintAlign,
  type PrintFitPageCount,
  type PrintFontFamily,
  type PrintMarginPreset,
  type PrintOrientation,
  type PrintTableCellAlign,
  type PrintTextDirection,
  type ReportPrintProfile,
} from '../../lib/reportPrintProfiles';

type ReportFormatToolbarProps = {
  profile: ReportPrintProfile;
  onChange: (patch: Partial<ReportPrintProfile>) => void;
  onReset: () => void;
  language: 'ar' | 'en';
  t: (key: string) => string;
  ui: {
    card: string;
    borderSoft: string;
    mutedText: string;
    input: string;
    btnGhost: string;
  };
};

const selectCls =
  'rounded border px-1.5 py-0.5 text-[11px] font-semibold bg-transparent min-w-0 h-7';

function TinyToggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer select-none whitespace-nowrap',
        disabled && 'opacity-40 pointer-events-none',
      )}
      title={label}
    >
      <input
        type="checkbox"
        className="rounded size-3.5"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function SectionTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn('text-[10px] font-bold uppercase tracking-wide leading-none mb-1', className)}>
      {children}
    </p>
  );
}

export function ReportFormatToolbar({
  profile,
  onChange,
  onReset,
  language,
  t,
  ui,
}: ReportFormatToolbarProps) {
  const isAr = language === 'ar';

  return (
    <div
      className={cn(
        'print:hidden grid grid-cols-1 lg:grid-cols-3 gap-2 px-2.5 py-2 rounded-xl border mb-4',
        ui.card,
        ui.borderSoft,
      )}
      role="toolbar"
      aria-label={t('report_fmt_toolbar')}
    >
      {/* 1 — Page / format */}
      <section className={cn('rounded-lg border px-2 py-1.5 min-w-0', ui.borderSoft)}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <SectionTitle className={ui.mutedText}>{t('report_fmt_toolbar')}</SectionTitle>
          <button
            type="button"
            onClick={onReset}
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold border shrink-0',
              ui.btnGhost,
            )}
            title={t('report_fmt_reset')}
          >
            <RotateCcw size={12} />
            {t('report_fmt_reset')}
          </button>
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-x-1.5 gap-y-1">
          <label className="flex flex-col gap-0.5 min-w-0">
            <span className={cn('text-[9px] font-bold uppercase', ui.mutedText)}>{t('report_fmt_font')}</span>
            <select
              className={cn(selectCls, ui.input, 'w-full')}
              value={profile.fontFamily}
              onChange={(e) => onChange({ fontFamily: e.target.value as PrintFontFamily })}
            >
              <option value="calibri">Calibri</option>
              <option value="segoe">Segoe UI</option>
              <option value="tahoma">Tahoma</option>
              <option value="arial">Arial</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5 min-w-0">
            <span className={cn('text-[9px] font-bold uppercase', ui.mutedText)}>{t('report_fmt_page_dir')}</span>
            <select
              className={cn(selectCls, ui.input, 'w-full')}
              value={profile.orientation}
              onChange={(e) => onChange({ orientation: e.target.value as PrintOrientation })}
            >
              <option value="portrait">{t('print_portrait')}</option>
              <option value="landscape">{t('print_landscape')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5 min-w-0">
            <span className={cn('text-[9px] font-bold uppercase', ui.mutedText)}>{t('report_fmt_text_dir')}</span>
            <select
              className={cn(selectCls, ui.input, 'w-full')}
              value={profile.textDirection}
              onChange={(e) => onChange({ textDirection: e.target.value as PrintTextDirection })}
            >
              <option value="auto">{t('report_fmt_dir_auto')}</option>
              <option value="rtl">{isAr ? 'RTL' : 'RTL'}</option>
              <option value="ltr">{isAr ? 'LTR' : 'LTR'}</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5 min-w-0">
            <span className={cn('text-[9px] font-bold uppercase', ui.mutedText)}>{t('report_fmt_align')}</span>
            <select
              className={cn(selectCls, ui.input, 'w-full')}
              value={profile.titleAlign}
              onChange={(e) => onChange({ titleAlign: e.target.value as PrintAlign })}
            >
              <option value="start">{t('print_align_start')}</option>
              <option value="center">{t('print_align_center')}</option>
              <option value="end">{t('print_align_end')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5 min-w-0">
            <span className={cn('text-[9px] font-bold uppercase', ui.mutedText)}>{t('report_fmt_table_align')}</span>
            <select
              className={cn(selectCls, ui.input, 'w-full')}
              value={profile.tableCellAlign}
              title={t('report_fmt_table_align_hint')}
              onChange={(e) => onChange({ tableCellAlign: e.target.value as PrintTableCellAlign })}
            >
              <option value="auto">{t('report_fmt_table_align_auto')}</option>
              <option value="start">{t('print_align_start')}</option>
              <option value="center">{t('print_align_center')}</option>
              <option value="end">{t('print_align_end')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5 min-w-0">
            <span className={cn('text-[9px] font-bold uppercase', ui.mutedText)}>{t('report_fmt_margin')}</span>
            <select
              className={cn(selectCls, ui.input, 'w-full')}
              value={profile.marginPreset}
              onChange={(e) => onChange({ marginPreset: e.target.value as PrintMarginPreset })}
            >
              <option value="narrow">{t('report_fmt_margin_narrow')}</option>
              <option value="normal">{t('report_fmt_margin_normal')}</option>
              <option value="wide">{t('report_fmt_margin_wide')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5 min-w-0 col-span-2 xl:col-span-1">
            <span className={cn('text-[9px] font-bold uppercase', ui.mutedText)}>{t('report_fmt_fit_pages')}</span>
            <select
              className={cn(selectCls, ui.input, 'w-full')}
              value={profile.fitPageCount}
              title={t('report_fmt_fit_pages_hint')}
              onChange={(e) =>
                onChange({ fitPageCount: Number(e.target.value) as PrintFitPageCount })
              }
            >
              {PRINT_FIT_PAGE_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? t('report_fmt_fit_pages_auto') : String(n)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* 2 — Header */}
      <section
        className={cn(
          'rounded-lg border px-2 py-1.5 min-w-0',
          ui.borderSoft,
          !profile.showHeader && 'opacity-70',
        )}
      >
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <TinyToggle
            label={t('report_fmt_header')}
            checked={profile.showHeader}
            onChange={(v) => onChange({ showHeader: v })}
          />
          <TinyToggle
            label={t('report_fmt_hf_logo_show')}
            checked={profile.showLogo}
            disabled={!profile.showHeader}
            onChange={(v) => onChange({ showLogo: v })}
          />
          <select
            className={cn(selectCls, ui.input, 'ms-auto max-w-[9rem]')}
            value={profile.logoAlign}
            disabled={!profile.showHeader || !profile.showLogo}
            title={t('report_fmt_hf_logo_side')}
            onChange={(e) => onChange({ logoAlign: e.target.value as PrintAlign })}
          >
            <option value="start">{t('report_fmt_hf_logo_opposite')}</option>
            <option value="end">{t('report_fmt_hf_logo_same_side')}</option>
            <option value="center">{t('report_fmt_hf_logo_center')}</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 mb-1">
          <TinyToggle
            label={t('report_fmt_hf_company')}
            checked={profile.headerShowCompany}
            disabled={!profile.showHeader}
            onChange={(v) => onChange({ headerShowCompany: v })}
          />
          <TinyToggle
            label={t('report_fmt_hf_address')}
            checked={profile.headerShowAddress}
            disabled={!profile.showHeader}
            onChange={(v) => onChange({ headerShowAddress: v })}
          />
          <TinyToggle
            label={t('report_fmt_hf_tax')}
            checked={profile.headerShowTaxId}
            disabled={!profile.showHeader}
            onChange={(v) => onChange({ headerShowTaxId: v })}
          />
          <TinyToggle
            label={t('report_fmt_hf_title')}
            checked={profile.headerShowTitle}
            disabled={!profile.showHeader}
            onChange={(v) => onChange({ headerShowTitle: v })}
          />
          <TinyToggle
            label={t('report_fmt_hf_meta')}
            checked={profile.headerShowMeta}
            disabled={!profile.showHeader}
            onChange={(v) => onChange({ headerShowMeta: v })}
          />
        </div>
        <input
          type="text"
          className={cn(selectCls, ui.input, 'w-full max-w-none')}
          value={profile.headerExtraText}
          maxLength={PRINT_EXTRA_TEXT_MAX}
          disabled={!profile.showHeader}
          placeholder={t('report_fmt_hf_header_extra')}
          onChange={(e) => onChange({ headerExtraText: e.target.value })}
        />
      </section>

      {/* 3 — Footer */}
      <section
        className={cn(
          'rounded-lg border px-2 py-1.5 min-w-0',
          ui.borderSoft,
          !profile.showFooter && 'opacity-70',
        )}
      >
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <TinyToggle
            label={t('report_fmt_footer')}
            checked={profile.showFooter}
            onChange={(v) => onChange({ showFooter: v })}
          />
          <select
            className={cn(selectCls, ui.input, 'ms-auto max-w-[7rem]')}
            value={profile.footerAlign}
            disabled={!profile.showFooter}
            title={t('report_fmt_hf_footer_align')}
            onChange={(e) => onChange({ footerAlign: e.target.value as PrintAlign })}
          >
            <option value="start">{t('print_align_start')}</option>
            <option value="center">{t('print_align_center')}</option>
            <option value="end">{t('print_align_end')}</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 mb-1">
          <TinyToggle
            label={t('report_fmt_hf_company')}
            checked={profile.footerShowCompany}
            disabled={!profile.showFooter}
            onChange={(v) => onChange({ footerShowCompany: v })}
          />
          <TinyToggle
            label={t('report_fmt_hf_footer_text')}
            checked={profile.footerShowText}
            disabled={!profile.showFooter}
            onChange={(v) => onChange({ footerShowText: v })}
          />
          <TinyToggle
            label={t('report_fmt_hf_note')}
            checked={profile.footerShowNote}
            disabled={!profile.showFooter}
            onChange={(v) => onChange({ footerShowNote: v })}
          />
          <TinyToggle
            label={t('report_fmt_hf_page')}
            checked={profile.footerShowPageNum}
            disabled={!profile.showFooter}
            onChange={(v) => onChange({ footerShowPageNum: v })}
          />
        </div>
        <input
          type="text"
          className={cn(selectCls, ui.input, 'w-full max-w-none')}
          value={profile.footerExtraText}
          maxLength={PRINT_EXTRA_TEXT_MAX}
          disabled={!profile.showFooter}
          placeholder={t('report_fmt_hf_footer_extra')}
          onChange={(e) => onChange({ footerExtraText: e.target.value })}
        />
      </section>
    </div>
  );
}
