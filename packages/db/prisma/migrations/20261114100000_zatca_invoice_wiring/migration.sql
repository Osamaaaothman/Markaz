-- Expand-only: adds ZATCA wiring fields to existing tables.
-- Rollback: DROP COLUMN on each added column.

-- Payment means code on sales_invoices (UNCL4461: 10=cash, 42=bank transfer, 48=card).
-- Default '42' (bank transfer) applied to existing rows; callers may override per invoice.
ALTER TABLE "sales_invoices" ADD COLUMN "payment_means_code" TEXT NOT NULL DEFAULT '42';

-- UN/ECE Recommendation 20 unit code on items (e.g. "PCE", "KGM", "MTR").
-- Nullable: mapper falls back to "PCE" when null.
ALTER TABLE "items" ADD COLUMN "unit_code" TEXT;

-- ZATCA exemption reason code and description on tax_codes.
-- Required by the XML builder when treatment is ZERO_RATED or EXEMPT.
ALTER TABLE "tax_codes" ADD COLUMN "exemption_reason_code" TEXT;
ALTER TABLE "tax_codes" ADD COLUMN "exemption_reason"      TEXT;
