-- Payments: customer receipts and supplier payments, with allocations to invoices.
-- Expand-only. Rollback = drop the two new tables.

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "payment_date" DATE NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "cash_account_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "journal_entry_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "sales_invoice_id" TEXT,
    "supplier_invoice_id" TEXT,
    "amount" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_company_id_party_id_idx" ON "payments"("company_id", "party_id");

-- CreateIndex
CREATE INDEX "payments_company_id_direction_idx" ON "payments"("company_id", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "payments_company_id_number_key" ON "payments"("company_id", "number");

-- CreateIndex
CREATE INDEX "payment_allocations_payment_id_idx" ON "payment_allocations"("payment_id");

-- CreateIndex
CREATE INDEX "payment_allocations_sales_invoice_id_idx" ON "payment_allocations"("sales_invoice_id");

-- CreateIndex
CREATE INDEX "payment_allocations_supplier_invoice_id_idx" ON "payment_allocations"("supplier_invoice_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_supplier_invoice_id_fkey" FOREIGN KEY ("supplier_invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "payments" ADD CONSTRAINT "payments_direction_check" CHECK ("direction" IN ('RECEIPT', 'PAYMENT'));
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_check" CHECK ("method" IN ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER'));
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount" > 0);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount_check" CHECK ("amount" > 0);
-- Exactly one target: a sales invoice or a supplier invoice, never both and never neither.
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_one_target_check"
  CHECK (("sales_invoice_id" IS NULL) <> ("supplier_invoice_id" IS NULL));

-- Accounting records: insert-only for the runtime role, like journal entries. No DELETE anywhere.
GRANT SELECT, INSERT ON "payments" TO erp_app;
REVOKE UPDATE, DELETE ON "payments" FROM erp_app;
REVOKE UPDATE, DELETE ON "payments" FROM PUBLIC;
GRANT SELECT, INSERT ON "payment_allocations" TO erp_app;
REVOKE UPDATE, DELETE ON "payment_allocations" FROM erp_app;
REVOKE UPDATE, DELETE ON "payment_allocations" FROM PUBLIC;
