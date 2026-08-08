import { buildBudgetVsActualRows, budgetVsActualPrintRowsPerPage, chunkBudgetVsActualPages, sumBudgetVsActualRows, type BudgetDetailLevel } from '../budgetVsActual';
import type { CompanyPrintInfo } from '../ipcPrintData';
import type { ReportPrintId } from '../reportPrintProfiles';
import { buildTableReportDocument } from './buildTableDoc';
import type { ReportDocColumn, ReportDocRow, ReportDocument } from './types';

type MoneyFmt = (n: number) => string;

export type ReportsModuleDocContext = {
  language: 'ar' | 'en';
  company: CompanyPrintInfo;
  scopeLabel?: string;
  dateLabel?: string;
  formatMoney: MoneyFmt;
  activeReport: ReportPrintId;
  // budget
  budgetLevel?: BudgetDetailLevel;
  budgetProjects?: { id: string; projectName: string; projectCode?: string; voValue?: number }[];
  budgetContracts?: { id: string; projectId: string; contractName?: string; contractNumber?: string }[];
  budgetBoqItems?: Array<{
    id: string;
    projectId: string;
    contractId?: string;
    tenderAmount?: number;
    rateMaterials?: number;
    rateLabour?: number;
    rateEquipment?: number;
    rateOverheadPct?: number;
    rateProfitPct?: number;
    unitRateTotal?: number;
    quantity?: number;
    itemCode?: string;
    description?: string;
  }>;
  budgetActualByKey?: Map<string, number>;
  selectedProjectId?: string;
  selectedContractId?: string;
  // income / time / liquidity project stats
  projectStats?: Array<{
    name: string;
    billings: number;
    costs: number;
    profit: number;
    collected?: number;
    advances?: number;
    uncollected?: number;
  }>;
  // trial
  trialBalance?: Array<{
    code: string;
    name: string;
    openingDebit: number;
    openingCredit: number;
    debitMovements: number;
    creditMovements: number;
    closingDebit: number;
    closingCredit: number;
  }>;
  // balance sheet summary lines
  balanceRows?: ReportDocRow[];
  balanceColumns?: ReportDocColumn[];
  // costs
  costRows?: Array<{
    projectName: string;
    projectCode?: string;
    contractName?: string;
    contractNumber?: string;
    itemCode?: string;
    boqDescription?: string;
    chapterCode?: string;
    sectionCode?: string;
    directCost: number;
    indirectCost: number;
    totalCost: number;
  }>;
  costLevel?: 'project' | 'contract' | 'boq_item';
  costTotals?: { directCost: number; indirectCost: number; totalCost: number };
  // income statement GL lines (optional richer)
  incomeRows?: ReportDocRow[];
  incomeColumns?: ReportDocColumn[];
  incomeTotals?: ReportDocRow;
  // schedule (time)
  timeColumns?: ReportDocColumn[];
  timeRows?: ReportDocRow[];
  // liquidity per contract
  liquidityRows?: Array<{
    name: string;
    billings: number;
    collected: number;
    advances: number;
    retention: number;
    uncollected: number;
  }>;
  liquidityCashBalance?: number;
};

function isAr(language: 'ar' | 'en') {
  return language === 'ar';
}

