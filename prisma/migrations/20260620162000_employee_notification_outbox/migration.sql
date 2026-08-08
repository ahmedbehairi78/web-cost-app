-- WhatsApp salary-notification outbox keyed to a raw employee phone (not an app user)
CREATE TABLE "employee_notification_outbox" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "template_name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dedupe_hash" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "provider_message_id" TEXT,
    "scheduled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_notification_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_notification_outbox_dedupe_hash_key" ON "employee_notification_outbox"("dedupe_hash");
CREATE INDEX "employee_notification_outbox_status_idx" ON "employee_notification_outbox"("status");
CREATE INDEX "employee_notification_outbox_employee_id_idx" ON "employee_notification_outbox"("employee_id");

ALTER TABLE "employee_notification_outbox" ADD CONSTRAINT "employee_notification_outbox_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "payroll_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
