-- M7 ZATCA compliance pack: Phase 1 (data model only — docs/06-COMPLIANCE-PACK-RULES.md,
-- docs/01-OPEN-DECISIONS.md section A4). No behaviour yet; that lives entirely in
-- packages/compliance/zatca-sa. Expand-only: new nullable columns and four new tables.

-- AlterTable: seller (taxpayer) profile on the company record.
ALTER TABLE "companies" ADD COLUMN     "additional_number" TEXT,
ADD COLUMN     "additional_street_name" TEXT,
ADD COLUMN     "building_number" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country_code" TEXT DEFAULT 'SA',
ADD COLUMN     "cr_number" TEXT,
ADD COLUMN     "cr_number_scheme" TEXT DEFAULT 'CRN',
ADD COLUMN     "district" TEXT,
ADD COLUMN     "postal_code" TEXT,
ADD COLUMN     "street_name" TEXT,
ADD COLUMN     "vat_number" TEXT;

-- AlterTable: buyer fields on a party, needed on a standard (B2B) invoice.
ALTER TABLE "parties" ADD COLUMN     "additional_number" TEXT,
ADD COLUMN     "additional_street_name" TEXT,
ADD COLUMN     "building_number" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country_code" TEXT DEFAULT 'SA',
ADD COLUMN     "district" TEXT,
ADD COLUMN     "postal_code" TEXT,
ADD COLUMN     "street_name" TEXT,
ADD COLUMN     "vat_number" TEXT;

-- CreateTable
CREATE TABLE "egs_units" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "branch_name" TEXT,
    "business_category" TEXT NOT NULL,
    "invoice_types" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "egs_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable: highest-sensitivity table in the system (docs/09-SECURITY-RULES.md §5). The
-- *_ciphertext columns are envelope-encrypted blobs (IV + ciphertext + auth tag) written and
-- read only by packages/compliance/zatca-sa — never plaintext, never selected into an API
-- response, never logged.
CREATE TABLE "egs_credentials" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "egs_unit_id" TEXT NOT NULL,
    "csr" TEXT,
    "private_key_ciphertext" BYTEA,
    "encryption_algorithm" TEXT NOT NULL DEFAULT 'aes-256-gcm',
    "compliance_request_id" TEXT,
    "compliance_csid_ciphertext" BYTEA,
    "compliance_secret_ciphertext" BYTEA,
    "production_csid_ciphertext" BYTEA,
    "production_secret_ciphertext" BYTEA,
    "certificate_expires_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "last_renewal_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "egs_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable: the ICV/PIH chain, advanced atomically (row lock) inside the same transaction
-- that assigns an invoice its chain values — docs/06-COMPLIANCE-PACK-RULES.md §3.
CREATE TABLE "egs_chain_states" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "egs_unit_id" TEXT NOT NULL,
    "last_icv" BIGINT NOT NULL DEFAULT 0,
    "last_invoice_hash" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "egs_chain_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable: one sales invoice's ZATCA submission record. No delete path — retained >= 10
-- years (docs/06 §3).
CREATE TABLE "zatca_invoice_records" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "sales_invoice_id" TEXT NOT NULL,
    "egs_unit_id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "icv" BIGINT NOT NULL,
    "previous_invoice_hash" TEXT NOT NULL,
    "invoice_hash" TEXT,
    "signed_xml" TEXT,
    "cleared_xml" TEXT,
    "qr_code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "last_response" JSONB,
    "validation_warnings" JSONB,
    "validation_errors" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMP(3),
    "cleared_at" TIMESTAMP(3),
    "reported_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zatca_invoice_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "egs_units_company_id_idx" ON "egs_units"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "egs_units_company_id_serial_key" ON "egs_units"("company_id", "serial");

-- CreateIndex
CREATE UNIQUE INDEX "egs_credentials_egs_unit_id_key" ON "egs_credentials"("egs_unit_id");

-- CreateIndex
CREATE INDEX "egs_credentials_company_id_idx" ON "egs_credentials"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "egs_chain_states_egs_unit_id_key" ON "egs_chain_states"("egs_unit_id");

-- CreateIndex
CREATE INDEX "egs_chain_states_company_id_idx" ON "egs_chain_states"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "zatca_invoice_records_sales_invoice_id_key" ON "zatca_invoice_records"("sales_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "zatca_invoice_records_uuid_key" ON "zatca_invoice_records"("uuid");

-- CreateIndex
CREATE INDEX "zatca_invoice_records_company_id_idx" ON "zatca_invoice_records"("company_id");

-- CreateIndex
CREATE INDEX "zatca_invoice_records_egs_unit_id_idx" ON "zatca_invoice_records"("egs_unit_id");

-- CreateIndex
CREATE INDEX "zatca_invoice_records_company_id_status_idx" ON "zatca_invoice_records"("company_id", "status");

-- AddForeignKey
ALTER TABLE "egs_units" ADD CONSTRAINT "egs_units_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "egs_credentials" ADD CONSTRAINT "egs_credentials_egs_unit_id_fkey" FOREIGN KEY ("egs_unit_id") REFERENCES "egs_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "egs_chain_states" ADD CONSTRAINT "egs_chain_states_egs_unit_id_fkey" FOREIGN KEY ("egs_unit_id") REFERENCES "egs_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zatca_invoice_records" ADD CONSTRAINT "zatca_invoice_records_egs_unit_id_fkey" FOREIGN KEY ("egs_unit_id") REFERENCES "egs_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zatca_invoice_records" ADD CONSTRAINT "zatca_invoice_records_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants (docs/04-DATA-MODEL-RULES.md §9 two-role pattern): erp_app gets nothing on a new
-- table until granted here. No DELETE on any of the four — egs_units/egs_credentials are
-- UPDATEd in place as onboarding progresses (not accounting records); egs_chain_states is
-- UPDATEd atomically as each invoice consumes the next ICV/PIH; zatca_invoice_records is
-- append-only, retained >= 10 years, same reasoning as journal_entries.
GRANT SELECT, INSERT, UPDATE ON "egs_units" TO erp_app;
GRANT SELECT, INSERT, UPDATE ON "egs_credentials" TO erp_app;
GRANT SELECT, INSERT, UPDATE ON "egs_chain_states" TO erp_app;
GRANT SELECT, INSERT, UPDATE ON "zatca_invoice_records" TO erp_app;
