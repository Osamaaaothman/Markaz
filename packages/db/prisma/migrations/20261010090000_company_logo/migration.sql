-- The company logo is stored as an attachment owned by the company itself.
-- Contract-safe: only widens an allowed list. Rollback = restore the previous CHECK (after removing COMPANY rows).
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_owner_type_check";
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_owner_type_check"
  CHECK ("owner_type" IN ('SALES_INVOICE', 'SUPPLIER_INVOICE', 'PAYMENT', 'JOURNAL_ENTRY', 'PURCHASE_ORDER', 'PARTY', 'ITEM', 'COMPANY'));
