/** Shared helpers for long-running UI operations (imports, backup, etc.). */

import { ApiError } from './apiClient';
import { NetworkQueuedError } from './offline/enqueueOrExecute';
import { isIdleLockedDocument } from './idleActivityBridge';
import { isBrowserOnline } from './offline/networkStatus';

let longRunningOperationDepth = 0;

/** While > 0, idle lock is suppressed (imports, backup, etc.). */
export function beginLongRunningOperation(): void {
  longRunningOperationDepth += 1;
}

export function endLongRunningOperation(): void {
  longRunningOperationDepth = Math.max(0, longRunningOperationDepth - 1);
}

export function isLongRunningOperationActive(): boolean {
  return longRunningOperationDepth > 0;
}

export type OperationProgressEntry = {
  id: string;
  label: string;
  message?: string;
  current: number;
  /** `null` = indeterminate (spinner bar). */
  total: number | null;
};

export function operationProgressPct(current: number, total: number | null): number | null {
  if (total == null || total <= 0) return null;
  return Math.min(100, Math.round((current / total) * 100));
}

export function formatOperationProgressCount(
  current: number,
  total: number | null,
  language: string,
): string | null {
  if (total == null || total <= 0) return null;
  const pct = operationProgressPct(current, total);
  if (language === 'ar') {
    return pct != null ? `${current} / ${total} (${pct}٪)` : `${current} / ${total}`;
  }
  return pct != null ? `${current} / ${total} (${pct}%)` : `${current} / ${total}`;
}

/** Yield so React can paint progress bar updates during long loops. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}

export function resolveImportFailureReason(error: unknown, language: string): string {
  if (isIdleLockedDocument()) {
    return language === 'ar'
      ? 'قفل الخمول — أدخل كلمة المرور ثم أعد الاستيراد'
      : 'Idle lock — sign in and retry the import';
  }
  if (typeof navigator !== 'undefined' && !isBrowserOnline()) {
    return language === 'ar' ? 'انقطاع الاتصال بالإنترنت' : 'No network connection';
  }
  if (error instanceof NetworkQueuedError) {
    return language === 'ar'
      ? 'انقطاع الشبكة أثناء الحفظ'
      : 'Network lost while saving';
  }
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return language === 'ar'
        ? 'انتهت الجلسة أو رُفض الطلب'
        : 'Session expired or request denied';
    }
    if (error.status >= 500) {
      return language === 'ar' ? 'خطأ من الخادم' : 'Server error';
    }
    if (error.message) return error.message;
  }
  if (error instanceof Error && error.message === 'OFFLINE') {
    return language === 'ar' ? 'انقطاع الاتصال بالإنترنت' : 'No network connection';
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return language === 'ar' ? 'خطأ غير متوقع' : 'Unexpected error';
}

export function formatPartialImportMessage(
  language: string,
  done: number,
  total: number,
  failedItemCode: string | undefined,
  reason: string,
): string {
  const head =
    language === 'ar'
      ? `توقّف الاستيراد — تم ${done} من ${total}`
      : `Import stopped — ${done} of ${total} completed`;
  const at =
    failedItemCode && failedItemCode.trim()
      ? language === 'ar'
        ? ` · توقّف عند البند: ${failedItemCode.trim()}`
        : ` · stopped at item: ${failedItemCode.trim()}`
      : '';
  const why = language === 'ar' ? ` · السبب: ${reason}` : ` · Reason: ${reason}`;
  return `${head}${at}${why}`;
}
