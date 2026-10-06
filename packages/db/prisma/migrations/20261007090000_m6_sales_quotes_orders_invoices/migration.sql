-- M6 sales, slice 1: quotations, sales orders, sales invoices (and credit notes), and their account-mapping keys.
-- Expand-only. Rollback = drop the six new tables.

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "quotation_date" DATE NOT NULL,
    "valid_until" DATE,
    "currency" TEXT NOT NULL,
    "total_net" DECIMAL(19,4) NOT NULL,
    "total_tax" DECIMAL(19,4) NOT NULL,
    "total_gross" DECIMAL(19,4) NOT NULL,
    "notes" TEXT,
    "sales_order_id" TEXT,
    "created_by" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_lines" (
    "id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "item_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "unit_price" DECIMAL(19,4) NOT NULL,
    "tax_code_id" TEXT NOT NULL,
    "tax_rate" DECIMAL(7,4) NOT NULL,
    "net_amount" DECIMAL(19,4) NOT NULL,
    "tax_amount" DECIMAL(19,4) NOT NULL,
    "line_number" INTEGER NOT NULL,

    CONSTRAINT "quotation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "order_date" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "total_net" DECIMAL(19,4) NOT NULL,
    "total_tax" DECIMAL(19,4) NOT NULL,
    "total_gross" DECIMAL(19,4) NOT NULL,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" TEXT NOT NULL,
    "sales_order_id" TEXT NOT NULL,
    "item_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "unit_price" DECIMAL(19,4) NOT NULL,
    "tax_code_id" TEXT NOT NULL,
    "invoiced_quantity" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "line_number" INTEGER NOT NULL,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoices" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "sales_order_id" TEXT,
    "original_invoice_id" TEXT,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "currency" TEXT NOT NULL,
    "total_net" DECIMAL(19,4) NOT NULL,
    "total_tax" DECIMAL(19,4) NOT NULL,
    "total_gross" DECIMAL(19,4) NOT NULL,
    "total_cost" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "journal_entry_id" TEXT NOT NULL,
    "notes" TEXT,
    "actor_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_lines" (
    "id" TEXT NOT NULL,
    "sales_invoice_id" TEXT NOT NULL,
    "sales_order_line_id" TEXT,
    "item_id" TEXT,
    "warehouse_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "unit_price" DECIMAL(19,4) NOT NULL,
    "net_amount" DECIMAL(19,4) NOT NULL,
    "tax_code_id" TEXT NOT NULL,
    "tax_rate" DECIMAL(7,4) NOT NULL,
    "tax_amount" DECIMAL(19,4) NOT NULL,
    "cost_value" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "revenue_account_id" TEXT,
    "line_number" INTEGER NOT NULL,

    CONSTRAINT "sales_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotations_company_id_status_idx" ON "quotations"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_company_id_number_key" ON "quotations"("company_id", "number");

-- CreateIndex
CREATE INDEX "quotation_lines_quotation_id_idx" ON "quotation_lines"("quotation_id");

-- CreateIndex
CREATE INDEX "sales_orders_company_id_status_idx" ON "sales_orders"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_company_id_number_key" ON "sales_orders"("company_id", "number");

-- CreateIndex
CREATE INDEX "sales_order_lines_sales_order_id_idx" ON "sales_order_lines"("sales_order_id");

-- CreateIndex
CREATE INDEX "sales_invoices_company_id_customer_id_idx" ON "sales_invoices"("company_id", "customer_id");

-- CreateIndex
CREATE INDEX "sales_invoices_company_id_document_type_idx" ON "sales_invoices"("company_id", "document_type");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_company_id_number_key" ON "sales_invoices"("company_id", "number");

-- CreateIndex
CREATE INDEX "sales_invoice_lines_sales_invoice_id_idx" ON "sales_invoice_lines"("sales_invoice_id");

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_original_invoice_id_fkey" FOREIGN KEY ("original_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_sales_order_line_id_fkey" FOREIGN KEY ("sales_order_line_id") REFERENCES "sales_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Posting keys for sales.
ALTER TABLE "account_mappings" DROP CONSTRAINT "account_mappings_key_check";
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_key_check" CHECK ("key" IN (
  'INVENTORY', 'GRNI', 'PROJECT_ISSUE_EXPENSE', 'COUNT_LOSS', 'COUNT_GAIN',
  'ACCOUNTS_PAYABLE', 'VAT_INPUT', 'PURCHASE_PRICE_VARIANCE',
  'ACCOUNTS_RECEIVABLE', 'SALES_REVENUE', 'VAT_OUTPUT', 'COST_OF_GOODS_SOLD'
));

-- Domain checks: state machines, money shape, and the credit-note link.
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_status_check" CHECK ("status" IN ('OPEN', 'CONVERTED', 'REJECTED', 'CANCELLED'));
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_totals_check"
  CHECK ("total_net" >= 0 AND "total_tax" >= 0 AND "total_gross" = "total_net" + "total_tax");
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_amounts_check"
  CHECK ("quantity" > 0 AND "unit_price" >= 0 AND "net_amount" >= 0 AND "tax_amount" >= 0);

ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_status_check"
  CHECK ("status" IN ('OPEN', 'PARTIALLY_INVOICED', 'INVOICED', 'CANCELLED'));
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_totals_check"
  CHECK ("total_net" >= 0 AND "total_tax" >= 0 AND "total_gross" = "total_net" + "total_tax");
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_amounts_check" CHECK ("quantity" > 0 AND "unit_price" >= 0);
-- Never invoice more than was ordered.
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_invoiced_check"
  CHECK ("invoiced_quantity" >= 0 AND "invoiced_quantity" <= "quantity");

ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_type_check" CHECK ("document_type" IN ('INVOICE', 'CREDIT_NOTE'));
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_totals_check"
  CHECK ("total_net" >= 0 AND "total_tax" >= 0 AND "total_gross" = "total_net" + "total_tax" AND "total_cost" >= 0);
-- A credit note names the invoice it reduces; an invoice never does.
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_credit_link_check"
  CHECK (("document_type" = 'CREDIT_NOTE') = ("original_invoice_id" IS NOT NULL));
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_amounts_check"
  CHECK ("quantity" > 0 AND "unit_price" >= 0 AND "net_amount" >= 0 AND "tax_amount" >= 0 AND "cost_value" >= 0);
-- A stock line names both the item and the warehouse it left; a service line names neither.
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_stock_check"
  CHECK (("item_id" IS NULL) = ("warehouse_id" IS NULL));

-- Grants. Quotations and orders change status/counters (UPDATE); an invoice, credit note and their
-- lines are accounting records: insert-only like journal entries. No DELETE anywhere.
GRANT SELECT, INSERT, UPDATE ON "quotations" TO erp_app;
GRANT SELECT, INSERT ON "quotation_lines" TO erp_app;
REVOKE UPDATE, DELETE ON "quotation_lines" FROM erp_app;
GRANT SELECT, INSERT, UPDATE ON "sales_orders" TO erp_app;
GRANT SELECT, INSERT, UPDATE ON "sales_order_lines" TO erp_app;
GRANT SELECT, INSERT ON "sales_invoices" TO erp_app;
REVOKE UPDATE, DELETE ON "sales_invoices" FROM erp_app;
REVOKE UPDATE, DELETE ON "sales_invoices" FROM PUBLIC;
GRANT SELECT, INSERT ON "sales_invoice_lines" TO erp_app;
REVOKE UPDATE, DELETE ON "sales_invoice_lines" FROM erp_app;
REVOKE UPDATE, DELETE ON "sales_invoice_lines" FROM PUBLIC;
