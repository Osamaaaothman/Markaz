CREATE TABLE "zatca_submission_attempts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "company_id" TEXT NOT NULL,
  "record_id" TEXT NOT NULL REFERENCES "zatca_invoice_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "stage" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3) NOT NULL,
  "warnings" JSONB NOT NULL,
  "errors" JSONB NOT NULL,
  "http_status" INTEGER
);
CREATE INDEX "zatca_submission_attempts_company_id_record_id_started_at_idx"
  ON "zatca_submission_attempts"("company_id", "record_id", "started_at");
-- Submission evidence is append-only for the runtime role.
GRANT SELECT, INSERT ON "zatca_submission_attempts" TO erp_app;
