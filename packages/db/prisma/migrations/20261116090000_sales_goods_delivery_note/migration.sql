-- Goods delivery note (sales): a storekeeper's handover record, printed before the sales invoice.
-- No prices, no amounts, no stock movement, no journal entry (docs/01-OPEN-DECISIONS.md E1 still
-- holds: stock leaves and COGS posts only at the invoice). Expand-only.
-- Rollback = drop the two new tables and the delivered_quantity column.

-- AlterTable
ALTER TABLE "sales_order_lines" ADD COLUMN "delivered_quantity" DECIMAL(19,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "goods_delivery_notes" (
    "id" TEXT NOT NULL,
    "submission_key" TEXT,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "sales_order_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "delivery_date" DATE NOT NULL,
    "driver_name" TEXT,
    "receiver_name" TEXT,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_delivery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_delivery_note_lines" (
    "id" TEXT NOT NULL,
    "goods_delivery_note_id" TEXT NOT NULL,
    "sales_order_line_id" TEXT NOT NULL,
    "item_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "line_number" INTEGER NOT NULL,

    CONSTRAINT "goods_delivery_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "goods_delivery_notes_company_id_number_key" ON "goods_delivery_notes"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "goods_delivery_notes_company_id_submission_key_key" ON "goods_delivery_notes"("company_id", "submission_key");

-- CreateIndex
CREATE INDEX "goods_delivery_notes_company_id_sales_order_id_idx" ON "goods_delivery_notes"("company_id", "sales_order_id");

-- CreateIndex
CREATE INDEX "goods_delivery_note_lines_goods_delivery_note_id_idx" ON "goods_delivery_note_lines"("goods_delivery_note_id");

-- AddForeignKey
ALTER TABLE "goods_delivery_notes" ADD CONSTRAINT "goods_delivery_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_delivery_notes" ADD CONSTRAINT "goods_delivery_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_delivery_notes" ADD CONSTRAINT "goods_delivery_notes_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_delivery_note_lines" ADD CONSTRAINT "goods_delivery_note_lines_goods_delivery_note_id_fkey" FOREIGN KEY ("goods_delivery_note_id") REFERENCES "goods_delivery_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_delivery_note_lines" ADD CONSTRAINT "goods_delivery_note_lines_sales_order_line_id_fkey" FOREIGN KEY ("sales_order_line_id") REFERENCES "sales_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_delivery_note_lines" ADD CONSTRAINT "goods_delivery_note_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain checks.
-- Never deliver more than was ordered.
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_delivered_check"
  CHECK ("delivered_quantity" >= 0 AND "delivered_quantity" <= "quantity");
ALTER TABLE "goods_delivery_note_lines" ADD CONSTRAINT "goods_delivery_note_lines_amounts_check"
  CHECK ("quantity" > 0);

-- Grants. Delivery notes are a handover record, not an editable document: insert-only, like an
-- invoice. sales_order_lines already has UPDATE (invoiced_quantity); delivered_quantity rides along.
GRANT SELECT, INSERT ON "goods_delivery_notes" TO erp_app;
REVOKE UPDATE, DELETE ON "goods_delivery_notes" FROM erp_app;
REVOKE UPDATE, DELETE ON "goods_delivery_notes" FROM PUBLIC;
GRANT SELECT, INSERT ON "goods_delivery_note_lines" TO erp_app;
REVOKE UPDATE, DELETE ON "goods_delivery_note_lines" FROM erp_app;
REVOKE UPDATE, DELETE ON "goods_delivery_note_lines" FROM PUBLIC;
