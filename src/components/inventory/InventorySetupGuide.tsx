import React from 'react';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../context/LanguageContext';
import type { Theme } from './inventoryUiShared';

export function InventorySetupGuide({ theme }: { theme: Theme }) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const steps = ar
    ? [
        { n: '1', title: 'شجرة الأصناف', body: 'من تبويب «الأصناف» عرّف المجموعات والأصناف. عمود الرصيد في ذلك الملف يُتجاهل.' },
        { n: '2', title: 'حساب مخزن 127', body: 'من هذه الشاشة: «إضافة مخزن» أو ربط حساب 127… بالمشروع — بدون ذلك زر استيراد الأرصدة يبقى معطّلاً.' },
        { n: '3', title: 'أرصدة افتتاحية', body: 'من الشريط الجانبي: نزّل «قالب أرصدة افتتاحية» (كود الصنف · الكمية · متوسط التكلفة) ثم «استيراد أرصدة افتتاحية» لهذا المشروع فقط.' },
        { n: '4', title: 'صرف وتحويل', body: 'بعد ظهور الرصيد: «أمر صرف جديد» أو تبويب التحويلات. فاتورة المشتريات تسجّل الوارد اللاحق.' },
      ]
    : [
        { n: '1', title: 'Materials tree', body: 'Use the Materials tab to define groups and categories. The Balance column in that file is ignored.' },
        { n: '2', title: '127 warehouse account', body: 'On this screen: Add Warehouse or link a 127… account to the project — otherwise opening-balance import stays disabled.' },
        { n: '3', title: 'Opening balances', body: 'Sidebar: download the opening-balances template (Category Code · Quantity · Avg Unit Cost) then Import opening balances for this project only.' },
        { n: '4', title: 'Issue & transfer', body: 'After stock appears: new consumption order or Transfers tab. Later receipts go through purchase invoices.' },
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
