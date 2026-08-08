import React, { useCallback, useState } from 'react';
import { Loader2, ShieldCheck, X } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  canVerifyAdminWithGoogle,
  canVerifyAdminWithPassword,
  verifyAdministratorIdentity,
} from '../lib/adminIdentityVerification';
import toast from 'react-hot-toast';
import { ApiError } from '../lib/apiClient';
import { SettingsFloatingDialog } from './settings/SettingsFloatingDialog';

type Lang = 'ar' | 'en';

export interface AdminSensitiveVerifyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: Lang;
  theme: string;
  /** Runs after identity verification succeeds. */
  onVerified: () => Promise<void>;
}

export function AdminSensitiveVerifyModal({
  open,
  onOpenChange,
  language,
  theme,
  onVerified,
}: AdminSensitiveVerifyModalProps) {
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');

  const showGoogle = canVerifyAdminWithGoogle();
  const showPassword = canVerifyAdminWithPassword();
  const passwordOnly = showPassword && !showGoogle;

  const handleClose = useCallback(() => {
    if (busy) return;
    setPassword('');
    onOpenChange(false);
  }, [busy, onOpenChange]);

  const handleSubmit = useCallback(
    async (viaGoogle: boolean) => {
      setBusy(true);
      try {
        await verifyAdministratorIdentity(viaGoogle ? undefined : { password });
        setPassword('');
        await onVerified();
        onOpenChange(false);
      } catch (e: unknown) {
        const err = e as { code?: string; message?: string };
        const status = e instanceof ApiError ? e.status : undefined;
        if (
          err.code === 'auth/popup-closed-by-user' ||
          err.code === 'auth/cancelled-popup-request'
        ) {
          // User dismissed the Google popup — not an error worth toasting
        } else if (err.code === 'auth/network-request-failed') {
          toast.error(
            language === 'ar'
              ? 'تعذّر الاتصال بالشبكة. تحقق من اتصالك وأعد المحاولة.'
              : 'Network error. Check your connection and try again.',
          );
        } else if (err.message === 'PASSWORD_REQUIRED') {
          toast.error(
            language === 'ar' ? 'أدخل كلمة مرور تسجيل الدخول.' : 'Enter your login password.',
          );
        } else if (status === 401) {
          toast.error(
            language === 'ar' ? 'كلمة المرور غير صحيحة.' : 'Incorrect password.',
          );
        } else if (status === 403) {
          toast.error(
            language === 'ar'
              ? 'كلمة المرور غير مفعّلة لهذا الحساب — استخدم Google.'
              : 'Password login not configured — use Google verification.',
          );
        } else {
          toast.error(
            language === 'ar'
              ? 'فشل التحقق. حاول مجدداً.'
              : 'Verification failed. Try again.',
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [language, onOpenChange, onVerified, password],
  );

  const panelCls = cn(
    'w-full max-w-md rounded-2xl border shadow-2xl p-6 space-y-5',
    theme === 'dark' ? 'bg-[#1a1d23] border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900',
  );

  return (
    <SettingsFloatingDialog
      open={open}
      theme={theme}
      dir={language === 'ar' ? 'rtl' : 'ltr'}
      layer="stack"
      closeOnBackdrop={!busy}
      onClose={handleClose}
      panelClassName="max-w-md"
    >
      <div className={panelCls}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-amber-400">
            <ShieldCheck size={22} />
            <h3 className="text-lg font-bold">
              {language === 'ar' ? 'تأكيد هوية مدير النظام' : 'Confirm Administrator Identity'}
            </h3>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="text-gray-400 hover:text-gray-200 disabled:opacity-50"
            aria-label={language === 'ar' ? 'إغلاق' : 'Close'}
          >
            <X size={20} />
          </button>
        </div>

        <div
          className={cn(
            'flex items-start gap-3 rounded-xl px-4 py-3 text-sm',
            theme === 'dark'
              ? 'bg-amber-900/20 border border-amber-700/40 text-amber-300'
              : 'bg-amber-50 border border-amber-200 text-amber-800',
          )}
        >
          <ShieldCheck size={16} className="shrink-0 mt-0.5" />
          <p>
            {passwordOnly
              ? (language === 'ar'
                ? 'هذا الإجراء حساس. أدخل كلمة مرور تسجيل الدخول للمتابعة.'
                : 'This is a sensitive operation. Enter your login password to continue.')
              : showGoogle && showPassword
                ? (language === 'ar'
                  ? 'هذا الإجراء حساس. أكّد عبر Google أو كلمة مرور تسجيل الدخول.'
                  : 'This is sensitive. Confirm via Google or your login password.')
                : (language === 'ar'
                  ? 'هذا الإجراء حساس. ستظهر نافذة Google للتأكيد.'
                  : 'This is sensitive. A Google re-authentication popup will appear.')}
          </p>
        </div>

        {showPassword && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-400">
              {language === 'ar' ? 'كلمة المرور' : 'Password'}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              autoComplete="current-password"
              placeholder={language === 'ar' ? 'كلمة مرور تسجيل الدخول' : 'Login password'}
              className={cn(
                'w-full border rounded-xl py-2.5 px-3 text-sm outline-none transition-colors',
                theme === 'dark'
                  ? 'bg-gray-900 border-gray-700 focus:border-amber-500'
                  : 'bg-white border-gray-300 focus:border-amber-500',
              )}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && password.trim()) void handleSubmit(false);
              }}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-3 justify-end">
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-bold transition-colors',
              theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200',
            )}
          >
            {language === 'ar' ? 'إلغاء' : 'Cancel'}
          </button>
          {showPassword && (
            <button
              type="button"
              onClick={() => void handleSubmit(false)}
              disabled={busy || !password.trim()}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900/50 disabled:text-amber-900 text-white transition-colors"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              {language === 'ar' ? 'تأكيد بكلمة المرور' : 'Verify with password'}
            </button>
          )}
          {showGoogle && (
            <button
              type="button"
              onClick={() => void handleSubmit(true)}
              disabled={busy}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900 text-white transition-colors"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              {language === 'ar' ? 'تأكيد عبر Google' : 'Verify via Google'}
            </button>
          )}
        </div>
      </div>
    </SettingsFloatingDialog>
  );
}
