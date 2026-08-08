import type { ReportDocColumn, ReportDocRow } from './types';

type Lang = 'ar' | 'en';

function isAr(language: Lang) {
  return language === 'ar';
}

function moneyLabel(n: number, isCost: boolean): number {
  // Keep signed numbers for money columns; costs shown as positive amounts in print
  return isCost ? Math.abs(n) : Math.abs(n);
}

export type IncomePrintAccount = {
  accountCode?: string;
  accountName?: string;
  accountNameEn?: string;
  isGroup?: boolean;
};

export type IncomePrintGl = {
  revenue: number;
  contractCosts: number;
  grossContractProfit: number;
  gaExpenses: number;
  financeExpenses: number;
  profitBeforeTax: number;
  leafBalances: Record<string, number>;
};

/**
 * Build income statement rows matching on-screen GL P&L (with optional analytical leaves).
 */
export function buildIncomeStatementPrintRows(opts: {
  language: Lang;
  showAnalytical: boolean;
  glPnL: IncomePrintGl;
  accounts: IncomePrintAccount[];
  billingFallbackRevenue?: number;
}): { columns: ReportDocColumn[]; rows: ReportDocRow[] } {
  const ar = isAr(opts.language);
  const columns: ReportDocColumn[] = [
    { key: 'label', header: ar ? 'البند' : 'Item', width: 55, align: ar ? 'right' : 'left' },
    { key: 'amount', header: ar ? 'المبلغ' : 'Amount', width: 25, align: 'right', money: true },
  ];

  const rows: ReportDocRow[] = [];
  const { glPnL, accounts, showAnalytical } = opts;
  const baseRevenue =
    glPnL.revenue > 0.005 ? glPnL.revenue : Number(opts.billingFallbackRevenue || 0);

  const pushSection = (label: string) => {
    rows.push({ label, amount: '' });
  };
  const pushTotal = (label: string, amount: number, isCost = false) => {
    rows.push({
      label,
      amount: Math.abs(amount) < 0.005 ? null : isCost ? -Math.abs(amount) : Math.abs(amount),
    });
  };
  const pushLeaf = (prefix: string, isCost: boolean) => {
    if (!showAnalytical) return;
    accounts
      .filter((a) => !a.isGroup && String(a.accountCode || '').trim().startsWith(prefix))
      .forEach((acc) => {
        const code = String(acc.accountCode ?? '').trim();
        const net = glPnL.leafBalances[code] || 0;
        if (Math.abs(net) < 0.005) return;
        const display = isCost ? net : -net;
        const name = ar
          ? acc.accountName || code
          : acc.accountNameEn || acc.accountName || code;
        rows.push({
          label: `  ${code} — ${name}`,
          amount: isCost ? -Math.abs(display) : Math.abs(display),
        });
      });
  };

  const hasLeafBal = (prefix: string) =>
    accounts.some((a) => {
      const code = String(a.accountCode || '').trim();
      return !a.isGroup && code.startsWith(prefix) && Math.abs(glPnL.leafBalances[code] || 0) > 0.005;
    });

  pushSection(ar ? 'الإيرادات' : 'Revenue');
  pushLeaf('4', false);
  if (glPnL.revenue < 0.005 && (opts.billingFallbackRevenue || 0) > 0.005) {
    rows.push({
      label: ar ? '  إيرادات المستخلصات (استحقاق)' : '  Billing Revenue (Accrual)',
      amount: opts.billingFallbackRevenue,
    });
  }
  pushTotal(ar ? 'مجموع الإيرادات' : 'Total Revenue', baseRevenue);

  pushSection(ar ? 'تكاليف العقود' : 'Contract Costs');
  if (hasLeafBal('511') && showAnalytical) {
    rows.push({ label: ar ? '  تكاليف مباشرة' : '  Direct Costs', amount: '' });
  }
  pushLeaf('511', true);
  if (hasLeafBal('512') && showAnalytical) {
    rows.push({ label: ar ? '  تكاليف غير مباشرة للموقع' : '  Indirect Site Costs', amount: '' });
  }
  pushLeaf('512', true);
  pushTotal(ar ? 'مجموع تكاليف العقود' : 'Total Contract Costs', glPnL.contractCosts, true);
  pushTotal(ar ? 'مجمل ربح العقود' : 'Gross Profit on Contracts', glPnL.grossContractProfit);

  const showGa = glPnL.gaExpenses > 0.005 || hasLeafBal('521') || hasLeafBal('522');
  if (showGa) {
    pushSection(ar ? 'المصروفات العمومية والإدارية' : 'General & Administrative Expenses');
    if (hasLeafBal('521') && showAnalytical) {
      rows.push({ label: ar ? '  إدارية وعمومية' : '  G&A', amount: '' });
    }
    pushLeaf('521', true);
    if (hasLeafBal('522') && showAnalytical) {
      rows.push({ label: ar ? '  تسويق وبيع' : '  Marketing & Sales', amount: '' });
    }
    pushLeaf('522', true);
    pushTotal(ar ? 'مجموع المصروفات العمومية والإدارية' : 'Total G&A Expenses', glPnL.gaExpenses, true);
  }

  const showFin = glPnL.financeExpenses > 0.005 || hasLeafBal('531');
  if (showFin) {
    pushSection(ar ? 'المصروفات التمويلية' : 'Finance Expenses');
    pushLeaf('531', true);
    pushTotal(ar ? 'مجموع المصروفات التمويلية' : 'Total Finance Expenses', glPnL.financeExpenses, true);
  }

  pushTotal(ar ? 'ربح الفترة قبل الضريبة' : 'Profit before Tax', glPnL.profitBeforeTax);

  void moneyLabel;
  return { columns, rows };
}

