-- The account-mapping API already exposes these folders. Permit storing them so
-- single-role and dual-role party creation can provision their separate accounts.
ALTER TABLE "account_mappings"
  DROP CONSTRAINT "account_mappings_key_check",
  ADD CONSTRAINT "account_mappings_key_check" CHECK ("key" IN (
    'INVENTORY', 'GRNI', 'PROJECT_ISSUE_EXPENSE', 'COUNT_LOSS', 'COUNT_GAIN',
    'ACCOUNTS_PAYABLE', 'VAT_INPUT', 'PURCHASE_PRICE_VARIANCE',
    'ACCOUNTS_RECEIVABLE', 'SALES_REVENUE', 'VAT_OUTPUT', 'COST_OF_GOODS_SOLD',
    'SALARY_EXPENSE', 'GOSI_EMPLOYER_EXPENSE', 'GOSI_PAYABLE', 'NET_PAY_PAYABLE',
    'SALARY_ADVANCES_RECEIVABLE', 'EOSB_EXPENSE', 'EOSB_PAYABLE',
    'EMPLOYEE_ADVANCES_PARENT', 'EMPLOYEE_SALARY_PAYABLE_PARENT', 'EMPLOYEE_EOSB_PARENT',
    'CUSTOMER_LEDGER_PARENT', 'SUPPLIER_LEDGER_PARENT'
  ));
