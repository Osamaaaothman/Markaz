ALTER TABLE sales_invoice_lines ADD COLUMN original_line_id TEXT REFERENCES sales_invoice_lines(id) ON DELETE RESTRICT;
ALTER TABLE supplier_invoice_lines ADD COLUMN original_line_id TEXT REFERENCES supplier_invoice_lines(id) ON DELETE RESTRICT;
CREATE INDEX sales_invoice_lines_original_line_id_idx ON sales_invoice_lines(original_line_id);
CREATE INDEX supplier_invoice_lines_original_line_id_idx ON supplier_invoice_lines(original_line_id);
