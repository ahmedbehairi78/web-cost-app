import React, { useEffect, useState } from 'react';
import { signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { ShieldCheck, AlertCircle, Loader2, Mail, KeyRound } from 'lucide-react';
import { motion } from 'motion/react';
import { ConcordPlusLogoBuild } from './branding/ConcordPlusLogoBuild';
import { playTap } from '../lib/uiSound';
import { useLanguage } from '../context/LanguageContext';
import { isLocalBackend } from '../lib/dataBackend';
import { authApi } from '../services/local/authApi';
import { ApiError } from '../lib/apiClient';
import type { AppUser } from '../types';
import { cn } from '../lib/utils';
import {
  clearFreshLoginRequired,
  mustPasswordLogin,
  readLastLoginEmail,
  writeLastLoginEmail,
} from '../lib/sessionLogout';
import { isElectronShell } from '../lib/electronShell';

type LoginMode = 'google' | 'password';

function loginErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return '';
    case 'auth/network-request-failed':
      return 'تعذّر الاتصال بالشبكة. يرجى التحقق من الاتصال بالإنترنت والمحاولة مجدداً.';
    case 'auth/unauthorized-domain':
      return 'النطاق غير مسموح لتسجيل الدخول. افتح التطبيق من http://localhost:3000 (وليس عنوان IP الشبكة).';
    case 'auth/popup-blocked':
      return 'المتصفّح حظر نافذة Google. اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.';
    case 'auth/operation-not-allowed':
      return 'تسجيل الدخول بـ Google غير مفعّل في إعدادات Firebase لهذا المشروع.';
    case 'auth/invalid-api-key':
    case 'auth/app-not-authorized':
      return 'إعدادات Firebase غير صحيحة. تحقق من ملف .env (VITE_FIREBASE_*).';
    default:
      if (import.meta.env.DEV && code) {
        return `حدث خطأ أثناء تسجيل الدخول (${code}). راجع Console للتفاصيل.`;
      }
      return 'حدث خطأ أثناء تسجيل الدخول. يرجى المحاولة مجدداً.';
  }
}

interface LoginProps {
  onPasswordLogin: (user: AppUser) => void;
  /** Auth/session still initializing — show login card with breathing logo only */
  bootstrapping?: boolean;
  /** After sign-in, keep splash until the first module window opens */
  enteringApp?: boolean;
}

