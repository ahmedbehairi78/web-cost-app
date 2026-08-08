-- DropForeignKey
ALTER TABLE "fixed_asset_depreciation_entries" DROP CONSTRAINT "fixed_asset_depreciation_entries_asset_id_fkey";

-- DropForeignKey
ALTER TABLE "fixed_assets" DROP CONSTRAINT "fixed_assets_group_id_fkey";

-- DropForeignKey
ALTER TABLE "payroll_run_lines" DROP CONSTRAINT "payroll_run_lines_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "payroll_run_lines" DROP CONSTRAINT "payroll_run_lines_run_id_fkey";

-- AlterTable
ALTER TABLE "fixed_asset_groups" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "fixed_assets" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "overhead_allocation_periods" ALTER COLUMN "distribution_basis" SET DEFAULT 'billing_works';

-- AlterTable
ALTER TABLE "payroll_employees" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "payroll_runs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "fixed_asset_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_depreciation_entries" ADD CONSTRAINT "fixed_asset_depreciation_entries_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "payroll_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "consumption_allocation_templates_contract_id_material_category_" RENAME TO "consumption_allocation_templates_contract_id_material_categ_idx";
