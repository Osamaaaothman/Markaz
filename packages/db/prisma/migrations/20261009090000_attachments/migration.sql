-- Attachments: scanned bills, receipts and supporting documents linked to a business record.
-- Expand-only. Rollback = drop the table (the files themselves live in object storage / the data volume).

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_provider" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "public_url" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attachments_company_id_owner_type_owner_id_idx" ON "attachments"("company_id", "owner_type", "owner_id");
CREATE INDEX "attachments_company_id_created_at_idx" ON "attachments"("company_id", "created_at");
CREATE UNIQUE INDEX "attachments_storage_key_key" ON "attachments"("storage_provider", "storage_key");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attachments" ADD CONSTRAINT "attachments_owner_type_check"
  CHECK ("owner_type" IN ('SALES_INVOICE', 'SUPPLIER_INVOICE', 'PAYMENT', 'JOURNAL_ENTRY', 'PURCHASE_ORDER', 'PARTY', 'ITEM'));
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_visibility_check" CHECK ("visibility" IN ('PRIVATE', 'PUBLIC'));
-- The visibility rule, enforced where the application cannot forget it: only item pictures may ever be public.
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_public_only_items_check"
  CHECK ("visibility" = 'PRIVATE' OR "owner_type" = 'ITEM');
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_provider_check" CHECK ("storage_provider" IN ('LOCAL', 'CLOUDINARY'));
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 52428800);
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_sha256_check" CHECK (length("sha256") = 64);
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_content_type_check"
  CHECK ("content_type" IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp'));
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_deleted_pair_check"
  CHECK (("deleted_at" IS NULL) = ("deleted_by" IS NULL));

-- Supporting evidence is never rewritten or erased: the runtime role may add a row and mark it removed
-- (the two deleted_* columns), nothing else. The file itself stays in storage for retention.
GRANT SELECT, INSERT ON "attachments" TO erp_app;
GRANT UPDATE ("deleted_at", "deleted_by") ON "attachments" TO erp_app;
REVOKE DELETE ON "attachments" FROM erp_app;
REVOKE DELETE ON "attachments" FROM PUBLIC;
