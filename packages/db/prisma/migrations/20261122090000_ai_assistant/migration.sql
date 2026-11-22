-- AI assistant (docs/Planning/ai-assistant-plan.md).

-- CreateTable
CREATE TABLE "ai_provider_configs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "base_url" TEXT,
    "api_key_ciphertext" BYTEA,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_mode_enabled" BOOLEAN NOT NULL DEFAULT false,
    "monthly_token_limit" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ai_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'ask',
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "next_item_number" INTEGER NOT NULL DEFAULT 1,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT false,
    "ui_text" TEXT,
    "ui_blocks" JSONB,
    "ui_timeline" JSONB,
    "provider" TEXT,
    "model" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_change_items" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "message_id" TEXT,
    "item_key" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "risk" TEXT NOT NULL,
    "depends_on" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "result" JSONB,
    "link" JSONB,
    "error_code" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_change_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_daily" (
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_usage_daily_pkey" PRIMARY KEY ("company_id","user_id","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_configs_company_id_key" ON "ai_provider_configs"("company_id");

-- CreateIndex
CREATE INDEX "ai_conversations_company_id_user_id_updated_at_idx" ON "ai_conversations"("company_id", "user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_messages_conversation_id_seq_key" ON "ai_messages"("conversation_id", "seq");

-- CreateIndex
CREATE INDEX "ai_change_items_company_id_status_idx" ON "ai_change_items"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_change_items_conversation_id_item_key_key" ON "ai_change_items"("conversation_id", "item_key");

-- AddForeignKey
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_change_items" ADD CONSTRAINT "ai_change_items_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Allowed values.
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_provider_check" CHECK ("provider" IN ('google', 'anthropic', 'openai', 'openai-compatible', 'ollama'));
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_limit_check" CHECK ("monthly_token_limit" IS NULL OR "monthly_token_limit" > 0);
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_mode_check" CHECK ("mode" IN ('ask', 'review', 'auto'));
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_status_check" CHECK ("status" IN ('IDLE', 'AWAITING_APPROVAL'));
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_role_check" CHECK ("role" IN ('human', 'ai', 'tool', 'system', 'notice'));
ALTER TABLE "ai_change_items" ADD CONSTRAINT "ai_change_items_status_check" CHECK ("status" IN ('PROPOSED', 'EXECUTED', 'REJECTED', 'SKIPPED', 'FAILED'));
ALTER TABLE "ai_change_items" ADD CONSTRAINT "ai_change_items_risk_check" CHECK ("risk" IN ('low', 'high'));

-- A change that left PROPOSED is a record of what happened: it can never be edited again.
CREATE FUNCTION ai_change_items_freeze() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'PROPOSED' THEN
    RAISE EXCEPTION 'ai_change_items % is final (%) and cannot be changed', OLD."id", OLD."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_change_items_freeze
  BEFORE UPDATE ON "ai_change_items"
  FOR EACH ROW EXECUTE FUNCTION ai_change_items_freeze();

-- Runtime role grants (docs/04-DATA-MODEL-RULES.md). Conversations can be deleted by their owner
-- (cascades to messages); change items are kept with them only while the conversation exists.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "ai_provider_configs", "ai_conversations", "ai_messages", "ai_change_items", "ai_usage_daily"
TO erp_app;

-- Permission catalog + standard Admin role grant (custom roles keep their grants as they are).
INSERT INTO "permissions" ("id", "code", "description")
VALUES
  (gen_random_uuid()::text, 'ai_assistant:use', 'Use the AI assistant to ask questions (read only)'),
  (gen_random_uuid()::text, 'ai_assistant:interact', 'Let the AI assistant propose changes for review'),
  (gen_random_uuid()::text, 'ai_assistant:auto', 'Let the AI assistant run low-risk changes without review'),
  (gen_random_uuid()::text, 'ai_settings:manage', 'Configure the AI provider, model, key and limits')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."name" = 'Admin'
  AND p."code" IN ('ai_assistant:use', 'ai_assistant:interact', 'ai_assistant:auto', 'ai_settings:manage')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
