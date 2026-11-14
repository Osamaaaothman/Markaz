-- A single party can participate in both sales and purchasing. Existing IDs and
-- document relationships are retained; no historical accounting data is changed.
ALTER TABLE "parties"
  DROP CONSTRAINT "parties_kind_check",
  ADD CONSTRAINT "parties_kind_check"
    CHECK ("kind" IN ('SUPPLIER', 'CUSTOMER', 'CUSTOMER_SUPPLIER', 'COMPANY', 'PERSON', 'EMPLOYEE', 'OTHER'));
