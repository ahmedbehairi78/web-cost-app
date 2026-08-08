import React, { useCallback, useEffect, useState } from 'react';
import { ManualHelpButton } from '../help/ManualHelpButton';
import { PackageCheck, CheckCircle2, Loader2, ChevronDown, ChevronUp, Printer } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { mosCertificatesApi } from '../../services/local/modulesApi';
import { formatQuantity } from '../../lib/formatQuantity';
import { cn } from '../../lib/utils';
import type { MosCertificate, MosStatus } from '../../types';
import toast from 'react-hot-toast';

interface Props {
  contractId: string;
  canApprove: boolean;
  theme: string;
  refreshSignal: number;
  highlightCertificateId?: string | null;
  onChanged: () => void;
  onPrint?: (cert: MosCertificate) => void;
}

export function MosExtractsPanel({
  contractId,
  canApprove,
  theme,
  refreshSignal,
  highlightCertificateId,
  onChanged,
  onPrint,
}: Props) {
  const { t, language, locale, formatMoney } = useLanguage();
  const isDark = theme === 'dark';

  const [certificates, setCertificates] = useState<MosCertificate[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    if (!contractId) {
      setCertificates([]);
      return;
    }
    let cancelled = false;
    setListLoading(true);
    mosCertificatesApi
      .list({ contractId })
      .then((rows) => {
        if (!cancelled) setCertificates(rows);
      })
      .catch(() => {
        if (!cancelled) setCertificates([]);
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contractId, refreshSignal, localRefresh]);

  useEffect(() => {
    if (!highlightCertificateId || certificates.length === 0) return;
    setExpandedId(highlightCertificateId);
    const timer = window.setTimeout(() => {
      document.getElementById(`mos-cert-${highlightCertificateId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [highlightCertificateId, certificates]);

  const handleApprove = useCallback(
    async (cert: MosCertificate) => {
      setApprovingId(cert.id);
      try {
        await mosCertificatesApi.approve(cert.id);
        toast.success(t('mos_approved'));
        setLocalRefresh((k) => k + 1);
        onChanged();
      } catch {
        toast.error(t('mos_approve_failed'));
      } finally {
        setApprovingId(null);
      }
    },
    [onChanged, t],
  );

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

  const panelCls = cn(
    'rounded-xl border overflow-hidden',
    isDark ? 'bg-[#151619] border-gray-800' : 'bg-white border-gray-200 shadow-sm',
  );
  const cellCls = cn('px-3 py-2 text-sm', isDark ? 'text-gray-200' : 'text-gray-700');
  const headCls = cn(
    'px-3 py-2 text-xs font-semibold uppercase tracking-wide',
    isDark ? 'text-gray-400' : 'text-gray-500',
  );

  return (
    <div className={panelCls}>
      <div className={cn('flex items-center gap-2 px-4 py-3 border-b', isDark ? 'border-gray-800' : 'border-gray-200')}>
        <PackageCheck size={18} className="text-blue-500" />
        <h3 className="font-bold text-sm">{t('mos_section_title')}</h3>
        <ManualHelpButton topicId="technical.billing.mos" size={14} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className={cn('border-b', isDark ? 'border-gray-800' : 'border-gray-200')}>
              <th className={cn(headCls, 'text-start w-8')} />
              <th className={cn(headCls, 'text-start')}>{t('mos_col_number')}</th>
              <th className={cn(headCls, 'text-start')}>{t('mos_col_phase')}</th>
              <th className={cn(headCls, 'text-start')}>{t('mos_field_date')}</th>
              <th className={cn(headCls, 'text-end')}>{t('mos_col_lines_count')}</th>
              <th className={cn(headCls, 'text-end')}>{t('mos_col_claimed')}</th>
              <th className={cn(headCls, 'text-center')}>{t('mos_col_status')}</th>
              <th className={cn(headCls, 'text-center')}>{t('mos_col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {listLoading ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-400">
                  <Loader2 size={18} className="inline animate-spin" />
                </td>
              </tr>
            ) : certificates.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-400">
                  {t('mos_empty')}
                </td>
              </tr>
            ) : (
              certificates.map((cert) => {
                const expanded = expandedId === cert.id;
                return (
                  <React.Fragment key={cert.id}>
                    <tr
                      id={`mos-cert-${cert.id}`}
                      className={cn(
                        'border-b',
                        isDark ? 'border-gray-800/60' : 'border-gray-100',
                        highlightCertificateId === cert.id && 'ring-2 ring-blue-500/60 ring-inset',
                      )}
                    >
                      <td className={cellCls}>
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : cert.id)}
                          className="text-gray-500 hover:text-blue-500"
                          aria-expanded={expanded}
                        >
                          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </td>
                      <td className={cn(cellCls, 'font-mono text-xs whitespace-nowrap')}>{cert.certificateNo}</td>
                      <td className={cellCls}>{phaseLabel(cert.phase)}</td>
                      <td className={cellCls}>{cert.extractDate || '—'}</td>
                      <td className={cn(cellCls, 'text-end')}>{cert.lines?.length ?? 0}</td>
                      <td className={cn(cellCls, 'text-end font-mono')}>{formatMoney(cert.totalClaimed)}</td>
                      <td className={cn(cellCls, 'text-center')}>
                        <span
                          className={cn(
                            'inline-block px-2 py-0.5 rounded-full text-xs font-medium',
                            statusCls(cert.status),
                          )}
                        >
                          {statusLabel(cert.status)}
                        </span>
                      </td>
                      <td className={cn(cellCls, 'text-center')}>
                        <div className="inline-flex items-center justify-center gap-1 flex-wrap">
                          {onPrint && cert.status === 'approved' ? (
                            <button
                              type="button"
                              onClick={() => onPrint(cert)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-600/90 text-white text-xs font-medium hover:bg-blue-500 transition-colors"
                            >
                              <Printer size={14} />
                              {t('mos_print')}
                            </button>
                          ) : null}
                          {cert.status === 'draft' && canApprove ? (
                            <button
                              type="button"
                              disabled={approvingId === cert.id}
                              onClick={() => handleApprove(cert)}
                              className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                            >
                              {approvingId === cert.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <CheckCircle2 size={14} />
                              )}
                              {t('mos_approve')}
                            </button>
                          ) : null}
                          {!(onPrint && cert.status === 'approved') &&
                          !(cert.status === 'draft' && canApprove) ? (
                            <span className="text-xs text-gray-400">—</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {expanded && cert.lines?.length > 0 && (
                      <tr className={isDark ? 'bg-gray-900/40' : 'bg-gray-50'}>
                        <td colSpan={8} className="px-4 py-3">
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
                                <tr key={line.id} className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                                  <td className="py-1">{line.boqItemDescription || line.boqItemId}</td>
                                  <td className="text-end font-mono">
                                    {formatQuantity(line.suppliedQtyThisPeriod, language)}
                                  </td>
                                  <td className="text-end">{line.onSitePercentage}%</td>
                                  <td className="text-end font-mono">
                                    {formatQuantity(line.equivalentQty, language)}
                                  </td>
                                  <td className="text-end font-mono">
                                    {formatQuantity(line.equivalentCumulative, language)}
                                  </td>
                                  <td className="text-end font-mono">{line.claimedAmount.toLocaleString(locale)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