export function Login({ onPasswordLogin, bootstrapping = false, enteringApp = false }: LoginProps) {
  const { t, language } = useLanguage();
  const showPassword = isLocalBackend;
  const passwordOnly = mustPasswordLogin();
  const [mode, setMode] = useState<LoginMode>(() => (passwordOnly || showPassword ? 'password' : 'google'));
  const [error, setError] = useState<string | null>(() => {
    try {
      if (sessionStorage.getItem('web_cost_login_error') === 'session_sync_failed') {
        sessionStorage.removeItem('web_cost_login_error');
        return language === 'ar'
          ? 'تم تسجيل الدخول في Google لكن فشل ربط الجلسة مع الخادم. تحقق من Railway أو اطلب من المدير ترقية حسابك.'
          : 'Google sign-in succeeded but server session failed. Check Railway or ask an admin to activate your account.';
      }
    } catch {
      // ignore
    }
    return null;
  });
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState(() => readLastLoginEmail());
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!passwordOnly) return;
    void signOut(auth).catch(() => undefined);
  }, [passwordOnly]);

  const handleGoogleLogin = async () => {
    if (passwordOnly) {
      setError(isElectronShell() ? t('login_desktop_password_only') : t('login_fresh_required_hint'));
      return;
    }
    playTap();
    setError(null);
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: unknown) {
      const msg = loginErrorMessage(err);
      if (msg) {
        setError(msg);
        console.error('Login error:', err);
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    playTap();
    setError(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setError(t('login_credentials_required'));
      return;
    }
    setLoading(true);
    try {
      try {
        await signOut(auth);
      } catch {
        /* ignore */
      }
      const appUser = await authApi.login(cleanEmail, password);
      writeLastLoginEmail(cleanEmail);
      clearFreshLoginRequired();
      setPassword('');
      onPasswordLogin(appUser);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        const code = (err.payload as { error?: string })?.error;
        if (err.status === 401) {
          if (code === 'password_not_configured') {
            setError(t('login_password_not_configured'));
          } else {
            setError(t('login_invalid_credentials'));
          }
        } else if (err.status === 429) {
          setError(t('login_too_many_attempts'));
        } else if (err.status === 403 && code === 'user_inactive') {
          setError(t('login_user_inactive'));
        } else {
          setError(t('login_server_error'));
        }
      } else {
        setError(t('login_server_unreachable'));
      }
      console.error('Password login error:', err);
    } finally {
      setLoading(false);
    }
  };

  const splashMode = bootstrapping || enteringApp;
  const showLogoPulse = splashMode || loading;

  const inputCls = cn(
    'w-full rounded-xl border py-2.5 px-4 text-sm outline-none shell-transition',
    language === 'ar' ? 'text-right' : 'text-left',
    'bg-white border-[var(--erp-border)] text-[var(--erp-text)] focus:border-[var(--erp-primary)] focus:ring-2 focus:ring-[var(--erp-accent-warm)]/25',
  );

  const primaryBtnCls =
    'w-full flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed font-bold py-3 px-6 rounded-xl shell-transition bg-[var(--erp-primary)] hover:bg-[var(--erp-primary-hover)] text-white erp-btn-primary';

  return (
    <div
      className="login-screen fixed inset-0 z-[9999] flex items-center justify-center p-4 shell-transition"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      <motion.div
        initial={{ opacity: bootstrapping ? 1 : 0, y: bootstrapping ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: bootstrapping ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 max-w-md w-full rounded-2xl p-8 shadow-2xl shell-transition bg-white border border-[var(--erp-border)] shadow-[var(--erp-primary)]/10 erp-animate-rise-in"
      >
        <div className="flex flex-col items-center text-center space-y-6">
          <ConcordPlusLogoBuild
            showTagline
            pulsing={showLogoPulse}
            skipBuild={enteringApp || loading}
          />

          <div>
            <h1 className="text-2xl font-bold text-[var(--erp-primary)]">{t('login_title')}</h1>
            <p className="mt-2 text-sm text-[var(--erp-text-muted)]">{t('login_subtitle')}</p>
          </div>

          {!splashMode && passwordOnly && showPassword && (
            <div className="w-full flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg px-4 py-3 text-right">
              <ShieldCheck size={16} className="shrink-0 text-amber-700" />
              <span>{isElectronShell() ? t('login_desktop_password_only') : t('login_fresh_required_hint')}</span>
            </div>
          )}

          {!splashMode && showPassword && !passwordOnly && (
            <div className="w-full flex rounded-xl p-1 border bg-[var(--erp-nav-hover)] border-[var(--erp-border)]">
              <button
                type="button"
                onClick={() => { playTap(); setMode('password'); setError(null); }}
                className={cn(
                  'flex-1 py-2 text-sm font-medium rounded-lg shell-transition',
                  mode === 'password'
                    ? 'bg-[var(--erp-primary)] text-white'
                    : 'text-[var(--erp-primary)] hover:bg-white/60',
                )}
              >
                {t('login_mode_password')}
              </button>
              <button
                type="button"
                onClick={() => { playTap(); setMode('google'); setError(null); }}
                className={cn(
                  'flex-1 py-2 text-sm font-medium rounded-lg shell-transition',
                  mode === 'google'
                    ? 'bg-[var(--erp-primary)] text-white'
                    : 'text-[var(--erp-primary)] hover:bg-white/60',
                )}
              >
                {t('login_mode_google')}
              </button>
            </div>
          )}

          {!splashMode && error && (
            <div className="w-full flex items-center gap-2 bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 text-right">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!splashMode && mode === 'password' && showPassword ? (
            <form onSubmit={(e) => void handlePasswordLogin(e)} className="w-full space-y-3">
              <div className="relative">
                <Mail size={16} className="absolute top-3 start-3 text-gray-500" />
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('login_email_placeholder')}
                  className={cn(inputCls, 'ps-10')}
                  disabled={loading}
                />
              </div>
              <div className="relative">
                <KeyRound size={16} className="absolute top-3 start-3 text-gray-500" />
                <input
                  type="password"
                  autoComplete={passwordOnly ? 'off' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('login_password_placeholder')}
                  className={cn(inputCls, 'ps-10')}
                  disabled={loading}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className={primaryBtnCls}
                data-no-global-ui-sound
              >
                {loading ? <Loader2 size={20} className="animate-spin" /> : null}
                {loading ? t('login_signing_in') : t('login_sign_in')}
              </button>
            </form>
          ) : !splashMode && !passwordOnly ? (
            <button
              type="button"
              onClick={() => void handleGoogleLogin()}
              disabled={loading}
              data-no-global-ui-sound
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed text-black font-bold py-3 px-6 rounded-xl transition-all duration-200 border border-[#DEE2E6]"
            >
              {loading ? (
                <Loader2 size={20} className="animate-spin text-gray-600" />
              ) : (
                <img
                  src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                  alt="Google"
                  className="w-5 h-5"
                />
              )}
              {loading ? t('login_signing_in') : t('login_google_button')}
            </button>
          ) : null}

          {enteringApp && (
            <p className="text-sm text-[#6c757d] flex items-center gap-2">
              <Loader2 size={16} className="animate-spin shrink-0" />
              {t('login_signing_in')}
            </p>
          )}

          {!splashMode && (
            <div className="flex items-center gap-2 text-[10px] text-gray-500 pt-2">
              <ShieldCheck size={14} />
              <span>{t('login_admin_approval_hint')}</span>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
