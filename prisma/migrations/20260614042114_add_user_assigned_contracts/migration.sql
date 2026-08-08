-- AlterTable
ALTER TABLE "users" ADD COLUMN     "assigned_contract_ids" JSONB NOT NULL DEFAULT '[]';
