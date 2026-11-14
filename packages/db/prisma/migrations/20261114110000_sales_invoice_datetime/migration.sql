-- Upgrade sales_invoices.invoice_date from DATE to TIMESTAMPTZ so the posting time is
-- preserved alongside the document date. Required for ZATCA issueTime without a separate
-- column. The USING clause keeps existing rows at midnight UTC (safe: they predate ZATCA
-- submission, so no live certificate chain references their timestamp yet).
ALTER TABLE "sales_invoices"
  ALTER COLUMN "invoice_date" TYPE TIMESTAMPTZ USING ("invoice_date"::timestamptz);
