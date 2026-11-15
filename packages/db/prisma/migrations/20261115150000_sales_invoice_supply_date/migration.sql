-- Preserve existing posted documents; never infer or backfill a supply date.
ALTER TABLE "sales_invoices" ADD COLUMN "actual_delivery_date" DATE;
