import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { logClientError } from '../services/activityLogService';
import { isChunkLoadError } from '../lib/lazyImport';
import { applyHostedSpaUpdate, markSpaUpdateAvailable } from '../lib/spaBuild';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    if (isChunkLoadError(error)) {
      markSpaUpdateAvailable();
    }
    logClientError('boundary', error, {
      componentStack: errorInfo.componentStack?.slice(0, 4000),
    });
  }

  public render() {
    if (this.state.hasError) {
      const chunkError = isChunkLoadError(this.state.error);
      return this.props.fallback || (
        <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-8 text-center text-white">
          <div className="w-20 h-20 bg-red-900/20 rounded-full flex items-center justify-center mb-6">
            <AlertTriangle className="text-red-500" size={40} />
          </div>
          <h1 className="text-2xl font-bold mb-4">
            {chunkError ? 'يتوفر تحديث جديد للتطبيق' : 'حدث خطأ غير متوقع'}
          </h1>
          <p className="text-gray-400 max-w-md mb-8">
            {chunkError
              ? 'حدّث الآن لإعادة تحميل الواجهة ثم شاشة الدخول. لن يُغلق التطبيق من تلقاء نفسه.'
              : 'عذراً، واجه النظام مشكلة تقنية. يرجى محاولة إعادة تحميل الصفحة.'}
          </p>
          <div className="bg-gray-900 p-4 rounded-lg text-left font-mono text-xs text-red-400 max-w-2xl overflow-auto mb-8">
            {this.state.error?.toString()}
          </div>
          <button 
            onClick={() => {
              if (chunkError) void applyHostedSpaUpdate();
              else window.location.reload();
            }}
            className="bg-blue-600 hover:bg-blue-500 px-8 py-3 rounded-xl font-bold transition-all"
          >
            {chunkError ? 'تحديث الآن' : 'إعادة تحميل الصفحة'}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
