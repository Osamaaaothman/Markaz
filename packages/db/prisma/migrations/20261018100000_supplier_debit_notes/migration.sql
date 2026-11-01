-- M5 purchasing: debit notes, the AP mirror of M6's sales credit note (docs/01-OPEN-DECISIONS.md
-- section D "Known gaps, M5"). A supplier_invoices row is now an INVOICE or a DEBIT_NOTE against one.
-- Expand-only: new nullable columns, a relaxed NOT NULL, a self-FK, two new checks.

-- AlterTable
ALTER TABLE "supplier_invoices" ADD COLUMN "document_type" TEXT NOT NULL DEFAULT 'INVOICE';
ALTER TABLE "supplier_invoices" ADD COLUMN "original_invoice_id" TEXT;
-- A debit note has no supplier-issued number (we raise it, not the supplier); Postgres does not
-- enforce uniqueness across NULLs, so existing invoices and their constraint are unaffected.
ALTER TABLE "supplier_invoices" ALTER COLUMN "supplier_invoice_number" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "supplier_invoices_company_id_document_type_idx" ON "supplier_invoices"("company_id", "document_type");

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_original_invoice_id_fkey" FOREIGN KEY ("original_invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain checks, mirroring sales_invoices_type_check / sales_invoices_credit_note_link_check.
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_type_check" CHECK ("document_type" IN ('INVOICE', 'DEBIT_NOTE'));
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_debit_note_link_check"
  CHECK (("document_type" = 'DEBIT_NOTE') = ("original_invoice_id" IS NOT NULL));
