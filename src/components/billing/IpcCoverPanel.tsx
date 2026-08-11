import { cn } from '../../lib/utils';
import type { IpcCoverWorksSplit } from '../../lib/ipcCoverFromQtyList';
import type { IpcCoverSchedule } from '../../lib/ipcCoverSchedule';
import type { IpcCoverContractSums } from '../../lib/ipcCoverContractSums';
import { amountInWordsEgyptianPounds } from '../../lib/amountInWordsEn';
import { buildIpcCoverClosingData, IPC_COVER_CLOSING_DEFAULTS } from '../../lib/ipcCoverClosing';
import {
  buildIpcCoverSheetModel,
  defaultIpcCoverSheetRates,
  type IpcCoverSheetRates,
} from '../../lib/ipcCoverSheet';

/** @deprecated Cover amounts come from `buildIpcCoverSheetModel` — kept for type imports. */
export type IpcCoverDeductionRow = {
  label: string;
  pct?: number | null;
  base?: number | null;
  amount: number;
  isDeduction?: boolean;
};

type Props = {
  cover: IpcCoverWorksSplit;
  schedule?: IpcCoverSchedule | null;
  contractSums?: IpcCoverContractSums | null;
  formatMoney: (n: number) => string;
  language: string;
  theme: string;
  dir?: 'rtl' | 'ltr';
  asOfDate?: string;
  materialsOnSite?: number;
  priceAdjustment?: number;
  /** Cover % rates — same object used for print (panel ≡ preview). */
  rates?: Partial<IpcCoverSheetRates>;
  advancePaymentTotal?: number;
  advanceRecovery?: number;
  backCharge?: number;
  previousPayments?: number;
  /** @deprecated Ignored — NET comes from `buildIpcCoverSheetModel`. */
  netPayable?: number;
  preparedBy?: string;
  approvedBy?: string;
  /** @deprecated Ignored — sheet model owns deduction amounts. */
  deductions?: IpcCoverDeductionRow[];
  /** @deprecated Use rates.vatPct */
  vatPct?: number;
};

function moneyCell(formatMoney: (n: number) => string, n: number, language: string): string {
  const prefix = language === 'ar' ? '' : 'EGP ';
  return `${prefix}${formatMoney(n)}`;
}

function deductionMoney(
  formatMoney: (n: number) => string,
  n: number,
  language: string,
): string {
  const abs = moneyCell(formatMoney, Math.abs(n), language);
  return n === 0 ? abs : `(${abs})`;
}

