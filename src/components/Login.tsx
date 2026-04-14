import React from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { LogIn, Briefcase, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';

export function Login() {
  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Login error:', error);
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

          <div className="w-full space-y-4 pt-4">
            <button
              onClick={handleLogin}
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 text-black font-bold py-3 px-6 rounded-xl transition-all duration-200"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
              الدخول بواسطة جوجل
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
