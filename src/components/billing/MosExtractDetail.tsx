import React from 'react';
import { CheckCircle2, Loader2, PackageCheck, Printer } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { formatQuantity } from '../../lib/formatQuantity';
import { cn } from '../../lib/utils';
import type { MosCertificate, MosStatus } from '../../types';
import { ManualHelpButton } from '../help/ManualHelpButton';

interface Props {
  certificate: MosCertificate;
  canApprove: boolean;
  theme: string;
  approving?: boolean;
  onApprove: () => void;
  onPrint?: (cert: MosCertificate) => void;
}

export function MosExtractDetail({
  certificate: cert,
  canApprove,
  theme,
  approving = false,
  onApprove,
  onPrint,
}: Props) {
  const { t, language, locale, formatMoney } = useLanguage();
  const isDark = theme === 'dark';

  const statusLabel = (status: MosStatus): string =>
    status === 'approved'
      ? t('mos_status_approved')
      : status === 'superseded'
        ? t('mos_status_superseded')
        : t('mos_status_draft');

  const phaseLabel = (phase: string): string =>
    phase === 'initial' ? t('mos_phase_initial') : t('mos_phase_periodic');

  const statusCls = (status: MosStatus): string =>
    status === 'approved'
      ? 'bg-green-500/15 text-green-500'
      : status === 'superseded'
        ? 'bg-gray-500/15 text-gray-400'
        : 'bg-amber-500/15 text-amber-500';

  return (
    <>
      <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
        <div className="flex gap-3 min-w-0">
          <div className={cn(
            'w-10 h-10 rounded-lg flex items-center justify-center border shrink-0',
            isDark ? 'bg-gray-900 border-gray-800' : 'bg-cyan-50 border-cyan-100',
          )}>
            <PackageCheck className="text-cyan-500" size={20} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold">{cert.certificateNo}</h3>
              <ManualHelpButton topicId="technical.billing.mos" size={14} />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {phaseLabel(cert.phase)}
              {cert.extractDate ? ` · ${cert.extractDate}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <span className={cn('inline-block px-2 py-0.5 rounded-full text-xs font-medium', statusCls(cert.status))}>
            {statusLabel(cert.status)}
          </span>
          <span className="text-[10px] font-bold px-2 py-1 rounded uppercase bg-cyan-500/15 text-cyan-500">
            {t('extract_kind_mos')}
          </span>
          {onPrint && cert.status === 'approved' && (
            <button
              type="button"
              onClick={() => onPrint(cert)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600/90 text-white text-xs font-bold hover:bg-blue-500 transition-colors"
            >
              <Printer size={14} />
              {t('mos_print')}
            </button>
          )}
          {cert.status === 'draft' && canApprove && (
            <button
              type="button"
              disabled={approving}
              onClick={onApprove}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-bold hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {approving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              {t('mos_approve')}
            </button>
          )}
        </div>
      </div>

      <div className={cn('grid grid-cols-2 md:grid-cols-3 gap-4 py-4 border-t', isDark ? 'border-gray-800/50' : 'border-gray-100')}>
        <div>
          <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{t('mos_col_lines_count')}</p>
          <p className="text-sm font-bold">{cert.lines?.length ?? 0}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{t('mos_col_claimed')}</p>
          <p className="text-lg font-bold text-green-500">{formatMoney(cert.totalClaimed)}</p>
        </div>
        {cert.deliveryNoteRef ? (
          <div>
            <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{t('mos_field_delivery_note')}</p>
            <p className="text-sm font-mono">{cert.deliveryNoteRef}</p>
          </div>
        ) : null}
      </div>

      {(cert.lines?.length ?? 0) > 0 && (
        <div className={cn('mt-4 pt-4 border-t overflow-x-auto', isDark ? 'border-gray-800/50' : 'border-gray-100')}>
          <table className="w-full text-xs">
            <thead>
              <tr className={isDark ? 'text-gray-500' : 'text-gray-600'}>
                <th className="text-start py-1">{t('mos_col_item')}</th>
                <th className="text-end py-1">{t('mos_col_supplied_this_period')}</th>
                <th className="text-end py-1">{t('mos_col_percentage')}</th>
                <th className="text-end py-1">{t('mos_col_equivalent_qty')}</th>
                <th className="text-end py-1">{t('mos_col_equivalent_cumulative')}</th>
                <th className="text-end py-1">{t('mos_col_claimed')}</th>
              </tr>
            </thead>
            <tbody>
              {cert.lines.map((line) => (
                <tr key={line.id} className={cn('border-t', isDark ? 'border-gray-800/40 text-gray-300' : 'border-gray-100 text-gray-700')}>
                  <td className="py-2">{line.boqItemDescription || line.boqItemCode || line.boqItemId}</td>
                  <td className="text-end font-mono py-2">{formatQuantity(line.suppliedQtyThisPeriod, language)}</td>
                  <td className="text-end py-2">{line.onSitePercentage}%</td>
                  <td className="text-end font-mono py-2">{formatQuantity(line.equivalentQty, language)}</td>
                  <td className="text-end font-mono py-2">{formatQuantity(line.equivalentCumulative, language)}</td>
                  <td className="text-end font-mono py-2">{line.claimedAmount.toLocaleString(locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
