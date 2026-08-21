import * as XLSX from 'xlsx';

export type CashBudgetExcelLabels = {
  sheetSummary: string;
  sheetObligations: string;
  sheetProjects: string;
  sheetCustody: string;
  periodNumber: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  settlementPct: string;
  kpiBanks: string;
  kpiCash: string;
  kpiSources: string;
  kpiObligations: string;
  kpiGap: string;
  kpiPayPlan: string;
  colAccount: string;
  colProject: string;
  colCategory: string;
  colAmount: string;
  colAllocated: string;
  colAllocPct: string;
  colExcluded: string;
  colOrigin: string;
  colObligationTotal: string;
  colAllocatedTotal: string;
  colGlBalance: string;
  colMinBalance: string;
  colReplenish: string;
  yes: string;
  no: string;
};

export type CashBudgetExcelSummary = {
  periodNumber: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  settlementPct: number;
  banks: number;
  cash: number;
  collections: number;
  obligations: number;
  gap: number;
  payPlan: number;
};

export type CashBudgetExcelLine = {
  account: string;
  project: string;
  category: string;
  amount: number;
  allocated: number;
  allocPct: number;
  excluded: boolean;
  origin: string;
};

export type CashBudgetExcelProjectRow = {
  name: string;
  obligation: number;
  allocated: number;
  pct: number;
};

export type CashBudgetExcelCustodyRow = {
  account: string;
  glBalance: number;
  minBalance: number;
  replenish: number;
};

export type CashBudgetExcelWorkbook = {
  summary: unknown[][];
  obligations: unknown[][];
  projects: unknown[][];
  custody: unknown[][];
};

export function buildCashBudgetExcelWorkbook(input: {
  labels: CashBudgetExcelLabels;
  summary: CashBudgetExcelSummary;
  lines: CashBudgetExcelLine[];
  projects: CashBudgetExcelProjectRow[];
  custody: CashBudgetExcelCustodyRow[];
}): CashBudgetExcelWorkbook {
  const L = input.labels;
  const s = input.summary;
  const summary: unknown[][] = [
    [L.periodNumber, s.periodNumber],
    [L.periodType, s.periodType],
    [L.periodStart, s.periodStart],
    [L.periodEnd, s.periodEnd],
    [L.status, s.status],
    [L.settlementPct, s.settlementPct],
    [],
    [L.kpiBanks, s.banks],
    [L.kpiCash, s.cash],
    [L.kpiSources, s.collections],
    [L.kpiObligations, s.obligations],
    [L.kpiGap, s.gap],
    [L.kpiPayPlan, s.payPlan],
  ];

  const obligations: unknown[][] = [
    [
      L.colAccount,
      L.colProject,
      L.colCategory,
      L.colAmount,
      L.colAllocated,
      L.colAllocPct,
      L.colExcluded,
      L.colOrigin,
    ],
    ...input.lines.map((row) => [
      row.account,
      row.project,
      row.category,
      row.amount,
      row.allocated,
      row.allocPct,
      row.excluded ? L.yes : L.no,
      row.origin,
    ]),
  ];

  const projects: unknown[][] = [
    [L.colProject, L.colObligationTotal, L.colAllocatedTotal, L.colAllocPct],
    ...input.projects.map((row) => [row.name, row.obligation, row.allocated, row.pct]),
  ];

  const custody: unknown[][] = [
    [L.colAccount, L.colGlBalance, L.colMinBalance, L.colReplenish],
    ...input.custody.map((row) => [row.account, row.glBalance, row.minBalance, row.replenish]),
  ];

  return { summary, obligations, projects, custody };
}

function appendSheet(wb: XLSX.WorkBook, name: string, aoa: unknown[][]): void {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const colCount = Math.max(1, ...aoa.map((r) => r.length));
  ws['!cols'] = Array.from({ length: colCount }, () => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

export function exportCashBudgetExcel(
  input: {
    labels: CashBudgetExcelLabels;
    summary: CashBudgetExcelSummary;
    lines: CashBudgetExcelLine[];
    projects: CashBudgetExcelProjectRow[];
    custody: CashBudgetExcelCustodyRow[];
    filename: string;
  },
): void {
  const sheets = buildCashBudgetExcelWorkbook(input);
  const wb = XLSX.utils.book_new();
  const L = input.labels;
  appendSheet(wb, L.sheetSummary, sheets.summary);
  appendSheet(wb, L.sheetObligations, sheets.obligations);
  appendSheet(wb, L.sheetProjects, sheets.projects);
  if (input.custody.length > 0) {
    appendSheet(wb, L.sheetCustody, sheets.custody);
  }
  const safe = input.filename.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'cash-budget';
  XLSX.writeFile(wb, `${safe}.xlsx`);
}
