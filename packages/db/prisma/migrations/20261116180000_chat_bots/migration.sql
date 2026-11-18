-- CreateTable
CREATE TABLE "bot_connections" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "transport" TEXT NOT NULL,
    "credentials_ciphertext" BYTEA NOT NULL,
    "public_config" JSONB NOT NULL,
    "identity" JSONB,
    "enabled_features" TEXT[],
    "approval_ceiling" DECIMAL(19,4),
    "data_sharing_accepted_at" TIMESTAMP(3) NOT NULL,
    "data_sharing_accepted_by" TEXT NOT NULL,
    "poll_offset" TEXT,
    "last_health_at" TIMESTAMP(3),
    "last_health_ok" BOOLEAN,
    "last_health_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "bot_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_identity_links" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "external_user_id" TEXT NOT NULL,
    "external_handle" TEXT,
    "private_chat_id" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,
    "disabled_alerts" TEXT[],
    "unreachable_at" TIMESTAMP(3),
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "revoked_reason" TEXT,

    CONSTRAINT "bot_identity_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_link_codes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_action_tokens" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "user_id" TEXT,
    "intent" JSONB NOT NULL,
    "single_use" BOOLEAN NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_action_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_chat_sessions" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "awaiting" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_broadcast_targets" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "disabled_at" TIMESTAMP(3),

    CONSTRAINT "bot_broadcast_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_subscriptions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "user_id" TEXT,
    "broadcast_target_id" TEXT,
    "report_type" TEXT NOT NULL,
    "send_time" TEXT NOT NULL,
    "weekday" INTEGER,
    "attach_pdf" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL,
    "last_period_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "disabled_at" TIMESTAMP(3),

    CONSTRAINT "bot_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_alert_marks" (
    "company_id" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "subject_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_alert_marks_pkey" PRIMARY KEY ("company_id","alert_type","subject_key")
);

