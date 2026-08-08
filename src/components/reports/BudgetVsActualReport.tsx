import React, { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, Layers } from 'lucide-react';
import { cn, listKey } from '../../lib/utils';
import { resolveHeaderLogo } from '../../lib/concordPlusBrand';
import type { CompanyPrintInfo } from '../../lib/ipcPrintData';
import type { ReportPrintProfile } from '../../lib/reportPrintProfiles';
import {
  buildBudgetVsActualRows,
  budgetVsActualRowsPerPage,
  chunkBudgetVsActualPages,
  sumBudgetVsActualRows,
  type ActualCostMap,
  type BudgetDetailLevel,
  type BudgetVsActualBoqItem,
  type BudgetVsActualContract,
  type BudgetVsActualProject,
  type BudgetVsActualRow,
} from '../../lib/budgetVsActual';
import { SearchableSelect } from '../ui/SearchableSelect';

type UiTokens = {
  borderSoft: string;
  borderSubtle: string;
  divider: string;
  rowHover: string;
  headRow: string;
  mutedText: string;
  subtleText: string;
  input: string;
};

export type BudgetVsActualReportProps = {
  level: BudgetDetailLevel;
  onLevelChange: (level: BudgetDetailLevel) => void;
  projects: BudgetVsActualProject[];
  contracts: BudgetVsActualContract[];
  boqItems: BudgetVsActualBoqItem[];
  actualByKey: ActualCostMap;
  selectedProjectId: string;
  selectedContractId: string;
  theme: string;
  language: 'ar' | 'en';
  dir: string;
  formatMoney: (n: number) => string;
  ui: UiTokens;
  /** Optional scope line shown on each A4 sheet (project / contract filter). */
  scopeLabel?: string;
  printDate?: string;
  companyInfo?: CompanyPrintInfo;
  printProfile?: ReportPrintProfile;
};

function statusLabel(row: BudgetVsActualRow, language: 'ar' | 'en') {
  if (Math.abs(row.variance) < 0.005) {
    return language === 'ar' ? 'مطابق' : 'On budget';
  }
  return row.variance >= 0
    ? language === 'ar'
      ? 'تحت'
      : 'Under'
    : language === 'ar'
      ? 'تجاوز'
      : 'Over';
}

/** Money cell: LTR + tabular nums for decimal alignment; side follows UI language. */
function MoneyCell({
  value,
  formatMoney,
  isAr,
  className,
}: {
  value: number;
  formatMoney: (n: number) => string;
  isAr: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        'px-3.5 py-3 font-mono text-[13px] sm:text-[14px]',
        isAr ? 'text-start' : 'text-end',
        className,
      )}
    >
      <span dir="ltr" className="inline-block tabular-nums text-right min-w-[4.5em]">
        {formatMoney(value)}
      </span>
    </td>
  );
}

function TableHead({
  entityCol,
  level,
  showVo,
  isAr,
}: {
  entityCol: string;
  level: BudgetDetailLevel;
  showVo: boolean;
  isAr: boolean;
}) {
  const th =
    'px-3.5 py-3 text-[12px] sm:text-[13px] font-bold tracking-wide border-b-2 border-amber-700/40';
  const entityWidth =
    level === 'boq_item' ? 'w-[32%] min-w-0' : level === 'contract' ? 'w-[20%] min-w-0' : 'w-[18%] min-w-0';
  const moneyTh = cn(th, 'whitespace-nowrap', isAr ? 'text-start' : 'text-end');
  return (
    <thead>
      <tr className="bg-amber-50 text-slate-800">
        <th className={cn(th, 'text-start', entityWidth)}>{entityCol}</th>
        {level !== 'project' && (
          <th className={cn(th, 'text-start min-w-0', level === 'boq_item' ? 'w-[14%]' : 'w-[12%]')}>
            {isAr ? 'المرجع' : 'Ref.'}
          </th>
        )}
        <th className={moneyTh}>{isAr ? 'بيع BOQ' : 'BOQ sell'}</th>
        <th className={moneyTh}>{isAr ? 'تكلفة تقديرية' : 'Est. cost'}</th>
        {showVo && <th className={moneyTh}>{isAr ? 'أوامر تغيير' : 'VO'}</th>}
        <th className={cn(moneyTh, 'bg-amber-100/80')}>{isAr ? 'ميزانية التكلفة' : 'Cost budget'}</th>
        <th className={cn(moneyTh, 'bg-sky-50')}>{isAr ? 'الفعلي' : 'Actual'}</th>
        <th className={moneyTh}>{isAr ? 'الانحراف' : 'Variance'}</th>
        <th className={cn(th, 'text-center w-[12%] min-w-0')}>{isAr ? 'الحالة' : 'Status'}</th>
      </tr>
    </thead>
  );
}

