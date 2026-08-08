-- CreateTable
CREATE TABLE "consumption_allocation_templates" (
    "id" SERIAL NOT NULL,
    "contract_id" TEXT NOT NULL,
    "material_category_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "basis" TEXT NOT NULL DEFAULT 'boq_qty',
    "weights_json" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consumption_allocation_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consumption_allocation_templates_contract_id_material_category_id_idx" ON "consumption_allocation_templates"("contract_id", "material_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "consumption_allocation_templates_contract_id_material_categ_key" ON "consumption_allocation_templates"("contract_id", "material_category_id", "name");
