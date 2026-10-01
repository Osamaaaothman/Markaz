-- docs/08-FRONTEND-I18N-RULES.md: the product ships Arabic and English, so an account
-- needs an Arabic display name next to its English one. Nullable on purpose — existing
-- and user-created accounts keep working with just `name`; the UI falls back to it.
-- No new GRANT needed: erp_app already holds table-level SELECT/INSERT/UPDATE on accounts,
-- which covers a newly added column.
ALTER TABLE accounts ADD COLUMN name_ar TEXT;
