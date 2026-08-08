-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "coa_account_id" TEXT,
    "code" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT,
    "account_number" TEXT,
    "iban" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "opening_balance" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_movements" (
    "id" TEXT NOT NULL,
    "document_no" TEXT NOT NULL DEFAULT '',
    "bank_account_id" TEXT NOT NULL,
    "movement_type" TEXT NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,
    "date" TEXT NOT NULL,
    "currency" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "description_ar" TEXT,
    "description_en" TEXT,
    "project_id" TEXT,
    "contract_id" TEXT,
    "offset_chart_of_account_id" TEXT,
    "offset_account_code" TEXT,
    "offset_account_name" TEXT,
    "to_bank_account_id" TEXT,
    "adjustment_direction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "gl_transaction_id" TEXT,
    "posted_gl_reference" TEXT,
    "reversal_transaction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_cheques" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "cheque_no" TEXT NOT NULL,
    "payee_name" TEXT,
    "amount" DECIMAL(18,3) NOT NULL,
    "issue_date" TEXT NOT NULL,
    "due_date" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "offset_chart_of_account_id" TEXT,
    "project_id" TEXT,
    "contract_id" TEXT,
    "received_issue_credits" JSONB,
    "gl_issue_transaction_id" TEXT,
    "gl_clear_transaction_id" TEXT,
    "gl_reject_transaction_id" TEXT,
    "posted_issue_reference" TEXT,
    "posted_clear_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_cheques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "period_start" TEXT NOT NULL,
    "period_end" TEXT NOT NULL,
    "opening_balance" DECIMAL(18,3) NOT NULL,
    "closing_balance" DECIMAL(18,3),
    "source_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" TEXT NOT NULL,
    "statement_id" TEXT NOT NULL,
    "line_date" TEXT NOT NULL,
    "reference" TEXT,
    "description" TEXT,
    "debit" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "match_status" TEXT NOT NULL DEFAULT 'unmatched',
    "matched_entity_type" TEXT,
    "matched_entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_movements_bank_account_id_idx" ON "bank_movements"("bank_account_id");

-- CreateIndex
CREATE INDEX "bank_movements_status_idx" ON "bank_movements"("status");

-- CreateIndex
CREATE INDEX "bank_movements_project_id_idx" ON "bank_movements"("project_id");

-- CreateIndex
CREATE INDEX "bank_movements_contract_id_idx" ON "bank_movements"("contract_id");

-- CreateIndex
CREATE INDEX "bank_cheques_bank_account_id_idx" ON "bank_cheques"("bank_account_id");

-- CreateIndex
CREATE INDEX "bank_cheques_status_idx" ON "bank_cheques"("status");

-- CreateIndex
CREATE INDEX "bank_cheques_project_id_idx" ON "bank_cheques"("project_id");

-- CreateIndex
CREATE INDEX "bank_cheques_contract_id_idx" ON "bank_cheques"("contract_id");

-- CreateIndex
CREATE INDEX "bank_statements_bank_account_id_idx" ON "bank_statements"("bank_account_id");

-- CreateIndex
CREATE INDEX "bank_statement_lines_statement_id_idx" ON "bank_statement_lines"("statement_id");

-- AddForeignKey
ALTER TABLE "bank_movements" ADD CONSTRAINT "bank_movements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_cheques" ADD CONSTRAINT "bank_cheques_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