function DataRow({
  row,
  i,
  level,
  showVo,
  formatMoney,
  language,
  zebra,
}: {
  row: BudgetVsActualRow;
  i: number;
  level: BudgetDetailLevel;
  showVo: boolean;
  formatMoney: (n: number) => string;
  language: 'ar' | 'en';
  zebra: boolean;
}) {
  const under = row.variance >= -0.005;
  const onBudget = Math.abs(row.variance) < 0.005;
  const isAr = language === 'ar';
  return (
    <tr
      key={listKey(row.id, i, `bva-${row.level}`)}
      className={cn(
        'border-b border-slate-200/90',
        zebra ? 'bg-slate-50/90' : 'bg-white',
      )}
    >
      <td className="bva-entity-cell px-3.5 py-3 text-[13px] sm:text-[14px] font-semibold text-slate-900 leading-snug">
        {row.label}
      </td>
      {level !== 'project' && (
        <td className="bva-meta-cell px-3.5 py-3 text-[12px] sm:text-[13px] text-slate-500 leading-snug">
          {row.meta || '—'}
        </td>
      )}
      <MoneyCell value={row.boqSelling} formatMoney={formatMoney} isAr={isAr} className="text-slate-800" />
      <MoneyCell value={row.estCost} formatMoney={formatMoney} isAr={isAr} className="text-slate-800" />
      {showVo && (
        <MoneyCell value={row.voValue} formatMoney={formatMoney} isAr={isAr} className="text-slate-800" />
      )}
      <MoneyCell
        value={row.costBudget}
        formatMoney={formatMoney}
        isAr={isAr}
        className="font-bold text-slate-900 bg-amber-50/60"
      />
      <MoneyCell
        value={row.actual}
        formatMoney={formatMoney}
        isAr={isAr}
        className="font-semibold text-slate-900 bg-sky-50/50"
      />
      <MoneyCell
        value={row.variance}
        formatMoney={formatMoney}
        isAr={isAr}
        className={cn(
          'font-bold',
          onBudget ? 'text-slate-600' : under ? 'text-emerald-700' : 'text-red-700',
        )}
      />
      <td className="bva-status-cell px-2 py-3 text-center align-middle">
        <span
          className={cn(
            'bva-status-badge inline-flex items-center justify-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] sm:text-[12px] font-bold',
            onBudget
              ? 'bg-slate-100 text-slate-600'
              : under
                ? 'bg-emerald-50 text-emerald-800'
                : 'bg-red-50 text-red-800',
          )}
        >
          {!onBudget && (under ? <ArrowDownRight size={14} className="bva-status-icon shrink-0" /> : <ArrowUpRight size={14} className="bva-status-icon shrink-0" />)}
          <span className="bva-status-text">{statusLabel(row, language)}</span>
        </span>
      </td>
    </tr>
  );
}

