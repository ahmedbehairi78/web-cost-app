-- CreateTable
CREATE TABLE "user_notification_reads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "notification_key" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissed_at" TIMESTAMP(3),

    CONSTRAINT "user_notification_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_notification_reads_user_id_idx" ON "user_notification_reads"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_notification_reads_user_id_notification_key_key" ON "user_notification_reads"("user_id", "notification_key");

-- AddForeignKey
ALTER TABLE "user_notification_reads" ADD CONSTRAINT "user_notification_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
