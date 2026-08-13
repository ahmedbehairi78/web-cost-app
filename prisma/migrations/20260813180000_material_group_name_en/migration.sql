-- English name for material groups (Excel "Code" column in warehouse trees).
ALTER TABLE "material_groups" ADD COLUMN IF NOT EXISTS "name_en" TEXT;
