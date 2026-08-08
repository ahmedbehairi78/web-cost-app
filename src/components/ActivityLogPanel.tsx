import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, Timestamp } from 'firebase/firestore';
import { Loader2, RefreshCw, ScrollText } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { cn, listKey } from '../lib/utils';
import { isLocalBackend } from '../lib/dataBackend';
import { useLanguage } from '../context/LanguageContext';
import type { ActivityKind } from '../services/activityLogService';

export interface ActivityLogRow {
  id: string;
  uid: string;
  email: string;
  sessionId: string;
  kind: ActivityKind | string;
  moduleId: string | null;
  detail: string | null;
  meta: Record<string, unknown> | null;
  context: {
    timeZone?: string;
    locale?: string;
    geo?: { status?: string; lat?: number; lng?: number; accuracyM?: number };
    viewport?: { w: number; h: number };
    screen?: { w: number; h: number };
    connection?: string;
    referrer?: string;
    path?: string;
  } | null;
  appBuild?: string;
  createdAt: Timestamp | null;
}

function formatCtx(row: ActivityLogRow, language: string): string {
  const c = row.context;
  if (!c) return '—';
  const parts: string[] = [];
  if (c.timeZone) parts.push(`${language === 'ar' ? 'منطقة زمنية' : 'TZ'}: ${c.timeZone}`);
  if (c.locale) parts.push(`${language === 'ar' ? 'لغة المتصفح' : 'Locale'}: ${c.locale}`);
  if (c.geo?.status === 'ok' && c.geo.lat != null && c.geo.lng != null) {
    parts.push(
      `${language === 'ar' ? 'موقع تقريبي' : 'Approx.'}: ${c.geo.lat}, ${c.geo.lng}` +
        (c.geo.accuracyM != null ? ` (±${c.geo.accuracyM}m)` : ''),
    );
  } else if (c.geo?.status && c.geo.status !== 'pending') {
    parts.push(`${language === 'ar' ? 'الموقع' : 'Geo'}: ${c.geo.status}`);
  }
  if (c.viewport) parts.push(`${language === 'ar' ? 'عرض النافذة' : 'Viewport'}: ${c.viewport.w}×${c.viewport.h}`);
  if (c.connection) parts.push(`${language === 'ar' ? 'شبكة' : 'Net'}: ${c.connection}`);
  return parts.join(' · ') || '—';
}

