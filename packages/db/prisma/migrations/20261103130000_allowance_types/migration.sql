-- Allowance types: a company defines the allowances it pays (housing, transport, food, ...) and each employee is paid an
-- amount per type. Replaces the two fixed fields employees.housing_allowance / other_allowances.
-- Expand-only. Rollback = drop the three tables; the two old columns are untouched (but no longer read, so after a rollback
-- of the code that reads them, amounts changed since this migration would have to be copied back by hand).

CREATE TABLE "allowance_types" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "is_housing" BOOLEAN NOT NULL DEFAULT false,
    "in_gosi_base" BOOLEAN NOT NULL DEFAULT false,
    "in_eosb_base" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "allowance_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employee_allowances" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "allowance_type_id" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    CONSTRAINT "employee_allowances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_allowances_amount_check" CHECK ("amount" > 0)
);

CREATE TABLE "payroll_run_line_allowances" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "payroll_run_line_id" TEXT NOT NULL,
    "allowance_type_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "amount" DECIMAL(19,4) NOT NULL,
    "is_housing" BOOLEAN NOT NULL,
    "in_gosi_base" BOOLEAN NOT NULL,
    "in_eosb_base" BOOLEAN NOT NULL,
    CONSTRAINT "payroll_run_line_allowances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_run_line_allowances_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "allowance_types_company_id_code_key" ON "allowance_types"("company_id", "code");
CREATE INDEX "allowance_types_company_id_is_active_idx" ON "allowance_types"("company_id", "is_active");
CREATE UNIQUE INDEX "employee_allowances_employee_id_allowance_type_id_key" ON "employee_allowances"("employee_id", "allowance_type_id");
CREATE INDEX "employee_allowances_company_id_allowance_type_id_idx" ON "employee_allowances"("company_id", "allowance_type_id");
CREATE INDEX "payroll_run_line_allowances_payroll_run_line_id_idx" ON "payroll_run_line_allowances"("payroll_run_line_id");

ALTER TABLE "allowance_types" ADD CONSTRAINT "allowance_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_allowances" ADD CONSTRAINT "employee_allowances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_allowances" ADD CONSTRAINT "employee_allowances_allowance_type_id_fkey" FOREIGN KEY ("allowance_type_id") REFERENCES "allowance_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_run_line_allowances" ADD CONSTRAINT "payroll_run_line_allowances_payroll_run_line_id_fkey" FOREIGN KEY ("payroll_run_line_id") REFERENCES "payroll_run_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_run_line_allowances" ADD CONSTRAINT "payroll_run_line_allowances_allowance_type_id_fkey" FOREIGN KEY ("allowance_type_id") REFERENCES "allowance_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Carry today's two fixed allowances over, for every company that has employees, as two ordinary types:
--   HOUSING: counts in the GOSI base and in the end-of-service base, and is the WPS housing column (today's behaviour);
--   OTHER:   not in the GOSI base, in the end-of-service base (today's behaviour: Osama's 18 Oct 2026 decision).
-- Each employee's existing amounts become rows. Results of payroll and end-of-service for existing data are unchanged.
INSERT INTO "allowance_types" ("id", "company_id", "code", "name", "name_ar", "is_housing", "in_gosi_base", "in_eosb_base", "updated_at")
SELECT gen_random_uuid()::text, c."id", 'HOUSING', 'Housing allowance', 'بدل السكن', true, true, true, CURRENT_TIMESTAMP
FROM "companies" c WHERE EXISTS (SELECT 1 FROM "employees" e WHERE e."company_id" = c."id");
INSERT INTO "allowance_types" ("id", "company_id", "code", "name", "name_ar", "is_housing", "in_gosi_base", "in_eosb_base", "updated_at")
SELECT gen_random_uuid()::text, c."id", 'OTHER', 'Other allowances', 'بدلات أخرى', false, false, true, CURRENT_TIMESTAMP
FROM "companies" c WHERE EXISTS (SELECT 1 FROM "employees" e WHERE e."company_id" = c."id");

INSERT INTO "employee_allowances" ("id", "company_id", "employee_id", "allowance_type_id", "amount")
SELECT gen_random_uuid()::text, e."company_id", e."id", t."id", e."housing_allowance"
FROM "employees" e JOIN "allowance_types" t ON t."company_id" = e."company_id" AND t."code" = 'HOUSING'
WHERE e."housing_allowance" > 0;
INSERT INTO "employee_allowances" ("id", "company_id", "employee_id", "allowance_type_id", "amount")
SELECT gen_random_uuid()::text, e."company_id", e."id", t."id", e."other_allowances"
FROM "employees" e JOIN "allowance_types" t ON t."company_id" = e."company_id" AND t."code" = 'OTHER'
WHERE e."other_allowances" > 0;

-- Types and an employee's amounts are master data (changed in place); a payroll line's allowances are posted history (insert-only).
GRANT SELECT, INSERT, UPDATE ON "allowance_types" TO erp_app;
REVOKE DELETE ON "allowance_types" FROM erp_app;
REVOKE DELETE ON "allowance_types" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_allowances" TO erp_app;
GRANT SELECT, INSERT ON "payroll_run_line_allowances" TO erp_app;
REVOKE UPDATE, DELETE ON "payroll_run_line_allowances" FROM erp_app;
REVOKE UPDATE, DELETE ON "payroll_run_line_allowances" FROM PUBLIC;
