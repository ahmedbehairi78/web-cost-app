import { resolveHeaderLogo } from '../../lib/concordPlusBrand';
import type { CompanyPrintInfo } from '../../lib/ipcPrintData';
import { cn } from '../../lib/utils';
import type { PrintAlign } from '../../lib/reportPrintProfiles';

export type PrintHeaderContentOptions = {
  showCompany?: boolean;
  showAddress?: boolean;
  showTaxId?: boolean;
  showLogo?: boolean;
  showTitle?: boolean;
  showMeta?: boolean;
  extraText?: string;
  titleAlign?: PrintAlign;
  /**
   * Logo vs company row:
   * - `start` = logo opposite company name (classic letterhead)
   * - `end` = logo on the same side as company block
   * - `center` = logo centered above company
   */
  logoAlign?: PrintAlign;
};

interface PrintReportHeaderProps {
  companyInfo: CompanyPrintInfo;
  language: 'ar' | 'en';
  title: string;
  /** When true, letterhead is visible on screen (report page viewer), not only in print. */
  showOnScreen?: boolean;
  content?: PrintHeaderContentOptions;
  /** Optional scope / date line when content.showMeta. */
  metaLabel?: string;
  /** @deprecated Not shown in letterhead — metadata lives in report body */
  printReportDate?: string;
  /** @deprecated Not shown in letterhead — metadata lives in report body */
  scopeLabel?: string;
}

/** Shared print letterhead — logo opposite company block by default. */
export function PrintReportHeader({
  companyInfo,
  language,
  title,
  showOnScreen = false,
  content,
  metaLabel,
  printReportDate,
  scopeLabel,
}: PrintReportHeaderProps) {
  const isAr = language === 'ar';
  const showCompany = content?.showCompany !== false;
  const showAddress = content?.showAddress !== false;
  const showTaxId = content?.showTaxId !== false;
  const showLogo = content ? content.showLogo !== false : true;
  const showTitle = content?.showTitle !== false;
  const showMeta = content?.showMeta === true;
  const extraText = (content?.extraText || '').trim();
  const titleAlign = content?.titleAlign ?? 'center';
  const logoAlign = content?.logoAlign ?? 'start';
  const resolvedMeta =
    metaLabel ||
    [scopeLabel, printReportDate].filter(Boolean).join(' · ') ||
    '';

  const hasBrandText = showCompany || showAddress || (showTaxId && !!companyInfo.taxId);
  const hasBrand = hasBrandText || showLogo;

  const brandText = hasBrandText ? (
    <div className="report-print-brand-text">
      {showCompany ? (
        <p className="report-print-company">
          {isAr ? companyInfo.companyName : (companyInfo.companyNameEn || companyInfo.companyName)}
        </p>
      ) : null}
      {showAddress ? (
        <p className="report-print-meta">
          {isAr
            ? (companyInfo.address || 'القاهرة، مصر')
            : (companyInfo.addressEn || companyInfo.address || 'Cairo, Egypt')}
        </p>
      ) : null}
      {showTaxId && companyInfo.taxId ? (
        <p className="report-print-meta">
          {isAr ? 'الرقم الضريبي:' : 'Tax ID:'} {companyInfo.taxId}
        </p>
      ) : null}
    </div>
  ) : null;

  const logoSlot = showLogo ? (
    <div className="report-print-logo-slot">
      <img
        src={resolveHeaderLogo(companyInfo.headerLogo)}
        alt=""
        className="report-print-logo-img"
        referrerPolicy="no-referrer"
      />
    </div>
  ) : null;

  /** `start` = logo opposite company; `end` = logo beside company (same cluster). */
  const brandRow =
    logoAlign === 'center' ? (
      <>
        {logoSlot}
        {brandText}
      </>
    ) : logoAlign === 'end' ? (
      <>
        {logoSlot}
        {brandText || <div />}
      </>
    ) : (
      <>
        {brandText || <div />}
        {logoSlot}
      </>
    );

  return (
    <header
      className={cn(
        'report-print-header',
        showOnScreen ? 'block' : 'hidden print:block',
      )}
      data-title-align={titleAlign}
      data-logo-align={logoAlign}
      data-show-logo={showLogo ? '1' : '0'}
    >
      <div
        className="report-print-header-accent"
        aria-hidden="true"
        style={{ background: 'color-mix(in srgb, var(--report-accent, #003B71) 85%, #64748b)' }}
      />
      {hasBrand ? <div className="report-print-header-inner">{brandRow}</div> : null}
      {showTitle ? (
        <div className="report-print-header-title">
          <h1 className="report-print-report-title">{title}</h1>
        </div>
      ) : null}
      {showMeta && resolvedMeta ? (
        <p className="report-print-header-meta-line text-xs text-slate-500 mt-1">{resolvedMeta}</p>
      ) : null}
      {extraText ? (
        <p className="report-print-header-extra text-xs italic text-slate-600 mt-1">{extraText}</p>
      ) : null}
    </header>
  );
}
