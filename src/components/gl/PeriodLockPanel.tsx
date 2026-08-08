import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Lock, Shield, Unlock, UserPlus, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../context/LanguageContext';
import { usePermissions } from '../../context/PermissionsContext';
import { authApi } from '../../services/local/authApi';
import {
  accountingPeriodsApi,
  type AccountingPeriodLockRow,
} from '../../services/local/modulesApi';
import { ApiError } from '../../lib/apiClient';
import type { AppUser } from '../../types';
import { periodRangeForCadence } from '../../lib/accountingPeriodCadence';

type Props = {
  theme: string;
  compact?: boolean;
};

function shiftQuarter(ref: Date, delta: number): Date {
  const d = new Date(ref.getFullYear(), ref.getMonth(), 1);
  d.setMonth(d.getMonth() + delta * 3);
  return d;
}

export function PeriodLockPanel({ theme, compact = false }: Props) {
  const { t, dir } = useLanguage();
  const { isAdmin } = usePermissions();
  const [periods, setPeriods] = useState<AccountingPeriodLockRow[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [quarterRef, setQuarterRef] = useState(() => new Date());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftAllowed, setDraftAllowed] = useState<string[]>([]);

  const suggested = useMemo(() => periodRangeForCadence('quarterly', quarterRef), [quarterRef]);

  const cardCls = cn(
    compact ? 'rounded-xl border p-3' : 'rounded-2xl border p-5',
    theme === 'dark' ? 'border-gray-800 bg-gray-900/40' : theme === 'soft' ? 'border-[#cfd8dc] bg-white' : 'border-gray-200 bg-white',
  );
  const btnCls = cn(
    'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold disabled:opacity-50',
    compact ? 'px-2 py-1 text-[11px]' : '',
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, dirRes] = await Promise.all([
        accountingPeriodsApi.list(),
        isAdmin ? authApi.userDirectory().catch(() => ({ users: [] as AppUser[] })) : Promise.resolve({ users: [] as AppUser[] }),
      ]);
      setPeriods(Array.isArray(rows) ? rows : []);
      setUsers(Array.isArray(dirRes.users) ? dirRes.users.filter((u) => u.isPending !== true) : []);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('period_lock_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [isAdmin, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => periods.find((p) => p.id === selectedId) ?? null,
    [periods, selectedId],
  );

  useEffect(() => {
    if (selected) setDraftAllowed([...(selected.allowedUserIds ?? [])]);
    else setDraftAllowed([]);
  }, [selected]);

  const existingMatch = useMemo(
    () =>
      periods.find(
        (p) => p.periodStart === suggested.start && p.periodEnd === suggested.end,
      ) ?? null,
    [periods, suggested.start, suggested.end],
  );

  const userLabel = (u: AppUser) => u.displayName?.trim() || u.email;

  const handleLockCreate = async () => {
    if (!isAdmin) return;
    setBusyId('create');
    try {
      if (existingMatch) {
        if (existingMatch.status !== 'locked') {
          const row = await accountingPeriodsApi.lock(existingMatch.id);
          setPeriods((prev) => prev.map((p) => (p.id === row.id ? row : p)));
          setSelectedId(row.id);
          toast.success(t('period_lock_locked_ok'));
        } else {
          setSelectedId(existingMatch.id);
          toast.success(t('period_lock_already_locked'));
        }
      } else {
        const row = await accountingPeriodsApi.create({
          label: suggested.label,
          periodStart: suggested.start,
          periodEnd: suggested.end,
        });
        setPeriods((prev) => [row, ...prev]);
        setSelectedId(row.id);
        toast.success(t('period_lock_locked_ok'));
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('period_lock_action_failed'));
    } finally {
      setBusyId(null);
    }
  };

  const handleUnlock = async (id: string) => {
    if (!isAdmin) return;
    setBusyId(id);
    try {
      const row = await accountingPeriodsApi.unlock(id);
      setPeriods((prev) => prev.map((p) => (p.id === row.id ? row : p)));
      toast.success(t('period_lock_unlocked_ok'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('period_lock_action_failed'));
    } finally {
      setBusyId(null);
    }
  };

  const handleRelock = async (id: string) => {
    if (!isAdmin) return;
    setBusyId(id);
    try {
      const row = await accountingPeriodsApi.lock(id);
      setPeriods((prev) => prev.map((p) => (p.id === row.id ? row : p)));
      toast.success(t('period_lock_locked_ok'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('period_lock_action_failed'));
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveAllowed = async () => {
    if (!isAdmin || !selected) return;
    setBusyId(selected.id);
    try {
      const row = await accountingPeriodsApi.setAllowedUsers(selected.id, draftAllowed);
      setPeriods((prev) => prev.map((p) => (p.id === row.id ? row : p)));
      toast.success(t('period_lock_allowed_saved'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('period_lock_action_failed'));
    } finally {
      setBusyId(null);
    }
  };

  const toggleUser = (userId: string) => {
    setDraftAllowed((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  return (
    <div className={cardCls} dir={dir}>
      <div className={cn('flex items-start gap-2', compact ? 'mb-2' : 'mb-4')}>
        <div
          className={cn(
            'p-1.5 rounded-lg shrink-0',
            theme === 'dark' ? 'bg-amber-900/30 text-amber-400' : 'bg-amber-50 text-amber-700',
          )}
        >
          <Shield size={compact ? 16 : 22} />
        </div>
        <div>
          <h3 className={cn('font-bold', compact ? 'text-sm' : 'text-lg')}>{t('period_lock_title')}</h3>
          <p className={cn('text-gray-500', compact ? 'text-[10px] mt-0.5 leading-snug' : 'text-sm mt-0.5')}>
            {t('period_lock_desc')}
          </p>
        </div>
      </div>

      {isAdmin && (
        <div
          className={cn(
            'rounded-xl border mb-3 space-y-2',
            compact ? 'p-2' : 'p-4 mb-4',
            theme === 'dark' ? 'border-gray-800 bg-gray-950/40' : 'border-gray-200 bg-gray-50/80',
          )}
        >
          <p className={cn('font-bold', compact ? 'text-[11px]' : 'text-sm')}>{t('period_lock_lock_quarter')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={cn(btnCls, 'border', theme === 'dark' ? 'border-gray-700' : 'border-gray-200')}
              onClick={() => setQuarterRef((d) => shiftQuarter(d, -1))}
            >
              ←
            </button>
            <div className={cn('font-mono', compact ? 'text-[11px]' : 'text-sm')}>
              <span className="font-bold">{suggested.label}</span>
              <span className="text-gray-500 ms-2">
                {suggested.start} → {suggested.end}
              </span>
            </div>
            <button
              type="button"
              className={cn(btnCls, 'border', theme === 'dark' ? 'border-gray-700' : 'border-gray-200')}
              onClick={() => setQuarterRef((d) => shiftQuarter(d, 1))}
            >
              →
            </button>
            <button
              type="button"
              disabled={busyId === 'create'}
              onClick={() => void handleLockCreate()}
              className={cn(btnCls, 'bg-amber-600 text-white ms-auto')}
            >
              {busyId === 'create' ? <Loader2 className="animate-spin" size={12} /> : <Lock size={12} />}
              {existingMatch?.status === 'locked' ? t('period_lock_select_existing') : t('period_lock_btn_lock')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <Loader2 className="animate-spin mx-auto my-6" />
      ) : periods.length === 0 ? (
        <p className="text-center text-gray-500 text-xs py-6">{t('period_lock_empty')}</p>
      ) : (
        <div className={cn('grid gap-3', compact ? 'grid-cols-1' : 'lg:grid-cols-2')}>
          <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
            {periods.map((p) => {
              const active = selectedId === p.id;
              const locked = p.status === 'locked';
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    'w-full text-start rounded-lg border px-2.5 py-2 transition',
                    active
                      ? locked
                        ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30'
                        : 'border-emerald-500 bg-emerald-500/10'
                      : theme === 'dark'
                        ? 'border-gray-800 hover:bg-gray-800/40'
                        : 'border-gray-200 hover:bg-gray-50',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('font-bold', compact ? 'text-[11px]' : 'text-sm')}>{p.label}</span>
                    <span
                      className={cn(
                        'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                        locked
                          ? 'bg-amber-500/20 text-amber-600'
                          : 'bg-emerald-500/20 text-emerald-600',
                      )}
                    >
                      {locked ? t('period_lock_status_locked') : t('period_lock_status_open')}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 font-mono mt-0.5">
                    {p.periodStart} → {p.periodEnd}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
                    <Users size={10} />
                    {(p.allowedUserIds ?? []).length} {t('period_lock_exceptions_count')}
                  </p>
                </button>
              );
            })}
          </div>

          <div
            className={cn(
              'rounded-xl border p-3',
              theme === 'dark' ? 'border-gray-800' : 'border-gray-200',
            )}
          >
            {!selected ? (
              <p className="text-xs text-gray-500 text-center py-8">{t('period_lock_select_period')}</p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-sm">{selected.label}</h4>
                    <p className="text-[11px] text-gray-500 font-mono">
                      {selected.periodStart} → {selected.periodEnd}
                    </p>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1.5">
                      {selected.status === 'locked' ? (
                        <button
                          type="button"
                          disabled={busyId === selected.id}
                          onClick={() => void handleUnlock(selected.id)}
                          className={cn(btnCls, 'border border-emerald-500 text-emerald-600')}
                        >
                          {busyId === selected.id ? (
                            <Loader2 className="animate-spin" size={12} />
                          ) : (
                            <Unlock size={12} />
                          )}
                          {t('period_lock_btn_unlock')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busyId === selected.id}
                          onClick={() => void handleRelock(selected.id)}
                          className={cn(btnCls, 'bg-amber-600 text-white')}
                        >
                          {busyId === selected.id ? (
                            <Loader2 className="animate-spin" size={12} />
                          ) : (
                            <Lock size={12} />
                          )}
                          {t('period_lock_btn_lock')}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-xs font-bold mb-1.5 flex items-center gap-1">
                    <UserPlus size={12} />
                    {t('period_lock_allowed_users')}
                  </p>
                  <p className="text-[10px] text-gray-500 mb-2">{t('period_lock_allowed_hint')}</p>
                  {!isAdmin ? (
                    <ul className="text-xs space-y-1">
                      {(selected.allowedUserIds ?? []).length === 0 ? (
                        <li className="text-gray-500">{t('period_lock_no_exceptions')}</li>
                      ) : (
                        (selected.allowedUserIds ?? []).map((uid) => {
                          const u = users.find((x) => x.id === uid);
                          return (
                            <li key={uid} className="font-mono text-[11px]">
                              {u ? userLabel(u) : uid}
                            </li>
                          );
                        })
                      )}
                    </ul>
                  ) : users.length === 0 ? (
                    <p className="text-xs text-gray-500">{t('period_lock_no_users')}</p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-1 border rounded-lg p-2">
                      {users.map((u) => {
                        const checked = draftAllowed.includes(u.id);
                        return (
                          <label
                            key={u.id}
                            className={cn(
                              'flex items-center gap-2 rounded-md px-2 py-1 text-xs cursor-pointer',
                              checked
                                ? theme === 'dark'
                                  ? 'bg-amber-900/20'
                                  : 'bg-amber-50'
                                : 'hover:bg-black/5',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleUser(u.id)}
                            />
                            <span className="truncate">{userLabel(u)}</span>
                            <span className="text-[10px] text-gray-400 ms-auto shrink-0">{u.role}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      disabled={busyId === selected.id}
                      onClick={() => void handleSaveAllowed()}
                      className={cn(btnCls, 'mt-2 bg-blue-600 text-white')}
                    >
                      {busyId === selected.id ? (
                        <Loader2 className="animate-spin" size={12} />
                      ) : null}
                      {t('period_lock_save_allowed')}
                    </button>
                  )}
                </div>

                {!isAdmin && (
                  <p className="text-[10px] text-amber-600">{t('period_lock_admin_only')}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