export function BudgetVsActualReport({
  level,
  onLevelChange,
  projects,
  contracts,
  boqItems,
  actualByKey,
  selectedProjectId,
  selectedContractId,
  theme,
  language,
  dir,
  formatMoney,
  ui,
  scopeLabel,
  printDate,
  companyInfo,
  printProfile,
}: BudgetVsActualReportProps) {
  const isAr = language === 'ar';
  const showHeader = printProfile?.showHeader !== false;
  const showFooter = printProfile?.showFooter !== false;
  const showCompany = printProfile?.headerShowCompany !== false;
  const showAddress = printProfile?.headerShowAddress !== false;
  const showTaxId = printProfile?.headerShowTaxId !== false;
  const showLogo = printProfile?.showLogo !== false;
  const showTitle = printProfile?.headerShowTitle !== false;
  const showMeta = printProfile?.headerShowMeta !== false;
  const headerExtra = (printProfile?.headerExtraText || '').trim();
  const titleAlign = printProfile?.titleAlign ?? 'center';
  const logoAlign = printProfile?.logoAlign ?? 'start';
  const footerAlign = printProfile?.footerAlign ?? 'center';
  const showFooterCompany = printProfile?.footerShowCompany !== false;
  const showFooterText = printProfile?.footerShowText !== false;
  const showFooterNote = printProfile?.footerShowNote !== false;
  const showFooterPage = printProfile?.footerShowPageNum !== false;
  const footerExtra = (printProfile?.footerExtraText || '').trim();
  const accent = printProfile?.accent ?? '#b45309';

  const companyName = isAr
    ? (companyInfo?.companyName || '')
    : (companyInfo?.companyNameEn || companyInfo?.companyName || '');
  const companyAddress = isAr
    ? (companyInfo?.address || '')
    : (companyInfo?.addressEn || companyInfo?.address || '');
  const footerCompanyText = isAr
    ? (companyInfo?.footerText || '')
    : (companyInfo?.footerTextEn || companyInfo?.footerText || '');
  const logoUrl = resolveHeaderLogo(companyInfo?.headerLogo);

  const levelOptions = useMemo(
    () => [
      { value: 'project', label: isAr ? 'حسب المشروع' : 'By project' },
      { value: 'contract', label: isAr ? 'حسب العقد' : 'By contract' },
      { value: 'boq_item', label: isAr ? 'حسب بند BOQ' : 'By BOQ item' },
    ],
    [isAr],
  );

  const rows = useMemo(
    () =>
      buildBudgetVsActualRows({
        level,
        projects,
        contracts,
        boqItems,
        actualByKey,
        projectFilter: selectedProjectId,
        contractFilter: selectedContractId,
      }),
    [
      level,
      projects,
      contracts,
      boqItems,
      actualByKey,
      selectedProjectId,
      selectedContractId,
    ],
  );

  const totals = useMemo(() => sumBudgetVsActualRows(rows), [rows]);

  const pages = useMemo(
    () => chunkBudgetVsActualPages(rows, budgetVsActualRowsPerPage(level)),
    [rows, level],
  );

  const entityCol =
    level === 'project'
      ? isAr
        ? 'المشروع'
        : 'Project'
      : level === 'contract'
        ? isAr
          ? 'العقد'
          : 'Contract'
        : isAr
          ? 'بند BOQ'
          : 'BOQ item';

  const showVo = level === 'project';
  const title = isAr ? 'الميزانية مقابل الفعلي' : 'Budget vs Actual';
  const pageCount = pages.length;

  return (
    <div className="bva-report" dir={dir}>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4 print:hidden px-1">
        <div>
          <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">{title}</h3>
          <p className={cn('text-xs mt-0.5', ui.mutedText)}>
            {isAr
              ? 'مقسّم على صفحات A4 أفقية — الفعلي من تكاليف البنود (صرف · باطن · عهدة · OHA) وليس كل مصروف الدفتر'
              : 'Paginated A4 landscape — actual = BOQ-linked costs (issues · IPC · custody · OHA), not full GL opex'}
          </p>
        </div>
        <div className="flex items-center gap-2 min-w-[200px]">
          <Layers className="text-amber-600 shrink-0" size={18} />
          <SearchableSelect
            value={level}
            onChange={(v) => onLevelChange(v as BudgetDetailLevel)}
            theme={theme}
            dir={dir}
            className="w-52"
            options={levelOptions}
          />
        </div>
      </div>

      <div className="bva-pages">
        {pages.map((pageRows, pageIndex) => {
          const isLast = pageIndex === pageCount - 1;
          const pageNo = pageIndex + 1;
          return (
            <section
              key={`bva-page-${pageNo}`}
              className="bva-sheet"
              aria-label={isAr ? `صفحة ${pageNo} من ${pageCount}` : `Page ${pageNo} of ${pageCount}`}
            >
              {showHeader ? (
                <header
                  className="bva-sheet-header mb-2 pb-2 border-b-2"
                  style={{ borderColor: accent }}
                >
                  <div className="h-0.5 rounded-sm mb-1.5" style={{ background: accent }} aria-hidden />
                  {(showCompany || showAddress || (showTaxId && companyInfo?.taxId) || showLogo) ? (
                    <div
                      className={cn(
                        'flex items-start gap-2 mb-1 w-full',
                        logoAlign === 'center' && 'flex-col items-center',
                        logoAlign === 'end' && 'justify-start',
                        logoAlign === 'start' && 'justify-between',
                      )}
                    >
                      {(showCompany || showAddress || (showTaxId && companyInfo?.taxId)) ? (
                        <div className={cn('min-w-0', logoAlign === 'center' && 'text-center')}>
                          {showCompany && companyName ? (
                            <p className="text-xs font-extrabold text-slate-900 leading-tight">{companyName}</p>
                          ) : null}
                          {showAddress && companyAddress ? (
                            <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{companyAddress}</p>
                          ) : null}
                          {showTaxId && companyInfo?.taxId ? (
                            <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">
                              {isAr ? 'الرقم الضريبي:' : 'Tax ID:'} {companyInfo.taxId}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <div />
                      )}
                      {showLogo ? (
                        <img
                          src={logoUrl}
                          alt=""
                          className="h-7 max-w-[90px] object-contain shrink-0"
                          referrerPolicy="no-referrer"
                        />
                      ) : null}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div
                      className={cn(
                        'min-w-0',
                        titleAlign === 'start' && 'text-start',
                        titleAlign === 'center' && 'text-center flex-1',
                        titleAlign === 'end' && 'text-end',
                      )}
                    >
                      {showTitle ? (
                        <>
                          <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: accent }}>
                            {isAr ? 'تقرير تحليلي' : 'Analytical report'}
                          </p>
                          <h4 className="text-base font-extrabold text-slate-900 leading-tight mt-0.5">{title}</h4>
                        </>
                      ) : null}
                      {showMeta && (scopeLabel || printDate) ? (
                        <p className="text-[11px] text-slate-600 mt-0.5">
                          {[scopeLabel, printDate].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}
                      {headerExtra ? (
                        <p className="text-[10px] italic text-slate-600 mt-0.5">{headerExtra}</p>
                      ) : null}
                    </div>
                    <div className="text-end shrink-0">
                      <p className="text-xs font-semibold text-slate-700">
                        {isAr ? `صفحة ${pageNo} من ${pageCount}` : `Page ${pageNo} of ${pageCount}`}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {levelOptions.find((o) => o.value === level)?.label}
                      </p>
                    </div>
                  </div>
                </header>
              ) : (
                <header className="bva-sheet-header flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3 mb-4">
                  <div className="min-w-0">
                    {showTitle ? (
                      <h4 className="text-xl font-extrabold text-slate-900 leading-tight">{title}</h4>
                    ) : null}
                  </div>
                  <p className="text-sm font-semibold text-slate-700 shrink-0">
                    {isAr ? `صفحة ${pageNo} من ${pageCount}` : `Page ${pageNo} of ${pageCount}`}
                  </p>
                </header>
              )}

              <div className="bva-sheet-body overflow-visible">
                <table className="bva-table w-full border-collapse table-fixed">
                  <TableHead entityCol={entityCol} level={level} showVo={showVo} isAr={isAr} />
                  <tbody>
                    {pageRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={showVo ? 8 : 7}
                          className="px-3 py-12 text-center text-sm text-slate-500"
                        >
                          {isAr ? 'لا توجد بيانات للنطاق المحدد' : 'No data for the selected scope'}
                        </td>
                      </tr>
                    ) : (
                      pageRows.map((row, i) => (
                        <DataRow
                          key={listKey(row.id, i, `bva-p${pageNo}`)}
                          row={row}
                          i={i}
                          level={level}
                          showVo={showVo}
                          formatMoney={formatMoney}
                          language={language}
                          zebra={i % 2 === 1}
                        />
                      ))
                    )}
                  </tbody>
                  {isLast && rows.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-slate-800 bg-slate-100 font-bold text-slate-900">
                        <td className="px-3.5 py-3 text-[14px]">{isAr ? 'الإجمالي' : 'Total'}</td>
                        {level !== 'project' && <td className="px-3.5 py-3" />}
                        <MoneyCell value={totals.boqSelling} formatMoney={formatMoney} isAr={isAr} className="text-[14px]" />
                        <MoneyCell value={totals.estCost} formatMoney={formatMoney} isAr={isAr} className="text-[14px]" />
                        {showVo && (
                          <MoneyCell value={totals.voValue} formatMoney={formatMoney} isAr={isAr} className="text-[14px]" />
                        )}
                        <MoneyCell
                          value={totals.costBudget}
                          formatMoney={formatMoney}
                          isAr={isAr}
                          className="text-[14px] bg-amber-100/70"
                        />
                        <MoneyCell
                          value={totals.actual}
                          formatMoney={formatMoney}
                          isAr={isAr}
                          className="text-[14px] bg-sky-100/70"
                        />
                        <MoneyCell
                          value={totals.variance}
                          formatMoney={formatMoney}
                          isAr={isAr}
                          className={cn(
                            'text-[14px]',
                            totals.variance >= 0 ? 'text-emerald-800' : 'text-red-800',
                          )}
                        />
                        <td className="px-3.5 py-3" />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              <footer
                className={cn(
                  'bva-sheet-footer mt-auto border-t border-slate-200 text-slate-500',
                  showFooter && footerAlign === 'start' && 'text-start',
                  showFooter && footerAlign === 'center' && 'text-center',
                  showFooter && footerAlign === 'end' && 'text-end',
                  !showFooter && 'text-center',
                )}
              >
                {(() => {
                  const line1 = showFooter && showFooterCompany ? companyName : '';
                  const midParts: string[] = [];
                  if (showFooter && showFooterText && footerCompanyText) midParts.push(footerCompanyText);
                  if (showFooter && footerExtra) midParts.push(footerExtra);
                  if (showFooter && showFooterNote) {
                    midParts.push(
                      isAr ? 'تم استخراج هذا التقرير آلياً' : 'This report was generated automatically',
                    );
                  }
                  if (!showFooter) {
                    midParts.push(
                      isAr
                        ? 'ميزانية التكلفة = تقديرية (+ أوامر التغيير على مستوى المشروع)'
                        : 'Cost budget = est. (+ VO at project level)',
                    );
                  }
                  const line2 = midParts.join(' · ');
                  const line3 = showFooterPage
                    ? isAr
                      ? `صفحة ${pageNo} من ${pageCount}`
                      : `Page ${pageNo} of ${pageCount}`
                    : !showFooter
                      ? isAr
                        ? `A4 أفقي · ${pageNo}/${pageCount}`
                        : `A4 landscape · ${pageNo}/${pageCount}`
                      : '';
                  return (
                    <>
                      <p className="bva-ftr-line">{line1 || '\u00a0'}</p>
                      <p className="bva-ftr-line">{line2 || '\u00a0'}</p>
                      <p className="bva-ftr-line">{line3 || '\u00a0'}</p>
                    </>
                  );
                })()}
              </footer>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export type { BudgetDetailLevel, BudgetVsActualRow };
