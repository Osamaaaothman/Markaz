-- An employee gets a party and three ledger accounts of their own (advances owed by them, salary owed to them,
-- end-of-service owed to them), created under three parent groups chosen in the account mapping.
-- Expand-only. Rollback = drop the four employee columns, the advance column, and restore the previous
-- account_mappings_key_check (without the three EMPLOYEE_* keys). Nothing existing changes meaning: all new columns are
-- nullable and null means "use the company-wide accounts", which is how every existing employee and advance behaves.

ALTER TABLE "employees" ADD COLUMN "party_id" TEXT;
ALTER TABLE "employees" ADD COLUMN "advance_account_id" TEXT;
ALTER TABLE "employees" ADD COLUMN "salary_payable_account_id" TEXT;
ALTER TABLE "employees" ADD COLUMN "eosb_account_id" TEXT;

ALTER TABLE "employees" ADD CONSTRAINT "employees_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_advance_account_id_fkey" FOREIGN KEY ("advance_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_salary_payable_account_id_fkey" FOREIGN KEY ("salary_payable_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_eosb_account_id_fkey" FOREIGN KEY ("eosb_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The account an advance's balance lives in, fixed at grant. Null = the company-wide SALARY_ADVANCES_RECEIVABLE account.
ALTER TABLE "salary_advances" ADD COLUMN "receivable_account_id" TEXT;
ALTER TABLE "salary_advances" ADD CONSTRAINT "salary_advances_receivable_account_id_fkey" FOREIGN KEY ("receivable_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "employees_party_id_idx" ON "employees"("party_id");

-- The three parent groups the employee accounts are created under.
ALTER TABLE "account_mappings" DROP CONSTRAINT "account_mappings_key_check";
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_key_check" CHECK ("key" IN (
  'INVENTORY', 'GRNI', 'PROJECT_ISSUE_EXPENSE', 'COUNT_LOSS', 'COUNT_GAIN',
  'ACCOUNTS_PAYABLE', 'VAT_INPUT', 'PURCHASE_PRICE_VARIANCE',
  'ACCOUNTS_RECEIVABLE', 'SALES_REVENUE', 'VAT_OUTPUT', 'COST_OF_GOODS_SOLD',
  'SALARY_EXPENSE', 'GOSI_EMPLOYER_EXPENSE', 'GOSI_PAYABLE', 'NET_PAY_PAYABLE',
  'SALARY_ADVANCES_RECEIVABLE', 'EOSB_EXPENSE', 'EOSB_PAYABLE',
  'EMPLOYEE_ADVANCES_PARENT', 'EMPLOYEE_SALARY_PAYABLE_PARENT', 'EMPLOYEE_EOSB_PARENT'
));