function StackRow({
  label,
  value,
  theme,
  emphasize,
  valueClassName,
}: {
  label: string;
  value: string;
  theme: string;
  emphasize?: boolean;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 px-3 py-1.5 text-xs border-b last:border-b-0',
        theme === 'dark' ? 'border-gray-800/80' : 'border-gray-100',
        emphasize && (theme === 'dark' ? 'bg-blue-950/30 font-bold' : 'bg-blue-50/80 font-bold'),
      )}
    >
      <span className={cn('leading-snug', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{label}</span>
      <span
        className={cn(
          'font-mono tabular-nums text-end shrink-0',
          theme === 'dark' ? 'text-gray-100' : 'text-gray-900',
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}

function DeductionRow({
  label,
  pct,
  base,
  amount,
  isDeduction,
  formatMoney,
  theme,
  language,
}: {
  label: string;
  pct: number | null;
  base: number | null;
  amount: number;
  isDeduction: boolean;
  formatMoney: (n: number) => string;
  theme: string;
  language: string;
}) {
  const pctLabel =
    pct != null && Number.isFinite(pct) ? `${Number(pct).toFixed(pct % 1 ? 1 : 0)}%` : '';
  const baseLabel =
    base != null && Number.isFinite(base) ? moneyCell(formatMoney, base, language) : '';
  const amt = isDeduction
    ? deductionMoney(formatMoney, amount, language)
    : moneyCell(formatMoney, amount, language);

  return (
    <div
      className={cn(
        'grid grid-cols-1 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_4.5rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 px-3 py-1.5 text-[11px] border-b last:border-b-0 items-center',
        theme === 'dark' ? 'border-gray-800/80' : 'border-gray-100',
      )}
    >
      <span className={theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}>{label}</span>
      <span className={cn('font-mono tabular-nums text-end', theme === 'dark' ? 'text-gray-500' : 'text-gray-500')}>
        {baseLabel}
      </span>
      <span className="font-mono tabular-nums text-end text-amber-600 dark:text-amber-400">{pctLabel}</span>
      <span
        className={cn(
          'font-mono tabular-nums text-end font-semibold',
          isDeduction ? 'text-red-500' : theme === 'dark' ? 'text-gray-100' : 'text-gray-900',
        )}
      >
        {amt}
      </span>
    </div>
  );
}

/**
 * Cover-JLL layout — numbers from `buildIpcCoverSheetModel` (same as print).
 */
export function IpcCoverPanel({
  cover,
  schedule,
  contractSums,
  formatMoney,
  language,
  theme,
  dir,
  asOfDate,
  materialsOnSite = 0,
  priceAdjustment = 0,
  rates: ratesProp,
  vatPct,
  advancePaymentTotal = 0,
  advanceRecovery = 0,
  backCharge = 0,
  previousPayments = 0,
  preparedBy,
  approvedBy,
}: Props) {
  const isAr = language === 'ar';
  const coverDir = dir ?? (isAr ? 'rtl' : 'ltr');
  const border = theme === 'dark' ? 'border-gray-800' : 'border-gray-200';
  const head = theme === 'dark' ? 'bg-gray-900/60 text-blue-300' : 'bg-gray-50 text-blue-700';
  const sectionHead = cn(
    'px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide',
    theme === 'dark' ? 'text-gray-400 bg-gray-900/40' : 'text-gray-600 bg-gray-50',
  );
  const colSplit = theme === 'dark' ? 'divide-gray-800' : 'divide-gray-200';

  const sheet = buildIpcCoverSheetModel({
    grossBasic: cover.basic.toDateValue,
    approvedVoWorks: cover.additional.toDateValue,
    provisionalWorks: 0,
    materialsOnSite,
    priceAdjustment,
    rates: defaultIpcCoverSheetRates({
      ...ratesProp,
      ...(vatPct != null ? { vatPct } : {}),
    }),
    advancePaymentTotal,
    advanceRecovery,
    backCharge,
    previousPayments,
  });

  const sums = contractSums ?? {
    originalContractSum: 0,
    provisionalSums: 0,
    approvedVoAdditions: 0,
    approvedVoOmissions: 0,
    adjustedContractSum: 0,
    totalCaiValues: 0,
  };

  const closing = buildIpcCoverClosingData(amountInWordsEgyptianPounds(sheet.netPayable), {
    preparedBy,
    approvedBy,
  });
  const muted = theme === 'dark' ? 'text-gray-400' : 'text-gray-600';
  const ink = theme === 'dark' ? 'text-gray-100' : 'text-gray-900';
  const lineBorder = theme === 'dark' ? 'border-gray-500' : 'border-gray-800';

  return (
    <div className={cn('rounded-xl border overflow-hidden', border)} dir={coverDir}>
      <div className={cn('px-3 py-2 text-[10px] font-bold uppercase tracking-wider', head)}>
        {isAr ? 'كفر المستخلص — Cover-JLL' : 'IPC Cover — Cover-JLL'}
      </div>

      <div className={cn('grid grid-cols-1 md:grid-cols-2 md:divide-x border-b', border, colSplit)}>
        <div>
          <StackRow
            label={isAr ? 'قيمة العقد الأصلية' : 'Original Contract Sum'}
            value={moneyCell(formatMoney, sums.originalContractSum, language)}
            theme={theme}
          />
          <StackRow
            label={
              isAr
                ? 'مبالغ مؤقتة / أوامر تغيير على الحساب'
                : "Provisional Sums / On Account V.O.'s"
            }
            value={moneyCell(formatMoney, sums.provisionalSums, language)}
            theme={theme}
          />
          <StackRow
            label={isAr ? 'أوامر تغيير معتمدة (إضافات)' : "Approved V.O.'s (Additions)"}
            value={moneyCell(formatMoney, sums.approvedVoAdditions, language)}
            theme={theme}
          />
          <StackRow
            label={isAr ? 'أوامر تغيير معتمدة (حذف)' : "Approved V.O.'s (Omissions)"}
            value={moneyCell(formatMoney, sums.approvedVoOmissions, language)}
            theme={theme}
          />
          <StackRow
            label={isAr ? 'قيمة العقد المعدّلة' : 'Adjusted Contract Sum'}
            value={moneyCell(formatMoney, sums.adjustedContractSum, language)}
            theme={theme}
            emphasize
          />
          <StackRow
            label={isAr ? 'إجمالي قيم أوامر الموافقة (CAI)' : "Total Values of CAI's"}
            value={moneyCell(formatMoney, sums.totalCaiValues, language)}
            theme={theme}
          />
        </div>
        <div>
          <StackRow
            label={isAr ? 'تاريخ توقيع خطاب الترسية (LOA)' : 'Date of signing LOA'}
            value={schedule?.loaDate ?? '—'}
            theme={theme}
          />
          <StackRow
            label={isAr ? 'تاريخ المباشرة' : 'Commencement Date'}
            value={schedule?.commencementDate ?? '—'}
            theme={theme}
          />
          <StackRow
            label={isAr ? 'مدة العقد' : 'Contract Duration'}
            value={schedule?.durationLabel ?? '—'}
            theme={theme}
          />
          <StackRow
            label={isAr ? 'تمديد المدة' : 'Time Extension'}
            value={schedule?.timeExtensionLabel ?? '—'}
            theme={theme}
          />
          <StackRow
            label={isAr ? 'تاريخ الإنجاز' : 'Date of Completion'}
            value={schedule?.completionDate ?? '—'}
            theme={theme}
          />
        </div>
      </div>

      <div className={cn('border-b', border)}>
        <div className={sectionHead}>
          {isAr ? 'الأعمال المنفذة والتشوينات حتى' : 'WORK DONE & MATERIALS ON SITE AS OF'}
          {asOfDate ? ` : ${asOfDate}` : ''}
        </div>
        <StackRow
          label={
            isAr
              ? 'إجمالي قيمة الأعمال المنفذة حتى نهاية فترة المستخلص'
              : 'Gross Value of Works Executed To End of Invoice Period'
          }
          value={moneyCell(formatMoney, sheet.grossBasic, language)}
          theme={theme}
        />
        <StackRow
          label={
            isAr
              ? 'قيمة أعمال المبالغ المؤقتة / أوامر على الحساب حتى نهاية الفترة'
              : "Value Work Executed Provisional Sums / On Account V.O.'s To End of Invoice Period"
          }
          value={moneyCell(formatMoney, sheet.provisionalWorks, language)}
          theme={theme}
        />
        <StackRow
          label={
            isAr
              ? 'قيمة أعمال أوامر التغيير المعتمدة حتى نهاية الفترة'
              : "Value Work Executed Approved V.O.'s To End of Invoice Period"
          }
          value={moneyCell(formatMoney, sheet.approvedVoWorks, language)}
          theme={theme}
        />
        <StackRow
          label={
            isAr
              ? 'مواد بالموقع حتى نهاية الفترة'
              : 'Materials On Site To End of Invoice Period'
          }
          value={moneyCell(formatMoney, sheet.materialsOnSite, language)}
          theme={theme}
        />
        <StackRow
          label={
            isAr
              ? 'دفعات مقابل تعديل الأسعار بسبب تغير التكلفة'
              : 'Payment against Price Adjustment due to Change in Cost'
          }
          value={moneyCell(formatMoney, sheet.priceAdjustment, language)}
          theme={theme}
        />
        <StackRow
          label={
            isAr
              ? `ضريبة القيمة المضافة (VAT ${sheet.vatPct}%)`
              : `Value Added Tax (VAT ${sheet.vatPct}%)`
          }
          value={isAr ? 'مشمولة' : 'Included'}
          theme={theme}
        />
        <StackRow
          label={isAr ? 'Sub - Total' : 'Sub - Total'}
          value={moneyCell(formatMoney, sheet.subTotal, language)}
          theme={theme}
          emphasize
        />

        <div className={sectionHead}>{isAr ? 'إضافات / استقطاعات' : 'ADDITIONS / OMISSIONS'}</div>

        <DeductionRow
          label={isAr ? 'إجمالي الدفعة المقدمة' : 'Total Advance Payment'}
          pct={null}
          base={null}
          amount={sheet.advancePaymentTotal}
          isDeduction={false}
          formatMoney={formatMoney}
          theme={theme}
          language={language}
        />
        <DeductionRow
          label={isAr ? 'ناقص: استرداد المقدمة حتى تاريخه' : 'Less : Recovery to Date (AP)'}
          pct={null}
          base={null}
          amount={sheet.advanceRecovery}
          isDeduction
          formatMoney={formatMoney}
          theme={theme}
          language={language}
        />
        <StackRow
          label=""
          value={moneyCell(formatMoney, sheet.advanceNet, language)}
          theme={theme}
        />

        {sheet.deductions.map((row) => (
          <DeductionRow
            key={row.id}
            label={isAr ? row.labelAr : row.labelEn}
            pct={row.pct}
            base={row.base}
            amount={row.amount}
            isDeduction={row.isDeduction}
            formatMoney={formatMoney}
            theme={theme}
            language={language}
          />
        ))}

        <DeductionRow
          label={isAr ? 'مدفوعات سابقة' : 'Previous Payments'}
          pct={null}
          base={null}
          amount={sheet.previousPayments}
          isDeduction
          formatMoney={formatMoney}
          theme={theme}
          language={language}
        />
      </div>

      <div
        className={cn(
          'flex items-center justify-between gap-3 px-3 py-2.5 text-sm font-bold border-b',
          theme === 'dark' ? 'bg-emerald-950/40 text-emerald-300 border-gray-800' : 'bg-emerald-50 text-emerald-900 border-gray-200',
        )}
      >
        <span>{isAr ? 'صافي المستحق للتحصيل' : 'NET PAYMENT DUE'}</span>
        <span className="font-mono tabular-nums">{moneyCell(formatMoney, sheet.netPayable, language)}</span>
      </div>

      <div className={cn('px-3 py-3 space-y-3 text-[11px]', theme === 'dark' ? 'bg-gray-950/40' : 'bg-white')} dir="ltr">
        <p className={cn('leading-snug', ink)}>
          <span className="font-bold">IN WORDS:</span> {closing.amountInWords}
        </p>
        <p className={cn('font-semibold', muted)}>{closing.fundsLabel}</p>
        <div className={cn('flex flex-wrap justify-between gap-4', ink)}>
          <span>
            <strong>{closing.preparedByLabel}</strong> {closing.preparedBy}
          </span>
          <span>
            <strong>{closing.approvedByLabel}</strong> {closing.approvedBy}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          {closing.signatories.map((role) => (
            <div key={role} className="min-h-[3.5rem] flex flex-col justify-end">
              <div className={cn('border-b mb-1', lineBorder)} />
              <p className={cn('text-center text-[10px] font-semibold', muted)}>{role}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div>
            <p className={cn('font-bold mb-1', ink)}>{closing.distributionTitle}</p>
            <ul className={cn('list-disc list-inside space-y-0.5', muted)}>
              {closing.distribution.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className={cn('leading-snug mb-3', muted)}>{closing.acceptanceText}</p>
            <div className={cn('border-b mb-1 mt-8', lineBorder)} />
            <p className={cn('text-center text-[10px] font-semibold', muted)}>
              {IPC_COVER_CLOSING_DEFAULTS.contractorLabel}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
