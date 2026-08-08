-- AlterTable
ALTER TABLE "users" ADD COLUMN "phone_e164" TEXT,
ADD COLUMN "whatsapp_opt_in" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "preferred_language" TEXT NOT NULL DEFAULT 'ar',
ADD COLUMN "whatsapp_notify_types" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "notification_key" TEXT NOT NULL,
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

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_link_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "notification_key" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_link_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_dedupe_hash_key" ON "notification_outbox"("dedupe_hash");

-- CreateIndex
CREATE INDEX "notification_outbox_status_scheduled_at_idx" ON "notification_outbox"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "notification_outbox_notification_key_idx" ON "notification_outbox"("notification_key");

-- CreateIndex
CREATE UNIQUE INDEX "approval_link_tokens_token_hash_key" ON "approval_link_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "approval_link_tokens_user_id_notification_key_idx" ON "approval_link_tokens"("user_id", "notification_key");

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_link_tokens" ADD CONSTRAINT "approval_link_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
