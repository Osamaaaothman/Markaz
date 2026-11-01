-- Purchase returns: goods sent back to a supplier before the supplier invoice has been matched to them.
-- Expand-only. Rollback = drop the two tables and restore the previous stock_movements_type_check.

-- CreateTable
CREATE TABLE "goods_returns" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "document_date" DATE NOT NULL,
    "reference" TEXT,
    "reason" TEXT,
    "journal_entry_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_return_lines" (
    "id" TEXT NOT NULL,
    "goods_return_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "purchase_order_line_id" TEXT NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "unit_cost" DECIMAL(19,4) NOT NULL,
    "value" DECIMAL(19,4) NOT NULL,
    "order_value" DECIMAL(19,4) NOT NULL,
    "line_number" INTEGER NOT NULL,

    CONSTRAINT "goods_return_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "goods_return_lines_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "goods_return_lines_unit_cost_check" CHECK ("unit_cost" >= 0),
    CONSTRAINT "goods_return_lines_value_check" CHECK ("value" >= 0),
    CONSTRAINT "goods_return_lines_order_value_check" CHECK ("order_value" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "goods_returns_company_id_number_key" ON "goods_returns"("company_id", "number");
CREATE INDEX "goods_returns_company_id_purchase_order_id_idx" ON "goods_returns"("company_id", "purchase_order_id");
CREATE INDEX "goods_returns_company_id_document_date_idx" ON "goods_returns"("company_id", "document_date");
CREATE INDEX "goods_return_lines_goods_return_id_idx" ON "goods_return_lines"("goods_return_id");

-- AddForeignKey
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_return_lines" ADD CONSTRAINT "goods_return_lines_goods_return_id_fkey" FOREIGN KEY ("goods_return_id") REFERENCES "goods_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_return_lines" ADD CONSTRAINT "goods_return_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_return_lines" ADD CONSTRAINT "goods_return_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A return is a stock movement of its own kind (out of stock, back to the supplier).
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_type_check";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_type_check"
  CHECK ("movement_type" IN ('RECEIPT', 'ISSUE', 'COUNT_ADJUSTMENT', 'RETURN'));

-- Posted documents are immutable: the runtime role may add rows, never change or remove them.
GRANT SELECT, INSERT ON "goods_returns" TO erp_app;
REVOKE UPDATE, DELETE ON "goods_returns" FROM erp_app;
REVOKE UPDATE, DELETE ON "goods_returns" FROM PUBLIC;

GRANT SELECT, INSERT ON "goods_return_lines" TO erp_app;
REVOKE UPDATE, DELETE ON "goods_return_lines" FROM erp_app;
REVOKE UPDATE, DELETE ON "goods_return_lines" FROM PUBLIC;
