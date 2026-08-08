import React from 'react';
import { X, AlertTriangle, Package, FileText, DollarSign } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AppTheme } from '../../lib/shellTheme';

type Props = {
  itemCode: string;
  itemDescription: string;
  linkCount: number;
  consumptionCount: number;
  actualCostCount: number;
  language: 'ar' | 'en';
  theme: AppTheme;
  onClose: () => void;
};

export function DeleteBlockedModal({
  itemCode,
  itemDescription,
  linkCount,
  consumptionCount,
  actualCostCount,
  language,
  theme,
  onClose,
}: Props) {
  const ar = language === 'ar';
  const isDark = theme === 'dark';

  const panel = cn(
    'rounded-xl border shadow-2xl max-w-md w-full flex flex-col',
    isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
  );

  const reasons = [
    {
      show: linkCount > 0,
      icon: Package,
      color: 'text-emerald-500',
      bgColor: isDark ? 'bg-emerald-500/10' : 'bg-emerald-50',
      labelAr: 'مربوط بأصناف مخزون',
      labelEn: 'Linked to materials',
      count: linkCount,
    },
    {
      show: consumptionCount > 0,
      icon: FileText,
      color: 'text-red-500',
      bgColor: isDark ? 'bg-red-500/10' : 'bg-red-50',
      labelAr: 'أوامر صرف مسجلة',
      labelEn: 'Consumption orders',
      count: consumptionCount,
    },
    {
      show: actualCostCount > 0,
      icon: DollarSign,
      color: 'text-orange-500',
      bgColor: isDark ? 'bg-orange-500/10' : 'bg-orange-50',
      labelAr: 'تكاليف فعلية',
      labelEn: 'Actual costs',
      count: actualCostCount,
    },
  ].filter((r) => r.show);

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className={panel}>
        {/* Header */}
        <div className={cn('p-5 border-b', isDark ? 'border-gray-700' : 'border-gray-200')}>
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-1">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="text-red-500" size={20} />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-lg mb-1">
                {ar ? 'لا يمكن حذف هذا البند' : 'Cannot delete this item'}
              </h3>
              <p className={cn('text-sm', isDark ? 'text-gray-400' : 'text-gray-600')}>
                {itemCode} — {itemDescription}
              </p>
            </div>
            <button
              onClick={onClose}
              className={cn(
                'flex-shrink-0 p-1 rounded-lg transition-colors',
                isDark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'
              )}
              aria-label={ar ? 'إغلاق' : 'Close'}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <p className={cn('text-sm', isDark ? 'text-gray-300' : 'text-gray-700')}>
            {ar
              ? 'هذا البند مرتبط ببيانات أخرى في النظام:'
              : 'This item is linked to other data in the system:'}
          </p>

          <div className="space-y-2">
            {reasons.map((reason, idx) => {
              const Icon = reason.icon;
              return (
                <div
                  key={idx}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-lg border',
                    reason.bgColor,
                    isDark ? 'border-gray-700' : 'border-gray-200'
                  )}
                >
                  <div className="flex-shrink-0">
                    <Icon className={reason.color} size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {ar ? reason.labelAr : reason.labelEn}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    <span
                      className={cn(
                        'px-2.5 py-0.5 rounded-full text-xs font-bold',
                        isDark ? 'bg-gray-800 text-gray-300' : 'bg-white text-gray-700'
                      )}
                    >
                      {reason.count}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className={cn('p-3 rounded-lg text-sm', isDark ? 'bg-amber-500/10' : 'bg-amber-50')}>
            <p className={cn('font-medium mb-1', isDark ? 'text-amber-300' : 'text-amber-800')}>
              {ar ? '💡 ماذا يمكنك فعله؟' : '💡 What can you do?'}
            </p>
            <ul className={cn('text-xs space-y-1 mr-4', isDark ? 'text-amber-200/80' : 'text-amber-700')}>
              <li>
                {ar
                  ? '• احذف الروابط وأوامر الصرف المرتبطة أولاً'
                  : '• Delete linked materials and consumption orders first'}
              </li>
              <li>
                {ar
                  ? '• أو اترك البند كما هو (لن يظهر في التقارير الجديدة)'
                  : '• Or leave the item as is (won\'t appear in new reports)'}
              </li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className={cn('p-4 border-t', isDark ? 'border-gray-700' : 'border-gray-200')}>
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
          >
            {ar ? 'تم' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}
