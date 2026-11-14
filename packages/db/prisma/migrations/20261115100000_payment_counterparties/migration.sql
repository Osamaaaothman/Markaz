-- Retain legacy vouchers and their direction-based role; new vouchers identify the counterparty.
ALTER TABLE "payments" ALTER COLUMN "party_id" DROP NOT NULL;
ALTER TABLE "payments" ADD COLUMN "counterparty_kind" TEXT;
ALTER TABLE "payments" ADD COLUMN "counter_account_id" TEXT REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_counterparty_check" CHECK (COALESCE((
  ("counterparty_kind" IS NULL AND "party_id" IS NOT NULL) OR
  ("counterparty_kind" IN ('CUSTOMER', 'SUPPLIER', 'EMPLOYEE') AND "party_id" IS NOT NULL AND "counter_account_id" IS NOT NULL) OR
  ("counterparty_kind" = 'ACCOUNT' AND "party_id" IS NULL AND "counter_account_id" IS NOT NULL)
), false));
-- Reversal can mark a voucher void, without granting changes to its financial fields.
GRANT UPDATE ("voided_at", "reversed_by_payment_id") ON "payments" TO erp_app;

ALTER TABLE "account_mappings" DROP CONSTRAINT "account_mappings_key_check";
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_key_check" CHECK ("key" IN (
  'INVENTORY', 'GRNI', 'PROJECT_ISSUE_EXPENSE', 'COUNT_LOSS', 'COUNT_GAIN',
  'ACCOUNTS_PAYABLE', 'VAT_INPUT', 'PURCHASE_PRICE_VARIANCE',
  'ACCOUNTS_RECEIVABLE', 'SALES_REVENUE', 'VAT_OUTPUT', 'COST_OF_GOODS_SOLD',
  'SALARY_EXPENSE', 'GOSI_EMPLOYER_EXPENSE', 'GOSI_PAYABLE', 'NET_PAY_PAYABLE',
  'SALARY_ADVANCES_RECEIVABLE', 'EOSB_EXPENSE', 'EOSB_PAYABLE',
  'EMPLOYEE_ADVANCES_PARENT', 'EMPLOYEE_SALARY_PAYABLE_PARENT', 'EMPLOYEE_EOSB_PARENT',
  'CUSTOMER_LEDGER_PARENT', 'SUPPLIER_LEDGER_PARENT', 'CASH_ACCOUNTS_PARENT', 'BANK_ACCOUNTS_PARENT'
));

-- Standard-template defaults are configuration data. Custom charts can select their folders in settings.
INSERT INTO "account_mappings" ("id", "company_id", "key", "account_id", "updated_at")
SELECT 'payment-folder-' || a.id, a.company_id,
       CASE a.code WHEN '11101' THEN 'CASH_ACCOUNTS_PARENT' ELSE 'BANK_ACCOUNTS_PARENT' END,
       a.id, CURRENT_TIMESTAMP
FROM "accounts" a
WHERE a.code IN ('11101', '11102') AND a.type = 'ASSET' AND NOT a.is_postable AND a.is_active
ON CONFLICT ("company_id", "key") DO NOTHING;