export function ActivityLogPanel() {
  const { language, theme, dir, locale, t } = useLanguage();
  const [rows, setRows] = useState<ActivityLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEmail, setFilterEmail] = useState('');
  const [filterKind, setFilterKind] = useState('');
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Password / local Postgres sessions have no Firebase Auth — Firestore rules deny list.
      if (isLocalBackend) {
        setRows([]);
        return;
      }
      const q = query(collection(db, 'activity_logs'), orderBy('createdAt', 'desc'), limit(400));
      const snap = await getDocs(q);
      const next: ActivityLogRow[] = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          uid: String(x.uid ?? ''),
          email: String(x.email ?? ''),
          sessionId: String(x.sessionId ?? ''),
          kind: String(x.kind ?? ''),
          moduleId: x.moduleId != null ? String(x.moduleId) : null,
          detail: x.detail != null ? String(x.detail) : null,
          meta: x.meta != null && typeof x.meta === 'object' ? (x.meta as Record<string, unknown>) : null,
          context: x.context != null && typeof x.context === 'object' ? (x.context as ActivityLogRow['context']) : null,
          appBuild: x.appBuild != null ? String(x.appBuild) : undefined,
          createdAt: x.createdAt instanceof Timestamp ? x.createdAt : null,
        };
      });
      setRows(next);
    } catch (e) {
      try {
        handleFirestoreError(e, OperationType.LIST, 'activity_logs');
      } catch {
        /* handleFirestoreError logs then throws — keep UI stable */
      }
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, tick]);

  const kinds = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => s.add(r.kind));
    return [...s].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const em = filterEmail.trim().toLowerCase();
    const k = filterKind.trim().toLowerCase();
    return rows.filter((r) => {
      if (em && !r.email.toLowerCase().includes(em)) return false;
      if (k && !r.kind.toLowerCase().includes(k)) return false;
      return true;
    });
  }, [rows, filterEmail, filterKind]);

  const kindLabel = useCallback(
    (kind: string) => {
      const key = `activity_kind_${kind}`;
      const translated = t(key);
      return translated === key ? kind : translated;
    },
    [t],
  );

  const surface = cn(
    'rounded-2xl border p-5 space-y-4',
    theme === 'dark' ? 'border-gray-800 bg-gray-900/40' : theme === 'soft' ? 'border-[#cfd8dc] bg-white/80' : 'border-gray-200 bg-white',
  );

  return (
    <div className="space-y-6" dir={dir}>
      <div className="flex items-center gap-3 mb-2">
        <div className={cn('p-2 rounded-lg', theme === 'dark' ? 'bg-violet-900/30 text-violet-400' : 'bg-violet-50 text-violet-600')}>
          <ScrollText size={24} />
        </div>
        <div>
          <h3 className="text-xl font-bold">{t('activity_log_section')}</h3>
          <p className={cn('text-sm mt-1', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
            {t('activity_log_intro')}
          </p>
        </div>
      </div>

      <div className={surface}>
        <div className="flex flex-wrap gap-3 items-end justify-between">
          <div className="flex flex-wrap gap-3 flex-1 min-w-[200px]">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">{t('activity_filter_email')}</label>
              <input
                type="search"
                value={filterEmail}
                onChange={(e) => setFilterEmail(e.target.value)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-sm',
                  theme === 'dark' ? 'bg-gray-950 border-gray-700' : 'bg-white border-gray-300',
                )}
                placeholder="user@…"
              />
            </div>
            <div className="min-w-[160px]">
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">{t('activity_filter_kind')}</label>
              <select
                value={filterKind}
                onChange={(e) => setFilterKind(e.target.value)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-sm',
                  theme === 'dark' ? 'bg-gray-950 border-gray-700' : 'bg-white border-gray-300',
                )}
              >
                <option value="">{t('activity_filter_kind_all')}</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {kindLabel(k)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTick((n) => n + 1)}
            disabled={loading}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors text-white',
              theme === 'dark' ? 'bg-violet-600 hover:bg-violet-500' : 'bg-violet-600 hover:bg-violet-500',
            )}
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
            {t('activity_refresh')}
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-700/30 dark:border-gray-700">
          <table className="w-full text-xs text-left border-collapse min-w-[920px]">
            <thead className={cn('sticky top-0 z-[1]', theme === 'dark' ? 'bg-gray-950' : 'bg-gray-100')}>
              <tr>
                <th className="p-2 font-bold border-b border-gray-700/40">{t('activity_col_time')}</th>
                <th className="p-2 font-bold border-b border-gray-700/40">{t('activity_col_user')}</th>
                <th className="p-2 font-bold border-b border-gray-700/40">{t('activity_col_kind')}</th>
                <th className="p-2 font-bold border-b border-gray-700/40">{t('activity_col_module')}</th>
                <th className="p-2 font-bold border-b border-gray-700/40">{t('activity_col_detail')}</th>
                <th className="p-2 font-bold border-b border-gray-700/40">{t('activity_col_place')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500">
                    <Loader2 className="animate-spin inline mr-2" size={16} />
                    {language === 'ar' ? 'جاري التحميل…' : 'Loading…'}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500">
                    {isLocalBackend ? t('activity_local_unavailable') : t('activity_empty')}
                  </td>
                </tr>
              ) : (
                filtered.map((r, ri) => {
                  const dt = r.createdAt?.toDate?.();
                  const timeStr = dt
                    ? dt.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'medium' })
                    : '—';
                  return (
                    <tr key={listKey(r.id, ri, 'activity')} className={cn('border-b border-gray-800/40', theme === 'dark' ? 'hover:bg-gray-900/80' : 'hover:bg-gray-50')}>
                      <td className="p-2 align-top font-mono whitespace-nowrap text-[11px]">{timeStr}</td>
                      <td className="p-2 align-top">
                        <div className="font-medium">{r.email || '—'}</div>
                        <div className="text-[10px] text-gray-500 font-mono truncate max-w-[180px]" title={r.sessionId}>
                          {r.sessionId.slice(0, 12)}…
                        </div>
                      </td>
                      <td className="p-2 align-top whitespace-nowrap">{kindLabel(r.kind)}</td>
                      <td className="p-2 align-top font-mono text-[11px]">{r.moduleId ?? '—'}</td>
                      <td className="p-2 align-top max-w-[280px]">
                        <div className="break-words text-[11px]">{r.detail ?? '—'}</div>
                        {r.meta?.stack != null ? (
                          <pre className="mt-1 text-[10px] text-red-400/90 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
                            {String(r.meta.stack).slice(0, 800)}
                          </pre>
                        ) : null}
                      </td>
                      <td className="p-2 align-top text-[11px] max-w-[320px] text-gray-400">{formatCtx(r, language)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className={cn('text-[11px]', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>{t('activity_footer_note')}</p>
      </div>
    </div>
  );
}
