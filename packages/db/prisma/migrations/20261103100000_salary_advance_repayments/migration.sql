-- Cash repayment of a salary advance. Expand-only. Rollback = drop the table (no other table changes).

-- CreateTable
CREATE TABLE "salary_advance_repayments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "salary_advance_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "repayment_date" DATE NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "cash_account_id" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_advance_repayments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "salary_advance_repayments_amount_check" CHECK ("amount" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "salary_advance_repayments_company_id_number_key" ON "salary_advance_repayments"("company_id", "number");
CREATE INDEX "salary_advance_repayments_salary_advance_id_idx" ON "salary_advance_repayments"("salary_advance_id");

-- AddForeignKey
ALTER TABLE "salary_advance_repayments" ADD CONSTRAINT "salary_advance_repayments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salary_advance_repayments" ADD CONSTRAINT "salary_advance_repayments_salary_advance_id_fkey" FOREIGN KEY ("salary_advance_id") REFERENCES "salary_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salary_advance_repayments" ADD CONSTRAINT "salary_advance_repayments_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salary_advance_repayments" ADD CONSTRAINT "salary_advance_repayments_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Insert-only like every record that follows a posting.
GRANT SELECT, INSERT ON "salary_advance_repayments" TO erp_app;
REVOKE UPDATE, DELETE ON "salary_advance_repayments" FROM erp_app;
REVOKE UPDATE, DELETE ON "salary_advance_repayments" FROM PUBLIC;
