export type BankAccount = {
  id: string;
  /** GL account document id in `chart_of_accounts` when linked */
  coaAccountId?: string;
  code: string;
  nameAr: string;
  nameEn?: string;
  accountNumber?: string;
  iban?: string;
  currency: string;
  openingBalance?: number;
  isActive: boolean;
};

export type TransferScope = 'internal' | 'external';
export type TransferChannel = 'bank_app' | 'instapay';
export type TransferDirection = 'out' | 'in';

export type BankMovement = {
  id: string;
  documentNo: string;
  bankAccountId: string;
  /** @deprecated legacy rows may still store instapay_out / instapay_in — normalize via bankTransferMeta */
  movementType: 'deposit' | 'withdrawal' | 'transfer' | 'instapay_out' | 'instapay_in' | 'fee' | 'interest' | 'adjustment';
  amount: number;
  date: string;
  currency?: string;
  /** User reference; also used as GL reference when set */
  reference?: string;
  /** Legacy label; prefer descriptionAr on new rows */
  note?: string;
  descriptionAr?: string;
  descriptionEn?: string;
  projectId?: string;
  contractId?: string;
  /** COA document id for offset account (8-digit leaf) */
  offsetChartOfAccountId?: string;
  offsetAccountCode?: string;
  offsetAccountName?: string;
  toBankAccountId?: string;
  /** Transfer: company banks vs external beneficiary */
  transferScope?: TransferScope;
  /** Transfer: bank mobile app vs InstaPay / IPN */
  transferChannel?: TransferChannel;
  /** Transfer: outgoing vs incoming relative to bankAccountId */
  transferDirection?: TransferDirection;
  /** External beneficiary — IPA, mobile, IBAN, or account number */
  instapayBeneficiary?: string;
  /** InstaPay network fee (EGP whole units) — on outgoing InstaPay */
  instapayFee?: number;
  /** Stored on draft for adjustment; used when posting */
  adjustmentDirection?: 'in' | 'out';
  status: 'draft' | 'posted' | 'cancelled';
  glTransactionId?: string;
  /** Reference string on the posted `transactions` doc (for reversal lookup) */
  postedGlReference?: string;
  reversalTransactionId?: string;
};
export type ReceivedIssueCreditRow = { offsetChartOfAccountId: string; amount: number };

export type BankCheque = {
  id: string;
  direction: 'issued' | 'received';
  bankAccountId: string;
  chequeNo: string;
  payeeName?: string;
  amount: number;
  issueDate: string;
  dueDate?: string;
  /** draft | issued (صادر بعد القيد الأول) | received (وارد) | cleared | rejected | cancelled — قديم: returned */
  status: 'draft' | 'issued' | 'received' | 'cleared' | 'rejected' | 'cancelled' | 'returned';
  offsetChartOfAccountId?: string;
  projectId?: string;
  contractId?: string;
  /** شيك وارد: دائنون متعددون (سطران+) يجب أن يعادل المبلغ */
  receivedIssueCredits?: ReceivedIssueCreditRow[] | null;
  glIssueTransactionId?: string;
  glClearTransactionId?: string;
  glRejectTransactionId?: string;
  /** مراجع ثابتة للقيود — للعكس عبر reverseJournalByReference */
  postedIssueReference?: string;
  postedClearReference?: string;
};

export type BankStatement = {
  id: string;
  bankAccountId: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: number;
  closingBalance?: number;
  sourceLabel?: string;
};

export type BankStatementLine = {
  id: string;
  statementId: string;
  lineDate: string;
  reference?: string;
  description?: string;
  debit: number;
  credit: number;
  matchStatus: 'unmatched' | 'matched' | 'suggested';
  matchedEntityType?: string;
  matchedEntityId?: string;
};
