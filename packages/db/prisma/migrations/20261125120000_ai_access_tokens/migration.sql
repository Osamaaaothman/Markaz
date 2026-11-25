-- Personal tokens for the read-only MCP endpoint. Only the SHA-256 of a token is stored.
-- CreateTable
CREATE TABLE "ai_access_tokens" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_access_tokens_token_hash_key" ON "ai_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "ai_access_tokens_company_id_user_id_idx" ON "ai_access_tokens"("company_id", "user_id");

-- AddForeignKey
ALTER TABLE "ai_access_tokens" ADD CONSTRAINT "ai_access_tokens_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_access_tokens" ADD CONSTRAINT "ai_access_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Runtime role grants (docs/04-DATA-MODEL-RULES.md). A token is revoked (revoked_at), never deleted,
-- so the audit trail of what it was used for keeps its subject.
GRANT SELECT, INSERT, UPDATE ON "ai_access_tokens" TO erp_app;
REVOKE DELETE ON "ai_access_tokens" FROM erp_app;
