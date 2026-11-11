ALTER TABLE purchase_requests ADD COLUMN submission_key TEXT;
CREATE UNIQUE INDEX purchase_requests_company_id_submission_key_key ON purchase_requests(company_id, submission_key);
ALTER TABLE stock_counts ADD COLUMN submission_key TEXT;
CREATE UNIQUE INDEX stock_counts_company_id_submission_key_key ON stock_counts(company_id, submission_key);
