export interface AccountStatementPrintRow {
  date: string;
  description: string;
  counterpart: string;
  costCenter: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface AccountStatementPrintData {
  accountCode: string;
  accountName: string;
  periodLabel: string;
  rows: AccountStatementPrintRow[];
  closingBalance: number;
}
