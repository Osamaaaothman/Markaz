-- Deleting an account nothing uses. A used account is never deleted (docs/05 section 4); it is stopped instead.
-- Rollback: REVOKE DELETE ON "accounts" FROM erp_app; restore the parent key as ON DELETE SET NULL; drop the new key.

-- The runtime role may now delete from accounts. The service refuses any account that is used, and every foreign
-- key pointing at accounts is ON DELETE RESTRICT, so the database refuses too if the service ever misses one.
GRANT DELETE ON "accounts" TO erp_app;

-- A deleted folder must not leave its sub-accounts without a parent: refuse instead of setting the parent to null.
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_parent_id_fkey";
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A sales invoice line could name a revenue account with nothing in the database holding it there. NOT VALID:
-- enforced for every new row without re-checking old ones, so an old inconsistent row cannot block a deployment.
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_revenue_account_id_fkey" FOREIGN KEY ("revenue_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
