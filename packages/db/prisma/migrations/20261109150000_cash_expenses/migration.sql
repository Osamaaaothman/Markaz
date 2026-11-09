CREATE TABLE IF NOT EXISTS "cash_expenses" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT NOT NULL REFERENCES companies(id),
  "number" TEXT NOT NULL,
  "expense_date" DATE NOT NULL,
  "amount" NUMERIC(19, 4) NOT NULL,
  "currency" TEXT NOT NULL,
  "cash_account_id" TEXT NOT NULL REFERENCES accounts(id),
  "expense_account_id" TEXT NOT NULL REFERENCES accounts(id),
  "description" TEXT,
  "reference" TEXT,
  "journal_entry_id" TEXT NOT NULL REFERENCES journal_entries(id),
  "actor_id" TEXT NOT NULL,
  "correlation_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("company_id", "number")
);
CREATE INDEX IF NOT EXISTS "cash_expenses_company_id_expense_date_idx" ON "cash_expenses" ("company_id", "expense_date");
GRANT SELECT, INSERT ON "cash_expenses" TO erp_app;
