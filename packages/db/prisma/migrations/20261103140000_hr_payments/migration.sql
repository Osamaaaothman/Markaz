-- Paying what payroll and end-of-service left owed: salaries, social insurance (GOSI) and the end-of-service gratuity.
-- Expand-only. Rollback = drop hr_payment_items, hr_payments and the two snapshot columns.

-- The account each net pay / gratuity was credited to, so that paying it debits the same account.
ALTER TABLE "payroll_run_lines" ADD COLUMN "net_pay_account_id" TEXT;
ALTER TABLE "end_of_service_settlements" ADD COLUMN "payable_account_id" TEXT;
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_net_pay_account_id_fkey" FOREIGN KEY ("net_pay_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "end_of_service_settlements" ADD CONSTRAINT "end_of_service_settlements_payable_account_id_fkey" FOREIGN KEY ("payable_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill, exactly and not by guessing: a past run used the employee's own account only if that account was credited by the
-- run's own journal entry. Anything else was posted to the company-wide account and stays null (the code then uses the
-- NET_PAY_PAYABLE / EOSB_PAYABLE mapping, as before).
UPDATE "payroll_run_lines" l
SET "net_pay_account_id" = e."salary_payable_account_id"
FROM "employees" e, "payroll_runs" r
WHERE e."id" = l."employee_id" AND r."id" = l."payroll_run_id" AND e."salary_payable_account_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "journal_entry_lines" j WHERE j."journal_entry_id" = r."journal_entry_id" AND j."account_id" = e."salary_payable_account_id" AND j."credit" > 0);
UPDATE "end_of_service_settlements" s
SET "payable_account_id" = e."eosb_account_id"
FROM "employees" e
WHERE e."id" = s."employee_id" AND e."eosb_account_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "journal_entry_lines" j WHERE j."journal_entry_id" = s."journal_entry_id" AND j."account_id" = e."eosb_account_id" AND j."credit" > 0);

CREATE TABLE "hr_payments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "payment_date" DATE NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "cash_account_id" TEXT NOT NULL,
    "payroll_run_id" TEXT,
    "settlement_id" TEXT,
    "notes" TEXT,
    "journal_entry_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hr_payments_kind_check" CHECK ("kind" IN ('SALARY', 'GOSI', 'END_OF_SERVICE')),
    CONSTRAINT "hr_payments_amount_check" CHECK ("amount" > 0)
);

CREATE TABLE "hr_payment_items" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "hr_payment_id" TEXT NOT NULL,
    "payroll_run_line_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "account_id" TEXT NOT NULL,
    CONSTRAINT "hr_payment_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hr_payment_items_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "hr_payments_company_id_number_key" ON "hr_payments"("company_id", "number");
CREATE UNIQUE INDEX "hr_payments_settlement_id_key" ON "hr_payments"("settlement_id");
CREATE INDEX "hr_payments_company_id_kind_idx" ON "hr_payments"("company_id", "kind");
CREATE INDEX "hr_payments_company_id_payroll_run_id_idx" ON "hr_payments"("company_id", "payroll_run_id");
CREATE UNIQUE INDEX "hr_payment_items_payroll_run_line_id_key" ON "hr_payment_items"("payroll_run_line_id");
CREATE INDEX "hr_payment_items_hr_payment_id_idx" ON "hr_payment_items"("hr_payment_id");

ALTER TABLE "hr_payments" ADD CONSTRAINT "hr_payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_payments" ADD CONSTRAINT "hr_payments_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_payments" ADD CONSTRAINT "hr_payments_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_payments" ADD CONSTRAINT "hr_payments_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "end_of_service_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_payments" ADD CONSTRAINT "hr_payments_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_payment_items" ADD CONSTRAINT "hr_payment_items_hr_payment_id_fkey" FOREIGN KEY ("hr_payment_id") REFERENCES "hr_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_payment_items" ADD CONSTRAINT "hr_payment_items_payroll_run_line_id_fkey" FOREIGN KEY ("payroll_run_line_id") REFERENCES "payroll_run_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_payment_items" ADD CONSTRAINT "hr_payment_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_payment_items" ADD CONSTRAINT "hr_payment_items_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Posted documents are insert-only for the runtime role.
GRANT SELECT, INSERT ON "hr_payments" TO erp_app;
REVOKE UPDATE, DELETE ON "hr_payments" FROM erp_app;
REVOKE UPDATE, DELETE ON "hr_payments" FROM PUBLIC;
GRANT SELECT, INSERT ON "hr_payment_items" TO erp_app;
REVOKE UPDATE, DELETE ON "hr_payment_items" FROM erp_app;
REVOKE UPDATE, DELETE ON "hr_payment_items" FROM PUBLIC;
