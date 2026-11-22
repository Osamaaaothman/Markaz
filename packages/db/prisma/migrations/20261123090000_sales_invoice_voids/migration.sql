-- An invoice ZATCA rejected is voided by one reversing journal entry and a stock return; the
-- invoice row is never changed. One row per voided invoice, insert-only like every posted record.
CREATE TABLE "sales_invoice_voids" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "sales_invoice_id" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_invoice_voids_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_invoice_voids_reason_check" CHECK (length(btrim("reason")) > 0)
);

CREATE UNIQUE INDEX "sales_invoice_voids_sales_invoice_id_key" ON "sales_invoice_voids"("sales_invoice_id");
CREATE UNIQUE INDEX "sales_invoice_voids_journal_entry_id_key" ON "sales_invoice_voids"("journal_entry_id");
CREATE INDEX "sales_invoice_voids_company_id_idx" ON "sales_invoice_voids"("company_id");

ALTER TABLE "sales_invoice_voids" ADD CONSTRAINT "sales_invoice_voids_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoice_voids" ADD CONSTRAINT "sales_invoice_voids_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoice_voids" ADD CONSTRAINT "sales_invoice_voids_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT ON "sales_invoice_voids" TO erp_app;
REVOKE UPDATE, DELETE ON "sales_invoice_voids" FROM erp_app;
REVOKE UPDATE, DELETE ON "sales_invoice_voids" FROM PUBLIC;

INSERT INTO "permissions" ("id", "code", "description")
VALUES (gen_random_uuid()::text, 'sales_invoice:void_rejected', 'Void a sales invoice ZATCA rejected so it can be corrected and issued again')
ON CONFLICT ("code") DO NOTHING;

-- Match the standard roles in seed.ts; preserve custom roles and every existing grant.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."name" IN ('Admin', 'Sales')
  AND p."code" = 'sales_invoice:void_rejected'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
