-- Which ZATCA issuing unit (EGS) a sales document belongs to. Nullable and expand-only: a company
-- with no EGS units yet (most of them today) keeps invoicing exactly as before; one with exactly
-- one active unit gets it assigned by the application automatically; one with more than one must
-- choose explicitly (docs/01-OPEN-DECISIONS.md).
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS egs_unit_id TEXT REFERENCES egs_units(id);
