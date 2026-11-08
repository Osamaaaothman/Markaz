-- Defense in depth for the ICV/PIH chain (docs/01-OPEN-DECISIONS.md section Z): a real integration
-- test proved that two genuinely concurrent InvoiceSubmissionService.submit() calls for the same
-- EGS unit -- a violation of the documented "at most one submit() per EGS at a time" contract the
-- caller is supposed to enforce (a per-EGS BullMQ worker at concurrency 1, not yet wired) -- can
-- both reserve the same ICV, since the chain-state row lock in EgsChainService.peekNext is only
-- held for the instant of reservation, not across the ZATCA network call. Without this constraint,
-- the second reservation succeeds silently; the failure only surfaces later, after a real network
-- call, when EgsChainService.advance's WHERE clause finds the chain already moved. This constraint
-- makes that failure happen immediately at INSERT time instead -- before any XML is built, signed,
-- or sent to ZATCA -- without changing any documented behavior for the normal, serialized case.
-- Expand-only.

CREATE UNIQUE INDEX "zatca_invoice_records_egs_unit_id_icv_key" ON "zatca_invoice_records"("egs_unit_id", "icv");
