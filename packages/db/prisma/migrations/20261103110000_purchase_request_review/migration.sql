-- A review step for purchase requests: PENDING -> ACCEPTED (or REJECTED) -> PROCESSED (an order was made from it).
-- Expand-only. Rollback: restore the three-value check (after moving any ACCEPTED row back to PENDING) and drop the two columns.

ALTER TABLE "purchase_requests" ADD COLUMN "accepted_by" TEXT;
ALTER TABLE "purchase_requests" ADD COLUMN "accepted_at" TIMESTAMP(3);

ALTER TABLE "purchase_requests" DROP CONSTRAINT "purchase_requests_status_check";
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_status_check"
  CHECK ("status" IN ('PENDING', 'ACCEPTED', 'PROCESSED', 'REJECTED'));
