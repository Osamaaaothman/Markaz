-- M6 sales: debit notes, the AR mirror of M5's supplier debit note (docs/01-OPEN-DECISIONS.md,
-- new section on sales debit notes). A sales_invoices row is now an INVOICE, a CREDIT_NOTE, or a
-- DEBIT_NOTE against one. No new column: document_type and original_invoice_id already exist.
-- Expand-only: relax two CHECK constraints to admit the new document_type value.

ALTER TABLE "sales_invoices" DROP CONSTRAINT "sales_invoices_type_check";
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_type_check" CHECK ("document_type" IN ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'));

-- A credit note or a debit note names the invoice it is raised against; an invoice never does.
ALTER TABLE "sales_invoices" DROP CONSTRAINT "sales_invoices_credit_link_check";
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_credit_link_check"
  CHECK (("document_type" IN ('CREDIT_NOTE', 'DEBIT_NOTE')) = ("original_invoice_id" IS NOT NULL));