export function buildReportsModuleDocument(ctx: ReportsModuleDocContext): ReportDocument | null {
  const ar = isAr(ctx.language);
  const base = {
    language: ctx.language,
    company: ctx.company,
    scopeLabel: ctx.scopeLabel,
    dateLabel: ctx.dateLabel,
  };

  switch (ctx.activeReport) {
    case 'budget': {
      const level = ctx.budgetLevel || 'project';
      const rows = buildBudgetVsActualRows({
        level,
        projects: ctx.budgetProjects || [],
        contracts: ctx.budgetContracts || [],
        boqItems: ctx.budgetBoqItems || [],
        actualByKey: ctx.budgetActualByKey || new Map(),
        projectFilter: ctx.selectedProjectId,
        contractFilter: ctx.selectedContractId,
      });
      const totals = sumBudgetVsActualRows(rows);
      const showVo = level === 'project';
      const columns: ReportDocColumn[] = [
        {
          key: 'label',
          header: level === 'project' ? (ar ? 'المشروع' : 'Project') : level === 'contract' ? (ar ? 'العقد' : 'Contract') : (ar ? 'بند BOQ' : 'BOQ item'),
          width: level === 'boq_item' ? 28 : 18,
          align: ar ? 'right' : 'left',
        },
      ];
      if (level !== 'project') {
        columns.push({ key: 'meta', header: ar ? 'المرجع' : 'Reference', width: 14, align: ar ? 'right' : 'left' });
      }
      columns.push(
        { key: 'boqSelling', header: ar ? 'بيع BOQ' : 'BOQ sell', width: 10, align: 'right', money: true },
        { key: 'estCost', header: ar ? 'تكلفة تقديرية' : 'Est. cost', width: 10, align: 'right', money: true },
      );
      if (showVo) {
        columns.push({ key: 'voValue', header: ar ? 'أوامر تغيير' : 'VO', width: 9, align: 'right', money: true });
      }
      columns.push(
        { key: 'costBudget', header: ar ? 'ميزانية التكلفة' : 'Cost budget', width: 11, align: 'right', money: true },
        { key: 'actual', header: ar ? 'الفعلي' : 'Actual', width: 10, align: 'right', money: true },
        { key: 'variance', header: ar ? 'الانحراف' : 'Variance', width: 10, align: 'right', money: true },
        { key: 'status', header: ar ? 'الحالة' : 'Status', width: 8, align: 'center' },
      );

      const docRows: ReportDocRow[] = rows.map((r) => {
        const under = r.variance >= -0.005;
        const onBudget = Math.abs(r.variance) < 0.005;
        const status = onBudget ? (ar ? 'مطابق' : 'OK') : under ? (ar ? 'تحت' : 'Under') : ar ? 'تجاوز' : 'Over';
        return {
          label: r.label,
          meta: r.meta || '',
          boqSelling: r.boqSelling,
          estCost: r.estCost,
          voValue: r.voValue,
          costBudget: r.costBudget,
          actual: r.actual,
          variance: r.variance,
          status,
        };
      });

      const pageChunks = chunkBudgetVsActualPages(docRows, budgetVsActualPrintRowsPerPage(level));

      return buildTableReportDocument({
        ...base,
        reportId: 'budget',
        title: ar ? 'الميزانية مقابل الفعلي' : 'Budget vs Actual',
        columns,
        rows: docRows,
        pageChunks,
        totals: {
          label: '',
          boqSelling: totals.boqSelling,
          estCost: totals.estCost,
          voValue: totals.voValue,
          costBudget: totals.costBudget,
          actual: totals.actual,
          variance: totals.variance,
          status: '',
        },
        filename: `Budget_vs_Actual_${level}`,
      });
    }
    case 'income': {
      if (ctx.incomeColumns && ctx.incomeRows) {
        return buildTableReportDocument({
          ...base,
          reportId: 'income',
          title: ar ? 'قائمة الدخل' : 'Income Statement',
          columns: ctx.incomeColumns,
          rows: ctx.incomeRows,
          totals: ctx.incomeTotals,
          filename: 'Income_Statement',
        });
      }
      const columns: ReportDocColumn[] = [
        { key: 'name', header: ar ? 'المشروع' : 'Project', width: 28, align: ar ? 'right' : 'left' },
        { key: 'billings', header: ar ? 'الإيرادات' : 'Revenue', width: 18, align: 'right', money: true },
        { key: 'costs', header: ar ? 'التكاليف' : 'Costs', width: 18, align: 'right', money: true },
        { key: 'profit', header: ar ? 'مجمل الربح' : 'Gross profit', width: 18, align: 'right', money: true },
      ];
      const stats = ctx.projectStats || [];
      return buildTableReportDocument({
        ...base,
        reportId: 'income',
        title: ar ? 'قائمة الدخل' : 'Income Statement',
        columns,
        rows: stats.map((s) => ({
          name: s.name,
          billings: s.billings,
          costs: s.costs,
          profit: s.profit,
        })),
        totals: {
          name: '',
          billings: stats.reduce((a, s) => a + s.billings, 0),
          costs: stats.reduce((a, s) => a + s.costs, 0),
          profit: stats.reduce((a, s) => a + s.profit, 0),
        },
        filename: 'Income_Statement',
      });
    }
    case 'trial': {
      const columns: ReportDocColumn[] = [
        { key: 'code', header: ar ? 'الكود' : 'Code', width: 10, align: 'center' },
        { key: 'name', header: ar ? 'الحساب' : 'Account', width: 22, align: ar ? 'right' : 'left' },
        { key: 'openingDebit', header: ar ? 'افتتاحي مدين' : 'Open Dr', width: 11, align: 'right', money: true },
        { key: 'openingCredit', header: ar ? 'افتتاحي دائن' : 'Open Cr', width: 11, align: 'right', money: true },
        { key: 'debitMovements', header: ar ? 'حركة مدين' : 'Period Dr', width: 11, align: 'right', money: true },
        { key: 'creditMovements', header: ar ? 'حركة دائن' : 'Period Cr', width: 11, align: 'right', money: true },
        { key: 'closingDebit', header: ar ? 'رصيد مدين' : 'Close Dr', width: 12, align: 'right', money: true },
        { key: 'closingCredit', header: ar ? 'رصيد دائن' : 'Close Cr', width: 12, align: 'right', money: true },
      ];
      const rows = (ctx.trialBalance || []).map((r) => ({ ...r }));
      return buildTableReportDocument({
        ...base,
        reportId: 'trial',
        title: ar ? 'ميزان المراجعة' : 'Trial Balance',
        columns,
        rows,
        filename: 'Trial_Balance',
      });
    }
    case 'liquidity': {
      const columns: ReportDocColumn[] = [
        { key: 'name', header: ar ? 'العقد / المشروع' : 'Contract / Project', width: 22, align: ar ? 'right' : 'left' },
        { key: 'billings', header: ar ? 'المفوتر' : 'Billed', width: 12, align: 'right', money: true },
        { key: 'collected', header: ar ? 'المحصل' : 'Collected', width: 12, align: 'right', money: true },
        { key: 'advances', header: ar ? 'دفعات مقدمة' : 'Advances', width: 11, align: 'right', money: true },
        { key: 'retention', header: ar ? 'محتجزات' : 'Retention', width: 11, align: 'right', money: true },
        { key: 'uncollected', header: ar ? 'تحت التحصيل' : 'Pending', width: 12, align: 'right', money: true },
      ];
      const liq = ctx.liquidityRows?.length
        ? ctx.liquidityRows
        : (ctx.projectStats || []).map((s) => ({
            name: s.name,
            billings: s.billings,
            collected: s.collected ?? 0,
            advances: s.advances ?? 0,
            retention: 0,
            uncollected: s.uncollected ?? 0,
          }));
      const totals = {
        name: '',
        billings: liq.reduce((a, r) => a + Number(r.billings || 0), 0),
        collected: liq.reduce((a, r) => a + Number(r.collected || 0), 0),
        advances: liq.reduce((a, r) => a + Number(r.advances || 0), 0),
        retention: liq.reduce((a, r) => a + Number(r.retention || 0), 0),
        uncollected: liq.reduce((a, r) => a + Number(r.uncollected || 0), 0),
      };
      const cashNote =
        ctx.liquidityCashBalance != null
          ? ar
            ? `رصيد النقدية والبنوك: ${ctx.formatMoney(ctx.liquidityCashBalance)}`
            : `Cash & banks: ${ctx.formatMoney(ctx.liquidityCashBalance)}`
          : undefined;
      return buildTableReportDocument({
        ...base,
        reportId: 'liquidity',
        title: ar ? 'تقرير السيولة' : 'Liquidity Report',
        columns,
        rows: liq.map((s) => ({
          name: s.name,
          billings: Number(s.billings) || 0,
          collected: Number(s.collected) || 0,
          advances: Number(s.advances) || 0,
          retention: Number(s.retention) || 0,
          uncollected: Number(s.uncollected) || 0,
        })),
        totals,
        footerNote: cashNote,
        filename: 'Liquidity_Report',
      });
    }
    case 'time': {
      if (ctx.timeColumns && ctx.timeRows) {
        return buildTableReportDocument({
          ...base,
          reportId: 'time',
          title: ar ? 'الجدول الزمني والانحراف' : 'Schedule & Time Variance',
          columns: ctx.timeColumns,
          rows: ctx.timeRows,
          filename: 'Project_Schedule',
        });
      }
      const columns: ReportDocColumn[] = [
        { key: 'name', header: ar ? 'المشروع' : 'Project', width: 40, align: ar ? 'right' : 'left' },
        { key: 'billings', header: ar ? 'المفوتر' : 'Billed', width: 20, align: 'right', money: true },
        { key: 'costs', header: ar ? 'التكاليف' : 'Costs', width: 20, align: 'right', money: true },
        { key: 'profit', header: ar ? 'الربح' : 'Profit', width: 20, align: 'right', money: true },
      ];
      const stats = ctx.projectStats || [];
      return buildTableReportDocument({
        ...base,
        reportId: 'time',
        title: ar ? 'الجدول الزمني / ملخص المشاريع' : 'Schedule / Project summary',
        columns,
        rows: stats.map((s) => ({
          name: s.name,
          billings: s.billings,
          costs: s.costs,
          profit: s.profit,
        })),
        filename: 'Schedule_Summary',
      });
    }
    case 'costs': {
      const level = ctx.costLevel || 'project';
      const columns: ReportDocColumn[] = [
        { key: 'projectName', header: ar ? 'المشروع' : 'Project', width: 14, align: ar ? 'right' : 'left' },
      ];
      if (level !== 'project') {
        columns.push({
          key: 'contractName',
          header: ar ? 'العقد' : 'Contract',
          width: 12,
          align: ar ? 'right' : 'left',
        });
      }
      if (level === 'boq_item') {
        columns.push(
          { key: 'chapterCode', header: ar ? 'فصل' : 'Ch.', width: 6, align: 'center' },
          { key: 'sectionCode', header: ar ? 'قسم' : 'Sec.', width: 6, align: 'center' },
          { key: 'itemCode', header: ar ? 'كود' : 'Code', width: 8, align: 'center' },
          {
            key: 'boqDescription',
            header: ar ? 'البند' : 'Item',
            width: 18,
            align: ar ? 'right' : 'left',
          },
        );
      }
      columns.push(
        { key: 'directCost', header: ar ? 'مباشر' : 'Direct', width: 10, align: 'right', money: true },
        { key: 'indirectCost', header: ar ? 'غير مباشر' : 'Indirect', width: 10, align: 'right', money: true },
        { key: 'totalCost', header: ar ? 'الإجمالي' : 'Total', width: 10, align: 'right', money: true },
      );
      const mapped = (ctx.costRows || []).map((r) => ({
        projectName: r.projectCode ? `${r.projectCode} — ${r.projectName}` : r.projectName,
        contractName: r.contractNumber
          ? `${r.contractNumber}${r.contractName ? ` — ${r.contractName}` : ''}`
          : r.contractName || '',
        chapterCode: r.chapterCode || '',
        sectionCode: r.sectionCode || '',
        itemCode: r.itemCode || '',
        boqDescription: r.boqDescription || '',
        directCost: Number(r.directCost) || 0,
        indirectCost: Number(r.indirectCost) || 0,
        totalCost: Number(r.totalCost) || 0,
      }));
      const totals = ctx.costTotals || {
        directCost: mapped.reduce((a, r) => a + r.directCost, 0),
        indirectCost: mapped.reduce((a, r) => a + r.indirectCost, 0),
        totalCost: mapped.reduce((a, r) => a + r.totalCost, 0),
      };
      return buildTableReportDocument({
        ...base,
        reportId: 'costs',
        title: ar ? 'تكاليف BOQ' : 'BOQ Costs',
        columns,
        rows: mapped,
        totals: {
          projectName: '',
          contractName: '',
          chapterCode: '',
          sectionCode: '',
          itemCode: '',
          boqDescription: '',
          directCost: Number(totals.directCost) || 0,
          indirectCost: Number(totals.indirectCost) || 0,
          totalCost: Number(totals.totalCost) || 0,
        },
        filename: `BOQ_Costs_${level}`,
      });
    }
    case 'balance': {
      if (ctx.balanceColumns && ctx.balanceRows) {
        return buildTableReportDocument({
          ...base,
          reportId: 'balance',
          title: ar ? 'الميزانية العمومية' : 'Balance Sheet',
          columns: ctx.balanceColumns,
          rows: ctx.balanceRows,
          filename: 'Balance_Sheet',
        });
      }
      return buildTableReportDocument({
        ...base,
        reportId: 'balance',
        title: ar ? 'الميزانية العمومية' : 'Balance Sheet',
        columns: [
          { key: 'label', header: ar ? 'البند' : 'Item', width: 50, align: ar ? 'right' : 'left' },
          { key: 'amount', header: ar ? 'المبلغ' : 'Amount', width: 25, align: 'right', money: true },
        ],
        rows: [],
        filename: 'Balance_Sheet',
        footerNote: ar
          ? 'افتح التبويب ثم طباعة بعد تحميل البيانات'
          : 'Open the tab and print after data loads',
      });
    }
    default:
      return null;
  }
}
