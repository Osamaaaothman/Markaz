# Compliance feedback and document tracking fixes — 2026-11-15

Invoice retry previously acknowledged queue insertion as a completed operation. A failed, unsigned invoice could reserve the next ICV and leave later invoices failing with a database uniqueness error. The read-only readiness endpoint now exposes a safe credential diagnosis and the preceding invoice holding the reservation; retries return HTTP 409 without queueing when blocked. A queued request returns HTTP 202 with `{ "status": "QUEUED" }` and informational feedback. Existing signed documents, counters, hashes and credentials are preserved. The worker raises an explicit `CHAIN_BLOCKED` error for an unsigned reservation instead of attempting a conflicting insert.

`GET /v1/compliance/invoices/:salesInvoiceId/submission-readiness` requires `compliance:read`, scopes the invoice and credentials to the actor's company, and returns only `canSubmit`, an issue code and optional blocking invoice ID/number. No cryptographic values are exposed. The retry endpoint rechecks readiness and audits the result before enqueueing. Sandbox remains selected; mismatched certificates are diagnosed, never bypassed or replaced. Successful legal issuance has not been claimed.

Toast width is capped at 24rem and the viewport in every appearance, with a bounded scrolling stack. Arabic and English distinguish queued work from accepted invoices.

Document tracking follows ancestry and descendants without turning at a shared order or payment into another document's workflow. A payment opened directly still shows the invoices explicitly allocated to it; an invoice shows its own payments without their other allocations. Company and permission filters remain in force. The audit activity tab remains restricted to the exact document ID and type.

## Verification

- Real PostgreSQL regressions: shared payment boundaries, permissions/company isolation, an unsigned ICV reservation, recovery after correcting the predecessor, mismatched/matching certificates, refusal to queue blocked work, and explicit queue acknowledgement.
- Browser regression: `node scripts/check-compliance-feedback.mjs` after the application build. Covers 32 toast cases and 16 blocked/queued flows across Arabic/English, original/balance/canvas/precision, light/dark and desktop/mobile.
- No schema migration or production business-data rewrite is required. Production verification uses existing invoices and read-only checks.

## Official references checked on 2026-11-15

The [ZATCA technical guideline](https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-invoicing-Detailed-Technical-Guideline.pdf), page 78, distinguishes generation sequence from submission order. The [ZATCA detailed guideline](https://www.zatca.gov.sa/en/e-invoicing/introduction/guidelines/documents/e-invoicing_detailed__guideline.pdf) requires preserving the invoice counter and previous-hash sequence. This fix does not reset, skip or delete the reserved record, waive signature validation, or fabricate acceptance.
