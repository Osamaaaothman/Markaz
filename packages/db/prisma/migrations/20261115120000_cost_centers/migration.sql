CREATE TABLE "cost_centers" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "name_ar" TEXT,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('COST_CENTER', 'PROJECT', 'DEPARTMENT')),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cost_centers_company_id_code_key" UNIQUE ("company_id", "code")
);
ALTER TABLE "cash_expense_lines" ADD COLUMN "cost_center_id" TEXT REFERENCES "cost_centers"("id") ON DELETE RESTRICT;
ALTER TABLE "journal_entry_lines" ADD COLUMN "cost_center_id" TEXT REFERENCES "cost_centers"("id") ON DELETE RESTRICT;
GRANT SELECT, INSERT, UPDATE ON "cost_centers" TO erp_app;
