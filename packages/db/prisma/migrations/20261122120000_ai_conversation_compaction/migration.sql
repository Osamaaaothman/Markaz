-- AI assistant: conversation compaction (a summary replaces old messages in the model's context).
ALTER TABLE "ai_conversations" ADD COLUMN "summary" TEXT;
ALTER TABLE "ai_conversations" ADD COLUMN "summary_through_seq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ai_conversations" ADD COLUMN "compactions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_summary_seq_check" CHECK ("summary_through_seq" >= 0);
