-- CreateTable
CREATE TABLE "cost_centers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "type" TEXT NOT NULL,
    "contract_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- Seed direct cost centers from existing contracts (id = contract id)
INSERT INTO "cost_centers" ("id", "code", "name", "name_en", "type", "contract_id", "is_active", "is_deleted", "created_at", "updated_at")
SELECT
    c."id",
    'CC-' || UPPER(SUBSTRING(c."id" FROM 1 FOR 8)),
    c."contract_name",
    c."contract_name_en",
    'direct',
    c."id",
    true,
    c."is_deleted",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "contracts" c;

-- Drop old FK to contracts
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_cost_center_id_fkey";

-- Add FK to cost_centers
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Line-level cost center on journal entries
ALTER TABLE "journal_entries" ADD COLUMN "cost_center_id" TEXT;
CREATE INDEX "journal_entries_cost_center_id_idx" ON "journal_entries"("cost_center_id");
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_code_key" ON "cost_centers"("code");
CREATE UNIQUE INDEX "cost_centers_contract_id_key" ON "cost_centers"("contract_id");
CREATE INDEX "cost_centers_type_is_deleted_idx" ON "cost_centers"("type", "is_deleted");
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Contract expense orders (BOQ allocation without inventory)
CREATE TABLE "contract_expense_orders" (
    "id" SERIAL NOT NULL,
    "order_number" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "order_date" TEXT NOT NULL,
    "expense_account_code" TEXT NOT NULL,
    "expense_account_name" TEXT,
    "creditor_account_code" TEXT NOT NULL,
    "creditor_account_name" TEXT,
    "total_amount" DECIMAL(18,3) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "reference_number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "transaction_id" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_expense_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_expense_order_lines" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "boq_item_id" TEXT NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "contract_expense_order_lines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "boq_actual_costs" ADD COLUMN "contract_expense_order_id" INTEGER;

CREATE UNIQUE INDEX "contract_expense_orders_order_number_key" ON "contract_expense_orders"("order_number");
CREATE INDEX "contract_expense_orders_contract_id_status_idx" ON "contract_expense_orders"("contract_id", "status");
CREATE INDEX "contract_expense_orders_project_id_idx" ON "contract_expense_orders"("project_id");
CREATE INDEX "contract_expense_order_lines_order_id_idx" ON "contract_expense_order_lines"("order_id");

ALTER TABLE "contract_expense_orders" ADD CONSTRAINT "contract_expense_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_expense_orders" ADD CONSTRAINT "contract_expense_orders_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_expense_orders" ADD CONSTRAINT "contract_expense_orders_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contract_expense_order_lines" ADD CONSTRAINT "contract_expense_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "contract_expense_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "boq_actual_costs" ADD CONSTRAINT "boq_actual_costs_contract_expense_order_id_fkey" FOREIGN KEY ("contract_expense_order_id") REFERENCES "contract_expense_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Overhead allocation periods
CREATE TABLE "overhead_allocation_periods" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "period_start" TEXT NOT NULL,
    "period_end" TEXT NOT NULL,
    "distribution_basis" TEXT NOT NULL DEFAULT 'revenue_ratio',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "overhead_allocation_periods_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "overhead_allocation_lines" (
    "id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "indirect_center_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,
    "transaction_id" TEXT,

    CONSTRAINT "overhead_allocation_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "overhead_allocation_periods_period_start_period_end_key" ON "overhead_allocation_periods"("period_start", "period_end");
CREATE INDEX "overhead_allocation_lines_period_id_idx" ON "overhead_allocation_lines"("period_id");
CREATE INDEX "overhead_allocation_lines_transaction_id_idx" ON "overhead_allocation_lines"("transaction_id");

ALTER TABLE "overhead_allocation_lines" ADD CONSTRAINT "overhead_allocation_lines_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "overhead_allocation_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "overhead_allocation_lines" ADD CONSTRAINT "overhead_allocation_lines_indirect_center_id_fkey" FOREIGN KEY ("indirect_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "overhead_allocation_lines" ADD CONSTRAINT "overhead_allocation_lines_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "overhead_allocation_lines" ADD CONSTRAINT "overhead_allocation_lines_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
