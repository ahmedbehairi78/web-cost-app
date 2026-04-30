import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { LogIn, Briefcase, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

export function Login() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        // User closed the popup — not an error worth showing
      } else if (err.code === 'auth/network-request-failed') {
        setError('تعذّر الاتصال بالشبكة. يرجى التحقق من الاتصال بالإنترنت والمحاولة مجدداً.');
      } else {
        setError('حدث خطأ أثناء تسجيل الدخول. يرجى المحاولة مجدداً.');
        console.error('Login error:', err);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-full bg-[#0a0a0a] flex items-center justify-center p-4" dir="rtl">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full bg-[#151619] border border-gray-800 rounded-2xl p-8 shadow-2xl"
      >
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-900/20">
            <Briefcase size={32} className="text-white" />
          </div>

          <div>
            <h1 className="text-2xl font-bold text-white">نظام إدارة تكاليف الإنشاءات</h1>
            <p className="text-gray-400 mt-2 text-sm">سجل الدخول للوصول إلى لوحة التحكم والتقارير المالية</p>
          </div>

          {error && (
            <div className="w-full flex items-center gap-2 bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="w-full space-y-4 pt-4">
            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed text-black font-bold py-3 px-6 rounded-xl transition-all duration-200"
            >
              {loading ? (
                <Loader2 size={20} className="animate-spin text-gray-600" />
              ) : (
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
              )}
              {loading ? 'جاري تسجيل الدخول...' : 'الدخول بواسطة جوجل'}
            </button>
          </div>

          <div className="flex items-center gap-2 text-[10px] text-gray-500 pt-4">
            <ShieldCheck size={14} />
            <span>نظام مؤمن ومشفر وفقاً للمعايير الدولية</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
