-- The Commercial Registration (CR) number for a supplier/customer — shown on printed
-- quotations, orders and invoices alongside the VAT number and address, not a ZATCA
-- XML field (that stays vatNumber + the existing address columns). Expand-only.

ALTER TABLE "parties" ADD COLUMN "commercial_registration" TEXT;
