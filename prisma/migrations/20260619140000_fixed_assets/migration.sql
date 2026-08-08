-- Fixed Assets Module
-- Tables: fixed_asset_groups, fixed_assets, fixed_asset_depreciation_entries

CREATE TABLE "fixed_asset_groups" (
    "id" SERIAL PRIMARY KEY,
    "group_name" TEXT NOT NULL,
    "default_asset_account_code" TEXT NOT NULL,
    "default_depreciation_account_code" TEXT NOT NULL,
    "default_expense_account_code" TEXT NOT NULL,
    "default_depreciation_model" TEXT NOT NULL DEFAULT 'straight_line',
    "default_useful_life_years" DECIMAL(18,3) NOT NULL,
    "default_annual_rate" DECIMAL(18,6),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "asset_number" TEXT NOT NULL UNIQUE,
    "asset_name" TEXT NOT NULL,
    "group_id" INTEGER REFERENCES "fixed_asset_groups"("id"),
    "acquisition_date" TEXT NOT NULL,
    "asset_value" DECIMAL(18,3) NOT NULL,
    "salvage_value" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "useful_life_years" DECIMAL(18,3) NOT NULL,
    "depreciation_model" TEXT NOT NULL,
    "annual_depreciation_rate" DECIMAL(18,6) NOT NULL,
    "asset_account_code" TEXT NOT NULL,
    "asset_account_name" TEXT,
    "accumulated_depreciation_account_code" TEXT NOT NULL,
    "accumulated_depreciation_account_name" TEXT,
    "expense_account_code" TEXT NOT NULL,
    "expense_account_name" TEXT,
    "cost_center_id" TEXT,
    "cost_center_type" TEXT,
    "book_value" DECIMAL(18,3) NOT NULL,
    "opening_accumulated_depr" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending_setup',
    "purchase_transaction_id" TEXT,
    "notes" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "fixed_asset_depreciation_entries" (
    "id" SERIAL PRIMARY KEY,
    "asset_id" TEXT NOT NULL REFERENCES "fixed_assets"("id") ON DELETE CASCADE,
    "period_label" TEXT NOT NULL,
    "period_start" TEXT NOT NULL,
    "period_end" TEXT NOT NULL,
    "depreciation_amount" DECIMAL(18,3) NOT NULL,
    "book_value_before" DECIMAL(18,3) NOT NULL,
    "book_value_after" DECIMAL(18,3) NOT NULL,
    "transaction_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "fixed_assets_status_idx" ON "fixed_assets"("status");
CREATE INDEX "fixed_assets_group_id_idx" ON "fixed_assets"("group_id");
CREATE INDEX "fixed_assets_asset_account_code_idx" ON "fixed_assets"("asset_account_code");
CREATE INDEX "fixed_asset_depreciation_entries_asset_id_idx" ON "fixed_asset_depreciation_entries"("asset_id");
CREATE INDEX "fixed_asset_depreciation_entries_period_label_idx" ON "fixed_asset_depreciation_entries"("period_label");

-- Seed default asset groups
INSERT INTO "fixed_asset_groups"
    ("group_name", "default_asset_account_code", "default_depreciation_account_code", "default_expense_account_code", "default_depreciation_model", "default_useful_life_years", "default_annual_rate")
VALUES
    ('وسائل النقل',         '11101001', '11901001', '52201001', 'straight_line',    5,  0.200000),
    ('الآلات والمعدات',     '11201001', '11902001', '52202001', 'straight_line',    10, 0.100000),
    ('الأثاث والتجهيزات',  '11301001', '11903001', '52203001', 'straight_line',    10, 0.100000),
    ('الأجهزة والحاسبات',  '11401001', '11904001', '52204001', 'straight_line',    3,  0.333333),
    ('المباني والإنشاءات', '11501001', '11905001', '52205001', 'straight_line',    25, 0.040000);
