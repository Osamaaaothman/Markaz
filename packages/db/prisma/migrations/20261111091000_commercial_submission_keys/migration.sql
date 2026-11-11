ALTER TABLE quotations ADD COLUMN submission_key TEXT;
ALTER TABLE sales_orders ADD COLUMN submission_key TEXT;
ALTER TABLE purchase_orders ADD COLUMN submission_key TEXT;
CREATE UNIQUE INDEX quotations_company_id_submission_key_key ON quotations(company_id, submission_key);
CREATE UNIQUE INDEX sales_orders_company_id_submission_key_key ON sales_orders(company_id, submission_key);
CREATE UNIQUE INDEX purchase_orders_company_id_submission_key_key ON purchase_orders(company_id, submission_key);
