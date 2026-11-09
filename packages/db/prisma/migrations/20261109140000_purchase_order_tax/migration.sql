ALTER TABLE "purchase_order_lines" ADD COLUMN IF NOT EXISTS tax_code_id TEXT REFERENCES tax_codes(id);
ALTER TABLE "purchase_order_lines" ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(7, 4);
ALTER TABLE "purchase_order_lines" ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(19, 4) NOT NULL DEFAULT 0;

ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS total_tax NUMERIC(19, 4) NOT NULL DEFAULT 0;