export type BalancePrintSheet = {
  codeBalMap: Map<string, number>;
  accBal: (code: string, nature: 'debit' | 'credit') => number;
  sectionBal: (prefix: string, nature: 'debit' | 'credit') => number;
  nonCurrentAssets: number;
  currentAssets: number;
  totalAssets: number;
  nonCurrentLiab: number;
  currentLiab: number;
  totalLiab: number;
  totalEquity: number;
  inventory127: { debit: number; credit: number };
};

/**
 * Build balance sheet rows matching on-screen structure (optional analytical leaves).
 */
export function buildBalanceSheetPrintRows(opts: {
  language: Lang;
  showAnalytical: boolean;
  bs: BalancePrintSheet;
  accounts: IncomePrintAccount[];
}): { columns: ReportDocColumn[]; rows: ReportDocRow[] } {
  const ar = isAr(opts.language);
  const { bs, showAnalytical, accounts } = opts;
  const columns: ReportDocColumn[] = [
    { key: 'label', header: ar ? 'البند' : 'Item', width: 55, align: ar ? 'right' : 'left' },
    { key: 'amount', header: ar ? 'المبلغ' : 'Amount', width: 25, align: 'right', money: true },
  ];
  const rows: ReportDocRow[] = [];

  const coaName = (code: string) => {
    const a = accounts.find((x) => String(x.accountCode || '').trim() === code);
    if (!a) return code;
    return ar ? a.accountName || code : a.accountNameEn || a.accountName || code;
  };
  const l3Label = (code: string, fallback: string) =>
    accounts.find((a) => a.accountCode === code)?.accountName || fallback;

  const resolveAccounts = (prefix: string, nature: 'debit' | 'credit'): string[] => {
    const result: string[] = [];
    bs.codeBalMap.forEach((net, code) => {
      if (!code.startsWith(prefix)) return;
      const bal = nature === 'debit' ? net : -net;
      if (Math.abs(bal) > 0.005) result.push(code);
    });
    return result.sort();
  };

  const pushGroup = (prefix: string, nature: 'debit' | 'credit', label: string) => {
    const codes = resolveAccounts(prefix, nature);
    if (codes.length === 0) return;
    const total = codes.reduce((s, code) => s + bs.accBal(code, nature), 0);
    if (Math.abs(total) < 0.005) return;
    if (!showAnalytical) {
      rows.push({ label, amount: total });
      return;
    }
    rows.push({ label, amount: '' });
    for (const code of codes) {
      rows.push({ label: `  ${code} — ${coaName(code)}`, amount: bs.accBal(code, nature) });
    }
    if (codes.length > 1) {
      rows.push({ label: ar ? '  مجموع' : '  Sub-total', amount: total });
    }
  };

  const pushTitle = (label: string) => rows.push({ label, amount: '' });
  const pushTotal = (label: string, amount: number) => rows.push({ label, amount });

  pushTitle(ar ? 'الأصول غير المتداولة' : 'Non-Current Assets');
  for (const p of ['111', '112', '113', '114', '115', '116', '117', '118']) {
    pushGroup(p, 'debit', l3Label(p, ar ? `أصول ثابتة (${p})` : `Fixed Assets (${p})`));
  }
  if (bs.accBal('119', 'credit') > 0.005 || bs.sectionBal('119', 'credit') > 0.005) {
    rows.push({
      label: ar ? 'يُطرح: مجمع الإهلاك' : 'Less: Accumulated Depreciation',
      amount: -bs.sectionBal('119', 'credit'),
    });
  }
  pushTotal(ar ? 'صافي الأصول غير المتداولة' : 'Net Non-Current Assets', bs.nonCurrentAssets);

  pushTitle(ar ? 'الأصول المتداولة' : 'Current Assets');
  pushGroup('121', 'debit', l3Label('121', ar ? 'النقدية والبنوك' : 'Cash & Banks'));
  pushGroup('122', 'debit', l3Label('122', ar ? 'العملاء والذمم المدينة' : 'Receivables'));
  pushGroup('123', 'debit', l3Label('123', ar ? 'مدفوعات مقدمة' : 'Advances'));
  pushGroup('124', 'debit', l3Label('124', ar ? 'حسابات ضريبية مدينة' : 'Tax Receivables'));
  pushGroup('125', 'debit', l3Label('125', ar ? 'ذمم مدينة أخرى' : 'Other Receivables'));
  pushGroup('126', 'debit', l3Label('126', ar ? 'أصول أخرى' : 'Other Assets'));
  if (bs.inventory127.debit > 0.005 || bs.inventory127.credit > 0.005) {
    const net = bs.inventory127.debit - bs.inventory127.credit;
    rows.push({
      label: ar ? 'مخزون المشاريع (127)' : 'Project Inventory (127)',
      amount: net,
    });
  }
  pushTotal(ar ? 'مجموع الأصول المتداولة' : 'Total Current Assets', bs.currentAssets);
  pushTotal(ar ? 'إجمالي الأصول' : 'Total Assets', bs.totalAssets);

  pushTitle(ar ? 'الخصوم غير المتداولة' : 'Non-Current Liabilities');
  pushGroup('221', 'credit', l3Label('221', ar ? 'قروض طويلة الأجل' : 'Long-term Loans'));
  pushTotal(ar ? 'مجموع الخصوم غير المتداولة' : 'Total Non-Current Liabilities', bs.nonCurrentLiab);

  pushTitle(ar ? 'الخصوم المتداولة' : 'Current Liabilities');
  pushGroup('211', 'credit', l3Label('211', ar ? 'ذمم دائنة تجارية' : 'Trade Payables'));
  pushGroup('212', 'credit', l3Label('212', ar ? 'محتجزات الضمان' : 'Retention Payables'));
  pushGroup('213', 'credit', l3Label('213', ar ? 'دفعات مقدمة من العملاء' : 'Customer Advances'));
  pushGroup('214', 'credit', l3Label('214', ar ? 'التزامات ضريبية' : 'Tax Liabilities'));
  pushGroup('215', 'credit', l3Label('215', ar ? 'مستحقات أخرى' : 'Other Payables'));
  pushTotal(ar ? 'مجموع الخصوم المتداولة' : 'Total Current Liabilities', bs.currentLiab);
  pushTotal(ar ? 'إجمالي الخصوم' : 'Total Liabilities', bs.totalLiab);

  pushTitle(ar ? 'حقوق الملكية' : 'Equity');
  for (const p of ['311', '312', '313', '314']) {
    pushGroup(p, 'credit', l3Label(p, ar ? `حقوق ملكية (${p})` : `Equity (${p})`));
  }
  pushTotal(ar ? 'إجمالي حقوق الملكية' : 'Total Equity', bs.totalEquity);
  pushTotal(
    ar ? 'الخصوم + حقوق الملكية' : 'Liabilities + Equity',
    bs.totalLiab + bs.totalEquity,
  );

  return { columns, rows };
}

