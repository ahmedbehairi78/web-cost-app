import React from 'react';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../context/LanguageContext';
import type { Theme } from './inventoryUiShared';

export function InventorySetupGuide({ theme }: { theme: Theme }) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const steps = ar
    ? [
        { n: '1', title: 'شجرة الأصناف', body: 'من تبويب «الأصناف» هنا أو من أسفل موديول المشاريع — أنشئ مجموعات وأصناف المواد.' },
        { n: '2', title: 'ربط BOQ', body: 'في جدول الكميات → زر الحزمة على البند — اختر الأصناف المسموح صرفها لهذا البند.' },
        { n: '3', title: 'فاتورة موزعة', body: 'التكاليف الفعلية → فاتورة مشتريات → اختر الصنف لكل بند واحفظ بحالة مؤكدة لتسجيل الوارد في المخزون.' },
        { n: '4', title: 'صرف وتحويل', body: 'من رصيد المخزون: «أمر صرف جديد» أو «صرف» على صف؛ من تبويب التحويلات: نقل بين العقود.' },
      ]
    : [
        { n: '1', title: 'Materials tree', body: 'Use the Materials tab here (or Projects module) to define groups and categories.' },
        { n: '2', title: 'Link BOQ', body: 'In BOQ → Package on a line → pick allowed materials for that item.' },
        { n: '3', title: 'Distributed invoice', body: 'Actual Costs → purchase invoice → material per line → save as confirmed to post stock.' },
        { n: '4', title: 'Issue & return', body: 'Balance tab: consumption order; History tab: returns. Legacy contract transfers are frozen.' },
      ];

  return (
    <div
      className={cn(
        'mb-6 rounded-xl border p-5 space-y-3',
        theme === 'dark' ? 'border-blue-800/50 bg-blue-950/30' : 'border-blue-200 bg-blue-50/80',
      )}
    >
      <p className={cn('text-sm font-bold', theme === 'dark' ? 'text-blue-300' : 'text-blue-800')}>
        {ar ? 'لا يوجد رصيد مخزون بعد — اتبع الخطوات:' : 'No inventory balance yet — follow these steps:'}
      </p>
      <ol className="space-y-2">
        {steps.map((s) => (
          <li key={s.n} className={cn('text-sm flex gap-3', theme === 'dark' ? 'text-gray-300' : 'text-gray-700')}>
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
              {s.n}
            </span>
            <span>
              <span className="font-semibold">{s.title}: </span>
              {s.body}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
