-- CreateTable
CREATE TABLE "document_registry" (
    "id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "source_module" TEXT NOT NULL,
    "source_entity_id" TEXT NOT NULL,
    "document_no" TEXT NOT NULL,
    "project_id" TEXT,
    "contract_id" TEXT,
    "document_date" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "amount" DECIMAL(18,3),
    "phase" TEXT,
    "needs_action" BOOLEAN NOT NULL DEFAULT false,
    "action_kind" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_registry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_registry_source_module_source_entity_id_key" ON "document_registry"("source_module", "source_entity_id");

-- CreateIndex
CREATE INDEX "document_registry_contract_id_doc_type_status_idx" ON "document_registry"("contract_id", "doc_type", "status");

-- CreateIndex
CREATE INDEX "document_registry_project_id_doc_type_idx" ON "document_registry"("project_id", "doc_type");

-- CreateIndex
CREATE INDEX "document_registry_needs_action_status_idx" ON "document_registry"("needs_action", "status");

-- AddForeignKey
ALTER TABLE "document_registry" ADD CONSTRAINT "document_registry_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_registry" ADD CONSTRAINT "document_registry_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill MOS certificates
INSERT INTO "document_registry" (
    "id", "doc_type", "source_module", "source_entity_id", "document_no",
    "project_id", "contract_id", "document_date", "status", "amount", "phase",
    "needs_action", "action_kind", "is_deleted", "created_by", "created_at", "updated_at"
)
SELECT
    gen_random_uuid()::text,
    'mos',
    'billing',
    m.id,
    m.certificate_no,
    c.project_id,
    m.contract_id,
    m.extract_date,
    m.status,
    m.total_claimed,
    m.phase,
    (m.status = 'draft'),
    CASE WHEN m.status = 'draft' THEN 'approve' ELSE NULL END,
    false,
    m.created_by,
    m.created_at,
    m.updated_at
FROM "mos_certificates" m
JOIN "contracts" c ON c.id = m.contract_id
ON CONFLICT ("source_module", "source_entity_id") DO NOTHING;

-- Backfill client IPC (billing)
INSERT INTO "document_registry" (
    "id", "doc_type", "source_module", "source_entity_id", "document_no",
    "project_id", "contract_id", "document_date", "status", "amount", "phase",
    "needs_action", "action_kind", "is_deleted", "created_by", "created_at", "updated_at"
)
SELECT
    gen_random_uuid()::text,
    'ipc',
    'billing',
    b.id,
    b.billing_number,
    b.project_id,
    b.contract_id,
    b.date,
    b.status,
    b.net_payable,
    NULL,
    (b.status IN ('submitted', 'review') AND b.transaction_id IS NULL),
    CASE
        WHEN b.status = 'submitted' AND b.transaction_id IS NULL THEN 'approve'
        WHEN b.status = 'review' AND b.transaction_id IS NULL THEN 'approve'
        ELSE NULL
    END,
    b.is_deleted,
    NULL,
    b.created_at,
    b.updated_at
FROM "billing" b
WHERE b.is_deleted = false
ON CONFLICT ("source_module", "source_entity_id") DO NOTHING;