-- CreateTable
CREATE TABLE "bot_sent_messages" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_sent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_delivery_logs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "user_id" TEXT,
    "chat_id" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_delivery_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_inbound_events" (
    "connection_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_inbound_events_pkey" PRIMARY KEY ("connection_id","event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_connections_company_id_provider_key" ON "bot_connections"("company_id", "provider");

-- CreateIndex
CREATE INDEX "bot_identity_links_company_id_user_id_idx" ON "bot_identity_links"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "bot_link_codes_code_hash_key" ON "bot_link_codes"("code_hash");

-- CreateIndex
CREATE INDEX "bot_link_codes_user_id_idx" ON "bot_link_codes"("user_id");

-- CreateIndex
CREATE INDEX "bot_action_tokens_expires_at_idx" ON "bot_action_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "bot_chat_sessions_connection_id_chat_id_user_id_key" ON "bot_chat_sessions"("connection_id", "chat_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "bot_broadcast_targets_connection_id_chat_id_key" ON "bot_broadcast_targets"("connection_id", "chat_id");

-- CreateIndex
CREATE INDEX "bot_subscriptions_company_id_disabled_at_idx" ON "bot_subscriptions"("company_id", "disabled_at");

-- CreateIndex
CREATE INDEX "bot_sent_messages_company_id_subject_type_subject_id_idx" ON "bot_sent_messages"("company_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "bot_delivery_logs_connection_id_created_at_idx" ON "bot_delivery_logs"("connection_id", "created_at");

-- CreateIndex
CREATE INDEX "bot_inbound_events_received_at_idx" ON "bot_inbound_events"("received_at");

-- AddForeignKey
ALTER TABLE "bot_connections" ADD CONSTRAINT "bot_connections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_identity_links" ADD CONSTRAINT "bot_identity_links_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "bot_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_identity_links" ADD CONSTRAINT "bot_identity_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_link_codes" ADD CONSTRAINT "bot_link_codes_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "bot_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_action_tokens" ADD CONSTRAINT "bot_action_tokens_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "bot_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_chat_sessions" ADD CONSTRAINT "bot_chat_sessions_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "bot_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_broadcast_targets" ADD CONSTRAINT "bot_broadcast_targets_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "bot_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_subscriptions" ADD CONSTRAINT "bot_subscriptions_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "bot_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_subscriptions" ADD CONSTRAINT "bot_subscriptions_broadcast_target_id_fkey" FOREIGN KEY ("broadcast_target_id") REFERENCES "bot_broadcast_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_sent_messages" ADD CONSTRAINT "bot_sent_messages_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "bot_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_delivery_logs" ADD CONSTRAINT "bot_delivery_logs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "bot_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_inbound_events" ADD CONSTRAINT "bot_inbound_events_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "bot_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Hand-written: integrity rules the Prisma schema cannot express ─────────────────────────
ALTER TABLE "bot_connections" ADD CONSTRAINT "bot_connections_provider_check" CHECK ("provider" IN ('telegram', 'discord'));
ALTER TABLE "bot_connections" ADD CONSTRAINT "bot_connections_status_check" CHECK ("status" IN ('ACTIVE', 'DISABLED'));
ALTER TABLE "bot_connections" ADD CONSTRAINT "bot_connections_transport_check" CHECK ("transport" IN ('webhook', 'polling'));
ALTER TABLE "bot_connections" ADD CONSTRAINT "bot_connections_ceiling_check" CHECK ("approval_ceiling" IS NULL OR "approval_ceiling" >= 0);
ALTER TABLE "bot_identity_links" ADD CONSTRAINT "bot_identity_links_language_check" CHECK ("language" IN ('ar', 'en'));
ALTER TABLE "bot_link_codes" ADD CONSTRAINT "bot_link_codes_language_check" CHECK ("language" IN ('ar', 'en'));
ALTER TABLE "bot_subscriptions" ADD CONSTRAINT "bot_subscriptions_language_check" CHECK ("language" IN ('ar', 'en'));
ALTER TABLE "bot_subscriptions" ADD CONSTRAINT "bot_subscriptions_report_type_check" CHECK ("report_type" IN ('DAILY_SUMMARY', 'WEEKLY_SUMMARY', 'MONTHLY_SUMMARY'));
ALTER TABLE "bot_subscriptions" ADD CONSTRAINT "bot_subscriptions_send_time_check" CHECK ("send_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "bot_subscriptions" ADD CONSTRAINT "bot_subscriptions_weekday_check" CHECK ("weekday" IS NULL OR "weekday" BETWEEN 0 AND 6);
-- Exactly one audience: a linked user or a broadcast target.
ALTER TABLE "bot_subscriptions" ADD CONSTRAINT "bot_subscriptions_audience_check" CHECK (("user_id" IS NULL) <> ("broadcast_target_id" IS NULL));

-- One live link per chat account, and one live link per ERP user, per connection.
CREATE UNIQUE INDEX "bot_identity_links_live_external_key" ON "bot_identity_links" ("connection_id", "external_user_id") WHERE "revoked_at" IS NULL;
CREATE UNIQUE INDEX "bot_identity_links_live_user_key" ON "bot_identity_links" ("connection_id", "user_id") WHERE "revoked_at" IS NULL;

-- Runtime role grants (docs/04-DATA-MODEL-RULES.md). Operational tables, ordinary DML.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "bot_connections", "bot_identity_links", "bot_link_codes", "bot_action_tokens", "bot_chat_sessions",
  "bot_broadcast_targets", "bot_subscriptions", "bot_alert_marks", "bot_sent_messages",
  "bot_delivery_logs", "bot_inbound_events"
TO erp_app;

-- Permission catalog + standard Admin role grant (custom roles keep their grants as they are).
INSERT INTO "permissions" ("id", "code", "description")
VALUES
  (gen_random_uuid()::text, 'bot_connection:read', 'View chat bot connections, linked accounts and delivery history'),
  (gen_random_uuid()::text, 'bot_connection:manage', 'Connect, configure, disable and remove chat bots')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."name" = 'Admin'
  AND p."code" IN ('bot_connection:read', 'bot_connection:manage')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
