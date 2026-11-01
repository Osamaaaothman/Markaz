-- Purchase requests and orders name the warehouse the goods are for.
-- Expand-only and nullable so existing rows stay valid; the API requires it for every new request and order.
ALTER TABLE "purchase_requests" ADD COLUMN "warehouse_id" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "warehouse_id" TEXT;

ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "purchase_requests_warehouse_id_idx" ON "purchase_requests"("warehouse_id");
CREATE INDEX "purchase_orders_warehouse_id_idx" ON "purchase_orders"("warehouse_id");
