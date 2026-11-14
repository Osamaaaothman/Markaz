-- The API and UI distinguish customers and suppliers, while legacy kinds remain valid.
-- Expand the check atomically without changing existing parties or their references.
ALTER TABLE "parties"
  DROP CONSTRAINT "parties_kind_check",
  ADD CONSTRAINT "parties_kind_check"
    CHECK ("kind" IN ('SUPPLIER', 'CUSTOMER', 'COMPANY', 'PERSON', 'EMPLOYEE', 'OTHER'));
