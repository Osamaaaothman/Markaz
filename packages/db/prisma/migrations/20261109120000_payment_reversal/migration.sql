-- Soft-void markers and reversal link for payments.
-- A payment is voided by creating a new reversing payment and linking the two records.
-- The original keeps voided_at + reversed_by_payment_id; the reversal keeps reverses_payment_id.
-- Neither the journal entry nor the allocations are edited — reversal is always a new entry.

ALTER TABLE "payments" ADD COLUMN "voided_at"              TIMESTAMPTZ;
ALTER TABLE "payments" ADD COLUMN "reverses_payment_id"    TEXT REFERENCES "payments"("id");
ALTER TABLE "payments" ADD COLUMN "reversed_by_payment_id" TEXT REFERENCES "payments"("id");
