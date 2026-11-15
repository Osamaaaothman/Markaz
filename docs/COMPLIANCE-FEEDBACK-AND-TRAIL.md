# Compliance feedback and document tracking fixes — 2026-11-15

Invoice retry previously acknowledged queue insertion as a completed operation. A failed, unsigned invoice could reserve the next ICV and leave later invoices failing with a database uniqueness error. The read-only readiness endpoint now exposes a safe credential diagnosis and the preceding invoice holding the reservation; retries return HTTP 409 without queueing when blocked. A queued request returns HTTP 202 with `{ "status": "QUEUED" }` and informational feedback. Existing signed documents, counters, hashes and credentials are preserved. The worker raises an explicit `CHAIN_BLOCKED` error for an unsigned reservation instead of attempting a conflicting insert.

`GET /v1/compliance/invoices/:salesInvoiceId/submission-readiness` requires `compliance:read`, scopes the invoice and credentials to the actor's company, and returns only `canSubmit`, an issue code and optional blocking invoice ID/number. No cryptographic values are exposed. The retry endpoint rechecks readiness and audits the result before enqueueing. Sandbox remains selected; mismatched certificates are diagnosed without bypassing signature validation. Successful legal issuance has not been claimed.

Toast width is capped at 24rem and the viewport in every appearance, with a bounded scrolling stack. Arabic and English distinguish queued work from accepted invoices.

Document tracking follows ancestry and descendants without turning at a shared order or payment into another document's workflow. A payment opened directly still shows the invoices explicitly allocated to it; an invoice shows its own payments without their other allocations. Company and permission filters remain in force. The audit activity tab remains restricted to the exact document ID and type.

## Verification

- Real PostgreSQL regressions: shared payment boundaries, permissions/company isolation, an unsigned ICV reservation, recovery after correcting the predecessor, mismatched/matching certificates, refusal to queue blocked work, and explicit queue acknowledgement.
- Browser regression: `node scripts/check-compliance-feedback.mjs` after the application build. Covers 32 toast cases and 16 blocked/queued flows across Arabic/English, original/balance/canvas/precision, light/dark and desktop/mobile.
- No schema migration or financial-document rewrite is required. Production verification uses existing invoices. Provider validation messages are retained on HTTP errors and read from historical response envelopes, so the actual rejection reason is visible.

## Official references checked on 2026-11-15

The [ZATCA technical guideline](https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-invoicing-Detailed-Technical-Guideline.pdf), page 78, distinguishes generation sequence from submission order. The [ZATCA detailed guideline](https://www.zatca.gov.sa/en/e-invoicing/introduction/guidelines/documents/e-invoicing_detailed__guideline.pdf) requires preserving the invoice counter and previous-hash sequence. This fix does not reset, skip or delete the reserved record, waive signature validation, or fabricate acceptance.

## Sandbox recovery and its remaining limitation

At the owner's subsequent request to resume Sandbox, the active unit was inspected: its compliance certificate matched its generated key, but its issuance certificate exactly matched the public static certificate in official SDK 3.4.8. A bounded operational recovery backed up the encrypted credentials, used the matching public SDK test key, and re-ran all six compliance samples successfully. The new credentials were encrypted and committed atomically with a Core audit event; no counter or existing document was reset. This public test key is only appropriate for Sandbox, never Simulation or Production.

The first pending invoice then generated locally verified signed XML and a QR, but the reporting endpoint returned HTTP 400 with `certificate-permissions`: the seller VAT differs from the static authentication certificate. The rejection and original response remain recorded; subsequent invoices were not submitted blindly. Readiness blocks further manual retries after a certificate-permissions rejection associated with the current credential revision; renewing credentials clears that preflight blocker without rewriting history. Successful compliance samples do not prove that the reporting endpoint will accept company-specific invoices. Simulation onboarding with a taxpayer-generated OTP is the appropriate next step for that verification, subject to the owner's environment choice.

[ZATCA developer support](https://zatca1.discourse.group/t/issues-with-zatca-e-invoice-java-sdk/4420) explains the fixed Sandbox certificate/key and directs dynamic certificate integration to Simulation or Production. No successful legal issuance is claimed.
