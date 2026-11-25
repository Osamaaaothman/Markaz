-- Token types: read (default, the existing tokens), review (writes become cards), write (auto-mode rules).
ALTER TABLE "ai_access_tokens" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'read';
ALTER TABLE "ai_access_tokens" ADD CONSTRAINT "ai_access_tokens_scope_check" CHECK ("scope" IN ('read', 'review', 'write'));
-- The conversation that shows a token's cards; a plain id (the conversation may be deleted by its owner).
ALTER TABLE "ai_access_tokens" ADD COLUMN "conversation_id" TEXT;
