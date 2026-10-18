-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "national_id" TEXT NOT NULL,
    "is_saudi" BOOLEAN NOT NULL,
    "gosi_legacy_track" BOOLEAN NOT NULL DEFAULT false,
    "bank_iban" TEXT NOT NULL,
    "bank_name" TEXT,
    "hire_date" DATE NOT NULL,
    "termination_date" DATE,
    "basic_salary" DECIMAL(19,4) NOT NULL,
    "housing_allowance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "other_allowances" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "run_date" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "total_gross" DECIMAL(19,4) NOT NULL,
    "total_gosi_employee" DECIMAL(19,4) NOT NULL,
    "total_gosi_employer" DECIMAL(19,4) NOT NULL,
    "total_advance_deduction" DECIMAL(19,4) NOT NULL,
    "total_net" DECIMAL(19,4) NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_run_lines" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "payroll_run_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "basic_salary" DECIMAL(19,4) NOT NULL,
    "housing_allowance" DECIMAL(19,4) NOT NULL,
    "other_allowances" DECIMAL(19,4) NOT NULL,
    "gross" DECIMAL(19,4) NOT NULL,
    "gosi_employee_share" DECIMAL(19,4) NOT NULL,
    "gosi_employer_share" DECIMAL(19,4) NOT NULL,
    "advance_deduction" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "net" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "payroll_run_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_advances" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "grant_date" DATE NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "installment_amount" DECIMAL(19,4) NOT NULL,
    "cash_account_id" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_advance_deductions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "salary_advance_id" TEXT NOT NULL,
    "payroll_run_line_id" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "salary_advance_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "end_of_service_settlements" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "termination_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "years_of_service" DECIMAL(6,3) NOT NULL,
    "gross_entitlement" DECIMAL(19,4) NOT NULL,
    "entitlement_fraction" DECIMAL(6,4) NOT NULL,
    "net_entitlement" DECIMAL(19,4) NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "end_of_service_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employees_company_id_is_active_idx" ON "employees"("company_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_ref_key" ON "employees"("company_id", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_company_id_number_key" ON "payroll_runs"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_company_id_period_year_period_month_key" ON "payroll_runs"("company_id", "period_year", "period_month");

-- CreateIndex
CREATE INDEX "payroll_run_lines_company_id_employee_id_idx" ON "payroll_run_lines"("company_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_run_lines_payroll_run_id_employee_id_key" ON "payroll_run_lines"("payroll_run_id", "employee_id");

-- CreateIndex
CREATE INDEX "salary_advances_company_id_employee_id_idx" ON "salary_advances"("company_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "salary_advances_company_id_number_key" ON "salary_advances"("company_id", "number");

-- CreateIndex
CREATE INDEX "salary_advance_deductions_salary_advance_id_idx" ON "salary_advance_deductions"("salary_advance_id");

-- CreateIndex
CREATE INDEX "salary_advance_deductions_payroll_run_line_id_idx" ON "salary_advance_deductions"("payroll_run_line_id");

-- CreateIndex
CREATE INDEX "end_of_service_settlements_company_id_employee_id_idx" ON "end_of_service_settlements"("company_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "end_of_service_settlements_company_id_number_key" ON "end_of_service_settlements"("company_id", "number");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_advances" ADD CONSTRAINT "salary_advances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_advances" ADD CONSTRAINT "salary_advances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_advances" ADD CONSTRAINT "salary_advances_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_advances" ADD CONSTRAINT "salary_advances_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_advance_deductions" ADD CONSTRAINT "salary_advance_deductions_salary_advance_id_fkey" FOREIGN KEY ("salary_advance_id") REFERENCES "salary_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_advance_deductions" ADD CONSTRAINT "salary_advance_deductions_payroll_run_line_id_fkey" FOREIGN KEY ("payroll_run_line_id") REFERENCES "payroll_run_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "end_of_service_settlements" ADD CONSTRAINT "end_of_service_settlements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "end_of_service_settlements" ADD CONSTRAINT "end_of_service_settlements_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "end_of_service_settlements" ADD CONSTRAINT "end_of_service_settlements_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guard rails this diff does not generate on its own.
ALTER TABLE "employees" ADD CONSTRAINT "employees_basic_salary_check" CHECK ("basic_salary" > 0);
ALTER TABLE "employees" ADD CONSTRAINT "employees_housing_allowance_check" CHECK ("housing_allowance" >= 0);
ALTER TABLE "employees" ADD CONSTRAINT "employees_other_allowances_check" CHECK ("other_allowances" >= 0);

ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_period_month_check" CHECK ("period_month" BETWEEN 1 AND 12);
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_total_gross_check" CHECK ("total_gross" > 0);

ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_gross_check" CHECK ("gross" > 0);
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_net_check" CHECK ("net" >= 0);

ALTER TABLE "salary_advances" ADD CONSTRAINT "salary_advances_amount_check" CHECK ("amount" > 0);
ALTER TABLE "salary_advances" ADD CONSTRAINT "salary_advances_installment_amount_check" CHECK ("installment_amount" > 0);
ALTER TABLE "salary_advance_deductions" ADD CONSTRAINT "salary_advance_deductions_amount_check" CHECK ("amount" > 0);

ALTER TABLE "end_of_service_settlements" ADD CONSTRAINT "end_of_service_settlements_reason_check" CHECK ("reason" IN ('RESIGNATION', 'TERMINATION', 'OTHER'));
ALTER TABLE "end_of_service_settlements" ADD CONSTRAINT "end_of_service_settlements_years_check" CHECK ("years_of_service" >= 0);
ALTER TABLE "end_of_service_settlements" ADD CONSTRAINT "end_of_service_settlements_fraction_check" CHECK ("entitlement_fraction" BETWEEN 0 AND 1);
ALTER TABLE "end_of_service_settlements" ADD CONSTRAINT "end_of_service_settlements_net_check" CHECK ("net_entitlement" >= 0);

-- Posting keys for payroll.
ALTER TABLE "account_mappings" DROP CONSTRAINT "account_mappings_key_check";
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_key_check" CHECK ("key" IN (
  'INVENTORY', 'GRNI', 'PROJECT_ISSUE_EXPENSE', 'COUNT_LOSS', 'COUNT_GAIN',
  'ACCOUNTS_PAYABLE', 'VAT_INPUT', 'PURCHASE_PRICE_VARIANCE',
  'ACCOUNTS_RECEIVABLE', 'SALES_REVENUE', 'VAT_OUTPUT', 'COST_OF_GOODS_SOLD',
  'SALARY_EXPENSE', 'GOSI_EMPLOYER_EXPENSE', 'GOSI_PAYABLE', 'NET_PAY_PAYABLE',
  'SALARY_ADVANCES_RECEIVABLE', 'EOSB_EXPENSE', 'EOSB_PAYABLE'
));

-- Employee: mutable master data, like parties and warehouses.
GRANT SELECT, INSERT, UPDATE ON "employees" TO erp_app;
REVOKE DELETE ON "employees" FROM erp_app;
REVOKE DELETE ON "employees" FROM PUBLIC;

-- Everything downstream of a posting is insert-only, like every other accounting record.
GRANT SELECT, INSERT ON "payroll_runs" TO erp_app;
REVOKE UPDATE, DELETE ON "payroll_runs" FROM erp_app;
REVOKE UPDATE, DELETE ON "payroll_runs" FROM PUBLIC;
GRANT SELECT, INSERT ON "payroll_run_lines" TO erp_app;
REVOKE UPDATE, DELETE ON "payroll_run_lines" FROM erp_app;
REVOKE UPDATE, DELETE ON "payroll_run_lines" FROM PUBLIC;
GRANT SELECT, INSERT ON "salary_advances" TO erp_app;
REVOKE UPDATE, DELETE ON "salary_advances" FROM erp_app;
REVOKE UPDATE, DELETE ON "salary_advances" FROM PUBLIC;
GRANT SELECT, INSERT ON "salary_advance_deductions" TO erp_app;
REVOKE UPDATE, DELETE ON "salary_advance_deductions" FROM erp_app;
REVOKE UPDATE, DELETE ON "salary_advance_deductions" FROM PUBLIC;
GRANT SELECT, INSERT ON "end_of_service_settlements" TO erp_app;
REVOKE UPDATE, DELETE ON "end_of_service_settlements" FROM erp_app;
REVOKE UPDATE, DELETE ON "end_of_service_settlements" FROM PUBLIC;

