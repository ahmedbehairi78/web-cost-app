-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "permissions" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "project_code" TEXT NOT NULL,
    "project_name" TEXT NOT NULL,
    "project_name_en" TEXT,
    "client_name" TEXT NOT NULL,
    "client_name_en" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "boq_value" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "vo_value" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "budget" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "inventory_account_code" TEXT,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "contract_name" TEXT NOT NULL,
    "contract_name_en" TEXT,
    "contract_number" TEXT NOT NULL,
    "contract_value" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "start_date" TEXT,
    "end_date" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_items" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "chapter_code" TEXT,
    "chapter_name" TEXT,
    "work_type_code" TEXT,
    "section_code" TEXT,
    "section_name" TEXT,
    "item_code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "tender_qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unit_rate_total" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "tender_amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "expected_duration" INTEGER,
    "start_date" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_name_en" TEXT,
    "parent_code" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL,
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "statement_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "supplier_id" TEXT,
    "project_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "type" TEXT NOT NULL,
    "tax_number" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "project_id" TEXT,
    "cost_center_id" TEXT,
    "created_by" TEXT,
    "reverses_reference" TEXT,
    "undoes_reversal_reference" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "account_code" TEXT NOT NULL,
    "account_name" TEXT,
    "debit" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,3) NOT NULL DEFAULT 0,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "billing_number" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "works_value_ex_vat" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "exec_guarantee_amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "wht_amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "labour_insurance_amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "manpower_levy_amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "advance_payment_recovery" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "net_payable" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "transaction_id" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_items" (
    "id" TEXT NOT NULL,
    "billing_id" TEXT NOT NULL,
    "boq_item_id" TEXT,
    "item_code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "previous_qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "current_qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "total_qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "metadata" JSONB,

    CONSTRAINT "billing_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_transactions" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "supplier_id" TEXT,
    "supplier_account_id" TEXT,
    "supplier_name" TEXT NOT NULL,
    "project_id" TEXT,
    "contract_id" TEXT,
    "expense_account_id" TEXT,
    "expense_account_name" TEXT,
    "date" TEXT NOT NULL,
    "reference_number" TEXT,
    "amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "wht_amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "exec_guarantee_amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "labour_insurance_amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "manpower_levy_amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "advance_payment_recovery" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "transaction_id" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_transaction_items" (
    "id" TEXT NOT NULL,
    "purchase_transaction_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "purchase_transaction_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_groups" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_categories" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_item_materials" (
    "id" SERIAL NOT NULL,
    "boq_item_id" TEXT NOT NULL,
    "material_category_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boq_item_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoices" (
    "id" SERIAL NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "invoice_number" TEXT,
    "invoice_date" TEXT NOT NULL,
    "supplier_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "vat_pct" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "project_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_lines" (
    "id" SERIAL NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "item_description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(18,3) NOT NULL,
    "total_cost" DECIMAL(18,3) NOT NULL,
    "boq_item_id" TEXT,
    "material_category_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_allocations" (
    "id" SERIAL NOT NULL,
    "line_id" INTEGER NOT NULL,
    "contract_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(18,3) NOT NULL,
    "total_cost" DECIMAL(18,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_invoice_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_inventory" (
    "id" SERIAL NOT NULL,
    "contract_id" TEXT NOT NULL,
    "material_category_id" INTEGER,
    "item_description" TEXT,
    "unit" TEXT NOT NULL,
    "quantity_in" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "quantity_consumed" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "quantity_transferred_out" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "quantity_transferred_in" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "quantity_reserved" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "avg_unit_cost" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "quantity_balance" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_consumption" (
    "id" SERIAL NOT NULL,
    "inventory_item_id" INTEGER NOT NULL,
    "contract_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "consumption_date" TEXT NOT NULL,
    "boq_item_id" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_consumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transfers" (
    "id" SERIAL NOT NULL,
    "transfer_number" TEXT NOT NULL,
    "transfer_date" TEXT NOT NULL,
    "from_contract_id" TEXT NOT NULL,
    "to_contract_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "approved_by_b" TEXT,
    "approved_by_projects" TEXT,
    "rejection_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transfer_lines" (
    "id" SERIAL NOT NULL,
    "transfer_id" INTEGER NOT NULL,
    "inventory_item_id" INTEGER NOT NULL,
    "material_category_id" INTEGER,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(18,3) NOT NULL,
    "total_cost" DECIMAL(18,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_inventory" (
    "id" SERIAL NOT NULL,
    "project_id" TEXT NOT NULL,
    "material_category_id" INTEGER NOT NULL,
    "item_description" TEXT,
    "unit" TEXT NOT NULL,
    "quantity_in" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "quantity_issued" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "quantity_returned" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "quantity_reserved" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "avg_unit_cost" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "quantity_balance" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_inventory_movements" (
    "id" SERIAL NOT NULL,
    "project_id" TEXT NOT NULL,
    "material_category_id" INTEGER NOT NULL,
    "movement_type" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(18,3),
    "reference_type" TEXT,
    "reference_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumption_orders" (
    "id" SERIAL NOT NULL,
    "order_number" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "project_id" TEXT,
    "order_date" TEXT NOT NULL,
    "recorded_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "expense_account_code" TEXT,
    "expense_account_name" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumption_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumption_order_lines" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "boq_item_id" TEXT NOT NULL,
    "material_category_id" INTEGER NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(18,3) NOT NULL,
    "total_cost" DECIMAL(18,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumption_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_actual_costs" (
    "id" SERIAL NOT NULL,
    "boq_item_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "material_category_id" INTEGER,
    "consumption_order_id" INTEGER,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(18,3) NOT NULL,
    "total_cost" DECIMAL(18,3) NOT NULL,
    "cost_element" TEXT NOT NULL DEFAULT 'materials',
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boq_actual_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_orders" (
    "id" SERIAL NOT NULL,
    "return_number" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "return_date" TEXT NOT NULL,
    "recorded_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_order_lines" (
    "id" SERIAL NOT NULL,
    "return_order_id" INTEGER NOT NULL,
    "consumption_order_line_id" INTEGER NOT NULL,
    "material_category_id" INTEGER NOT NULL,
    "boq_item_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(18,3) NOT NULL,
    "total_cost" DECIMAL(18,3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "return_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_inventory_transfers" (
    "id" SERIAL NOT NULL,
    "transfer_number" TEXT NOT NULL,
    "transfer_date" TEXT NOT NULL,
    "from_project_id" TEXT NOT NULL,
    "to_project_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "approved_by_b" TEXT,
    "approved_by_projects" TEXT,
    "rejection_reason" TEXT,
    "notes" TEXT,
    "transaction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_inventory_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_inventory_transfer_lines" (
    "id" SERIAL NOT NULL,
    "transfer_id" INTEGER NOT NULL,
    "project_inventory_id" INTEGER NOT NULL,
    "material_category_id" INTEGER NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(18,3) NOT NULL,
    "total_cost" DECIMAL(18,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_inventory_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontractors" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "trade" TEXT NOT NULL,
    "contact_info" TEXT,
    "tax_number" TEXT,
    "commercial_register" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontract_assignments" (
    "id" SERIAL NOT NULL,
    "contract_id" TEXT NOT NULL,
    "subcontractor_id" INTEGER NOT NULL,
    "boq_item_id" TEXT NOT NULL,
    "subcontract_unit_price" DECIMAL(18,3) NOT NULL,
    "owner_unit_price" DECIMAL(18,3) NOT NULL,
    "assigned_quantity" DECIMAL(18,3) NOT NULL,
    "assigned_date" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontract_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontract_extracts" (
    "id" SERIAL NOT NULL,
    "assignment_id" INTEGER NOT NULL,
    "extract_number" TEXT NOT NULL,
    "extract_date" TEXT NOT NULL,
    "period_from" TEXT NOT NULL,
    "period_to" TEXT NOT NULL,
    "executed_quantity" DECIMAL(18,3) NOT NULL,
    "unit_price" DECIMAL(18,3) NOT NULL,
    "gross_amount" DECIMAL(18,3) NOT NULL,
    "performance_guarantee_rate" DECIMAL(18,3) NOT NULL DEFAULT 10,
    "performance_guarantee_amount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "advance_payment_deduction" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "delay_penalty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "net_payable" DECIMAL(18,3) NOT NULL,
    "status" TEXT NOT NULL,
    "approved_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontract_extracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_on_site_extracts" (
    "id" TEXT NOT NULL,
    "firestore_id" TEXT,
    "contract_id" TEXT NOT NULL,
    "boq_item_id" TEXT NOT NULL,
    "supplied_quantity" DECIMAL(18,3) NOT NULL,
    "on_site_percentage" DECIMAL(18,3) NOT NULL,
    "equivalent_quantity" DECIMAL(18,3) NOT NULL,
    "unit_price" DECIMAL(18,3) NOT NULL,
    "claimed_amount" DECIMAL(18,3) NOT NULL,
    "delivery_note_ref" TEXT,
    "extract_number" TEXT,
    "extract_date" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "transaction_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_on_site_extracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "sid" TEXT NOT NULL,
    "sess" JSONB NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "projects_project_code_key" ON "projects"("project_code");

-- CreateIndex
CREATE INDEX "projects_is_deleted_project_code_idx" ON "projects"("is_deleted", "project_code");

-- CreateIndex
CREATE INDEX "projects_inventory_account_code_idx" ON "projects"("inventory_account_code");

-- CreateIndex
CREATE INDEX "contracts_project_id_is_deleted_idx" ON "contracts"("project_id", "is_deleted");

-- CreateIndex
CREATE INDEX "boq_items_project_id_contract_id_is_deleted_idx" ON "boq_items"("project_id", "contract_id", "is_deleted");

-- CreateIndex
CREATE INDEX "boq_items_item_code_idx" ON "boq_items"("item_code");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_account_code_key" ON "chart_of_accounts"("account_code");

-- CreateIndex
CREATE INDEX "chart_of_accounts_parent_code_idx" ON "chart_of_accounts"("parent_code");

-- CreateIndex
CREATE INDEX "chart_of_accounts_is_group_status_idx" ON "chart_of_accounts"("is_group", "status");

-- CreateIndex
CREATE INDEX "chart_of_accounts_project_id_idx" ON "chart_of_accounts"("project_id");

-- CreateIndex
CREATE INDEX "suppliers_type_is_deleted_idx" ON "suppliers"("type", "is_deleted");

-- CreateIndex
CREATE INDEX "transactions_is_deleted_date_idx" ON "transactions"("is_deleted", "date");

-- CreateIndex
CREATE INDEX "transactions_project_id_idx" ON "transactions"("project_id");

-- CreateIndex
CREATE INDEX "transactions_cost_center_id_idx" ON "transactions"("cost_center_id");

-- CreateIndex
CREATE INDEX "transactions_reverses_reference_is_deleted_idx" ON "transactions"("reverses_reference", "is_deleted");

-- CreateIndex
CREATE INDEX "journal_entries_account_code_idx" ON "journal_entries"("account_code");

-- CreateIndex
CREATE INDEX "billing_contract_id_is_deleted_idx" ON "billing"("contract_id", "is_deleted");

-- CreateIndex
CREATE INDEX "billing_status_idx" ON "billing"("status");

-- CreateIndex
CREATE INDEX "purchase_transactions_type_is_deleted_idx" ON "purchase_transactions"("type", "is_deleted");

-- CreateIndex
CREATE INDEX "purchase_transactions_contract_id_idx" ON "purchase_transactions"("contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "material_groups_code_key" ON "material_groups"("code");

-- CreateIndex
CREATE UNIQUE INDEX "material_categories_code_key" ON "material_categories"("code");

-- CreateIndex
CREATE INDEX "material_categories_group_id_idx" ON "material_categories"("group_id");

-- CreateIndex
CREATE INDEX "boq_item_materials_boq_item_id_idx" ON "boq_item_materials"("boq_item_id");

-- CreateIndex
CREATE INDEX "boq_item_materials_material_category_id_idx" ON "boq_item_materials"("material_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "boq_item_materials_boq_item_id_material_category_id_key" ON "boq_item_materials"("boq_item_id", "material_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_invoice_id_key" ON "purchase_invoices"("invoice_id");

-- CreateIndex
CREATE INDEX "purchase_invoices_status_idx" ON "purchase_invoices"("status");

-- CreateIndex
CREATE INDEX "purchase_invoices_invoice_date_idx" ON "purchase_invoices"("invoice_date");

-- CreateIndex
CREATE INDEX "purchase_invoices_project_id_idx" ON "purchase_invoices"("project_id");

-- CreateIndex
CREATE INDEX "purchase_invoice_lines_invoice_id_idx" ON "purchase_invoice_lines"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoice_allocations_line_id_contract_id_key" ON "purchase_invoice_allocations"("line_id", "contract_id");

-- CreateIndex
CREATE INDEX "contract_inventory_contract_id_idx" ON "contract_inventory"("contract_id");

-- CreateIndex
CREATE INDEX "contract_inventory_contract_id_material_category_id_idx" ON "contract_inventory"("contract_id", "material_category_id");

-- CreateIndex
CREATE INDEX "inventory_consumption_contract_id_idx" ON "inventory_consumption"("contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transfers_transfer_number_key" ON "inventory_transfers"("transfer_number");

-- CreateIndex
CREATE INDEX "inventory_transfers_status_idx" ON "inventory_transfers"("status");

-- CreateIndex
CREATE INDEX "inventory_transfers_from_contract_id_status_idx" ON "inventory_transfers"("from_contract_id", "status");

-- CreateIndex
CREATE INDEX "inventory_transfers_to_contract_id_status_idx" ON "inventory_transfers"("to_contract_id", "status");

-- CreateIndex
CREATE INDEX "inventory_transfer_lines_inventory_item_id_transfer_id_idx" ON "inventory_transfer_lines"("inventory_item_id", "transfer_id");

-- CreateIndex
CREATE INDEX "project_inventory_project_id_idx" ON "project_inventory"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_inventory_project_id_material_category_id_key" ON "project_inventory"("project_id", "material_category_id");

-- CreateIndex
CREATE INDEX "project_inventory_movements_project_id_material_category_id_idx" ON "project_inventory_movements"("project_id", "material_category_id");

-- CreateIndex
CREATE INDEX "project_inventory_movements_reference_type_reference_id_idx" ON "project_inventory_movements"("reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "consumption_orders_order_number_key" ON "consumption_orders"("order_number");

-- CreateIndex
CREATE INDEX "consumption_orders_contract_id_status_idx" ON "consumption_orders"("contract_id", "status");

-- CreateIndex
CREATE INDEX "consumption_orders_project_id_idx" ON "consumption_orders"("project_id");

-- CreateIndex
CREATE INDEX "consumption_order_lines_order_id_idx" ON "consumption_order_lines"("order_id");

-- CreateIndex
CREATE INDEX "boq_actual_costs_boq_item_id_contract_id_idx" ON "boq_actual_costs"("boq_item_id", "contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_orders_return_number_key" ON "return_orders"("return_number");

-- CreateIndex
CREATE INDEX "return_orders_contract_id_idx" ON "return_orders"("contract_id");

-- CreateIndex
CREATE INDEX "return_orders_project_id_idx" ON "return_orders"("project_id");

-- CreateIndex
CREATE INDEX "return_order_lines_consumption_order_line_id_idx" ON "return_order_lines"("consumption_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_inventory_transfers_transfer_number_key" ON "project_inventory_transfers"("transfer_number");

-- CreateIndex
CREATE INDEX "project_inventory_transfers_from_project_id_idx" ON "project_inventory_transfers"("from_project_id");

-- CreateIndex
CREATE INDEX "project_inventory_transfers_to_project_id_idx" ON "project_inventory_transfers"("to_project_id");

-- CreateIndex
CREATE INDEX "project_inventory_transfers_status_idx" ON "project_inventory_transfers"("status");

-- CreateIndex
CREATE INDEX "project_inventory_transfers_transaction_id_idx" ON "project_inventory_transfers"("transaction_id");

-- CreateIndex
CREATE INDEX "project_inventory_transfer_lines_transfer_id_idx" ON "project_inventory_transfer_lines"("transfer_id");

-- CreateIndex
CREATE INDEX "subcontract_assignments_contract_id_idx" ON "subcontract_assignments"("contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "material_on_site_extracts_firestore_id_key" ON "material_on_site_extracts"("firestore_id");

-- CreateIndex
CREATE INDEX "material_on_site_extracts_contract_id_idx" ON "material_on_site_extracts"("contract_id");

-- CreateIndex
CREATE INDEX "material_on_site_extracts_boq_item_id_idx" ON "material_on_site_extracts"("boq_item_id");

-- CreateIndex
CREATE INDEX "material_on_site_extracts_status_idx" ON "material_on_site_extracts"("status");

-- CreateIndex
CREATE INDEX "material_on_site_extracts_firestore_id_idx" ON "material_on_site_extracts"("firestore_id");

-- CreateIndex
CREATE INDEX "IDX_session_expire" ON "sessions"("expire");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing" ADD CONSTRAINT "billing_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing" ADD CONSTRAINT "billing_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing" ADD CONSTRAINT "billing_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_items" ADD CONSTRAINT "billing_items_billing_id_fkey" FOREIGN KEY ("billing_id") REFERENCES "billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_transactions" ADD CONSTRAINT "purchase_transactions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_transactions" ADD CONSTRAINT "purchase_transactions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_transactions" ADD CONSTRAINT "purchase_transactions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_transactions" ADD CONSTRAINT "purchase_transactions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_transaction_items" ADD CONSTRAINT "purchase_transaction_items_purchase_transaction_id_fkey" FOREIGN KEY ("purchase_transaction_id") REFERENCES "purchase_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_categories" ADD CONSTRAINT "material_categories_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "material_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_item_materials" ADD CONSTRAINT "boq_item_materials_boq_item_id_fkey" FOREIGN KEY ("boq_item_id") REFERENCES "boq_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_item_materials" ADD CONSTRAINT "boq_item_materials_material_category_id_fkey" FOREIGN KEY ("material_category_id") REFERENCES "material_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_material_category_id_fkey" FOREIGN KEY ("material_category_id") REFERENCES "material_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_allocations" ADD CONSTRAINT "purchase_invoice_allocations_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "purchase_invoice_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_inventory" ADD CONSTRAINT "contract_inventory_material_category_id_fkey" FOREIGN KEY ("material_category_id") REFERENCES "material_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_consumption" ADD CONSTRAINT "inventory_consumption_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "contract_inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "inventory_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "contract_inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_material_category_id_fkey" FOREIGN KEY ("material_category_id") REFERENCES "material_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_inventory" ADD CONSTRAINT "project_inventory_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_inventory" ADD CONSTRAINT "project_inventory_material_category_id_fkey" FOREIGN KEY ("material_category_id") REFERENCES "material_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumption_orders" ADD CONSTRAINT "consumption_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumption_order_lines" ADD CONSTRAINT "consumption_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "consumption_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumption_order_lines" ADD CONSTRAINT "consumption_order_lines_material_category_id_fkey" FOREIGN KEY ("material_category_id") REFERENCES "material_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_actual_costs" ADD CONSTRAINT "boq_actual_costs_consumption_order_id_fkey" FOREIGN KEY ("consumption_order_id") REFERENCES "consumption_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_orders" ADD CONSTRAINT "return_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_orders" ADD CONSTRAINT "return_orders_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_order_lines" ADD CONSTRAINT "return_order_lines_return_order_id_fkey" FOREIGN KEY ("return_order_id") REFERENCES "return_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_order_lines" ADD CONSTRAINT "return_order_lines_consumption_order_line_id_fkey" FOREIGN KEY ("consumption_order_line_id") REFERENCES "consumption_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_order_lines" ADD CONSTRAINT "return_order_lines_material_category_id_fkey" FOREIGN KEY ("material_category_id") REFERENCES "material_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_inventory_transfers" ADD CONSTRAINT "project_inventory_transfers_from_project_id_fkey" FOREIGN KEY ("from_project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_inventory_transfers" ADD CONSTRAINT "project_inventory_transfers_to_project_id_fkey" FOREIGN KEY ("to_project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_inventory_transfers" ADD CONSTRAINT "project_inventory_transfers_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_inventory_transfer_lines" ADD CONSTRAINT "project_inventory_transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "project_inventory_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_inventory_transfer_lines" ADD CONSTRAINT "project_inventory_transfer_lines_project_inventory_id_fkey" FOREIGN KEY ("project_inventory_id") REFERENCES "project_inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_inventory_transfer_lines" ADD CONSTRAINT "project_inventory_transfer_lines_material_category_id_fkey" FOREIGN KEY ("material_category_id") REFERENCES "material_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_assignments" ADD CONSTRAINT "subcontract_assignments_subcontractor_id_fkey" FOREIGN KEY ("subcontractor_id") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontract_extracts" ADD CONSTRAINT "subcontract_extracts_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "subcontract_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_on_site_extracts" ADD CONSTRAINT "material_on_site_extracts_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
