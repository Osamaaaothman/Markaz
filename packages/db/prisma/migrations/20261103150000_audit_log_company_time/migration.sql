-- Reading the audit log newest first, per company. Index only; no data is touched (the log stays append-only).
-- Rollback = DROP INDEX "audit_log_company_id_created_at_idx".
CREATE INDEX "audit_log_company_id_created_at_idx" ON "audit_log"("company_id", "created_at");