export type ScheduleBoqItem = {
  id?: string;
  itemCode?: string;
  description?: string;
  startDate?: string;
  expectedDuration?: number;
  tenderQty?: number;
  projectId?: string;
  contractId?: string;
};

export function buildSchedulePrintRows(opts: {
  language: Lang;
  locale: string;
  items: ScheduleBoqItem[];
  physicalPctByItemId: Map<string, number>;
  normalizeDate: (d: string | Date | unknown) => string;
}): { columns: ReportDocColumn[]; rows: ReportDocRow[] } {
  const ar = isAr(opts.language);
  const columns: ReportDocColumn[] = [
    { key: 'item', header: ar ? 'البند' : 'Item', width: 22, align: ar ? 'right' : 'left' },
    { key: 'start', header: ar ? 'البدء' : 'Start', width: 10, align: 'center' },
    { key: 'duration', header: ar ? 'المدة' : 'Days', width: 8, align: 'center' },
    { key: 'finish', header: ar ? 'نهاية متوقعة' : 'Exp. finish', width: 11, align: 'center' },
    { key: 'physical', header: ar ? 'إنجاز %' : 'Physical %', width: 10, align: 'right', numeric: true },
    { key: 'elapsed', header: ar ? 'منقضي' : 'Elapsed', width: 10, align: 'right', numeric: true },
    { key: 'timePct', header: ar ? 'زمني %' : 'Time %', width: 9, align: 'right', numeric: true },
    { key: 'status', header: ar ? 'الحالة' : 'Status', width: 12, align: 'center' },
  ];

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const rows: ReportDocRow[] = opts.items.map((item) => {
    const duration = item.expectedDuration || 0;
    const hasSchedule = !!(item.startDate && item.expectedDuration);
    let start: Date | null = null;
    let end: Date | null = null;
    if (item.startDate && item.expectedDuration) {
      const [sy, sm, sd] = opts.normalizeDate(item.startDate).split('-').map(Number);
      start = new Date(sy, sm - 1, sd);
      end = new Date(sy, sm - 1, sd + item.expectedDuration);
    }
    const elapsedDays = start
      ? Math.max(0, Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;
    const timeProgress = duration > 0 ? (elapsedDays / duration) * 100 : 0;
    const id = String(item.id || '');
    const physicalPct = opts.physicalPctByItemId.get(id) ?? 0;
    const isCompleted = physicalPct >= 99.9;
    const notStarted = start ? start > now : false;
    const isDelayed = end ? end < now && !isCompleted : false;

    let status: string;
    if (isCompleted) status = ar ? 'مكتمل' : 'Completed';
    else if (!hasSchedule) status = ar ? 'غير مجدول' : 'Unscheduled';
    else if (notStarted) status = ar ? 'لم يبدأ' : 'Not started';
    else if (isDelayed) status = ar ? 'متأخر' : 'Delayed';
    else status = ar ? 'قيد التنفيذ' : 'In progress';

    const code = item.itemCode || '';
    const desc = item.description || '';
    return {
      item: desc ? `${code} — ${desc}` : code,
      start: item.startDate ? opts.normalizeDate(item.startDate) : '—',
      duration: duration || '—',
      finish: end ? end.toLocaleDateString(opts.locale) : '—',
      physical: Number(physicalPct.toFixed(1)),
      elapsed: hasSchedule ? elapsedDays : '—',
      timePct: hasSchedule ? Number(timeProgress.toFixed(1)) : '—',
      status,
    };
  });

  return { columns, rows };
}
