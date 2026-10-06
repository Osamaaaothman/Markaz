-- M5 purchasing, slice 2: tax codes and supplier invoices (three-way matched against order and receipt).
-- Expand-only. Rollback = drop the three new tables and the invoiced_quantity column.

-- AlterTable
ALTER TABLE "purchase_order_lines" ADD COLUMN     "invoiced_quantity" DECIMAL(19,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "tax_codes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "rate" DECIMAL(7,4) NOT NULL,
    "treatment" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tax_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "supplier_invoice_number" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "currency" TEXT NOT NULL,
    "total_net" DECIMAL(19,4) NOT NULL,
    "total_tax" DECIMAL(19,4) NOT NULL,
    "total_gross" DECIMAL(19,4) NOT NULL,
    "purchase_order_id" TEXT,
    "journal_entry_id" TEXT NOT NULL,
    "notes" TEXT,
    "actor_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoice_lines" (
    "id" TEXT NOT NULL,
    "supplier_invoice_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "purchase_order_line_id" TEXT,
    "account_id" TEXT,
    "description" TEXT,
    "quantity" DECIMAL(19,4) NOT NULL,
    "unit_price" DECIMAL(19,4) NOT NULL,
    "net_amount" DECIMAL(19,4) NOT NULL,
    "tax_code_id" TEXT NOT NULL,
    "tax_rate" DECIMAL(7,4) NOT NULL,
    "tax_amount" DECIMAL(19,4) NOT NULL,
    "price_variance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "line_number" INTEGER NOT NULL,

    CONSTRAINT "supplier_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_codes_company_id_code_key" ON "tax_codes"("company_id", "code");

-- CreateIndex
CREATE INDEX "supplier_invoices_company_id_supplier_id_idx" ON "supplier_invoices"("company_id", "supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_company_id_number_key" ON "supplier_invoices"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_company_id_supplier_id_supplier_invoice_n_key" ON "supplier_invoices"("company_id", "supplier_id", "supplier_invoice_number");

-- CreateIndex
CREATE INDEX "supplier_invoice_lines_supplier_invoice_id_idx" ON "supplier_invoice_lines"("supplier_invoice_id");

-- AddForeignKey
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_supplier_invoice_id_fkey" FOREIGN KEY ("supplier_invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The account-mapping key list grows with the purchasing posting keys.
ALTER TABLE "account_mappings" DROP CONSTRAINT "account_mappings_key_check";
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_key_check" CHECK ("key" IN (
  'INVENTORY', 'GRNI', 'PROJECT_ISSUE_EXPENSE', 'COUNT_LOSS', 'COUNT_GAIN',
  'ACCOUNTS_PAYABLE', 'VAT_INPUT', 'PURCHASE_PRICE_VARIANCE'
));

-- Domain checks.
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_treatment_check"
  CHECK ("treatment" IN ('STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE'));
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_rate_check" CHECK ("rate" >= 0 AND "rate" <= 100);
-- Only a STANDARD treatment carries a percentage; zero-rated, exempt and out-of-scope are always 0.
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_rate_by_treatment_check" CHECK ("treatment" = 'STANDARD' OR "rate" = 0);
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_invoiced_check"
  CHECK ("invoiced_quantity" >= 0 AND "invoiced_quantity" <= "received_quantity");
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_totals_check"
  CHECK ("total_net" >= 0 AND "total_tax" >= 0 AND "total_gross" = "total_net" + "total_tax");
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_kind_check"
  CHECK (
    ("kind" = 'PO_LINE' AND "purchase_order_line_id" IS NOT NULL AND "account_id" IS NULL)
    OR ("kind" = 'EXPENSE' AND "account_id" IS NOT NULL AND "purchase_order_line_id" IS NULL)
  );
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_amounts_check"
  CHECK ("quantity" > 0 AND "unit_price" >= 0 AND "net_amount" >= 0 AND "tax_amount" >= 0);

-- Grants. Tax codes are configuration (no DELETE; deactivate instead). A supplier invoice and its
-- lines are accounting records: insert-only, like journal entries. Order lines already allow UPDATE
-- (the invoiced quantity moves under a row lock with the invoice that causes it).
GRANT SELECT, INSERT, UPDATE ON "tax_codes" TO erp_app;
GRANT SELECT, INSERT ON "supplier_invoices" TO erp_app;
REVOKE UPDATE, DELETE ON "supplier_invoices" FROM erp_app;
REVOKE UPDATE, DELETE ON "supplier_invoices" FROM PUBLIC;
GRANT SELECT, INSERT ON "supplier_invoice_lines" TO erp_app;
REVOKE UPDATE, DELETE ON "supplier_invoice_lines" FROM erp_app;
REVOKE UPDATE, DELETE ON "supplier_invoice_lines" FROM PUBLIC;
