CREATE TABLE "quotation_email_attempts" (
  "id" TEXT PRIMARY KEY, "company_id" TEXT NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "quotation_id" TEXT NOT NULL REFERENCES "quotations"("id") ON DELETE RESTRICT,
  "request_key" TEXT NOT NULL, "recipient" TEXT NOT NULL, "language" TEXT NOT NULL CHECK ("language" IN ('ar','en')),
  "subject" TEXT, "status" TEXT NOT NULL CHECK ("status" IN ('SENDING','ACCEPTED','DELIVERED','FAILED','UNKNOWN','BOUNCED','DELAYED','COMPLAINED')),
  "provider" TEXT, "provider_id" TEXT, "error_code" TEXT,
  "sent_at" TIMESTAMPTZ(3), "checked_at" TIMESTAMPTZ(3), "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "created_by" TEXT NOT NULL, "updated_by" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX "quotation_email_attempts_company_id_request_key_key" ON "quotation_email_attempts" ("company_id", "request_key");
CREATE INDEX "quotation_email_attempts_company_id_quotation_id_id_idx" ON "quotation_email_attempts" ("company_id", "quotation_id", "id");
CREATE INDEX "quotation_email_attempts_quotation_id_idx" ON "quotation_email_attempts" ("quotation_id");
GRANT SELECT, INSERT, UPDATE ON quotation_email_attempts TO erp_app;
