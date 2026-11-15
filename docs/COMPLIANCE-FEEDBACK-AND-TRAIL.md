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

The first pending invoice then generated locally verified signed XML and a QR, but the reporting endpoint returned HTTP 400 with `certificate-permissions`: the seller VAT differs from the static authentication certificate. The rejection and original response remain recorded; subsequent invoices were not submitted blindly. Readiness blocks further manual retries after a certificate-permissions rejection associated with the current credential revision in Simulation/Production; renewing credentials clears that preflight blocker without rewriting history. Sandbox instead shows a nonblocking warning so the owner can continue generating XML/QR and exercising test submissions, with the actual authority response preserved. Signature failures, expired credentials and chain conflicts remain blocking in every environment. Successful compliance samples do not prove that the reporting endpoint will accept company-specific invoices. Simulation onboarding with a taxpayer-generated OTP is the appropriate next step for that verification, subject to the owner's environment choice.

[ZATCA developer support](https://zatca1.discourse.group/t/issues-with-zatca-e-invoice-java-sdk/4420) explains the fixed Sandbox certificate/key and directs dynamic certificate integration to Simulation or Production. No successful legal issuance is claimed.

## Restoring Sandbox document generation

The owner explicitly requested the earlier Sandbox generation workflow after reviewing the limitation. A comparison with the pre-2026-11-14 mapper confirmed it previously used compliance credentials; live probes of both reporting and clearance with those credentials now return HTTP 401. Restoring that authentication path would not restore acceptance. Sandbox therefore retains the matched issuance credentials, enables test generation/submission with a visible identity warning, and records the real response. It never marks a rejected test as accepted or changes seller VAT data. Previously rejected records remain immutable outcomes; new pending records may generate their own signed XML and QR.

## Authority acceptance with warnings

The invoice read response now includes `authorityStatus` when a persisted accepted record has an explicit provider `CLEARED` or `REPORTED` result. The panel shows that result alongside `ACCEPTED_WITH_WARNINGS`, preserving the warning text and the original outcome. Rejected records never receive a positive authority status from a contradictory response. A later accepted submission on the same company and EGS supersedes a historical seller-identity preflight warning; a newer rejection remains actionable.

With explicit owner approval, the demo company's seller VAT was separately backed up and configured to the official Sandbox sample identity. A new standard test invoice received actual Sandbox `CLEARED` with BR-KSA-15 (missing actual delivery date). This exposed the missing explicit supply-date input; the follow-up below adds it without inventing or backfilling dates. Previously rejected invoices and their original seller data were not rewritten. Isolated live tests of all six official sample document types also succeeded (standard clearance and simplified reporting). These are Sandbox responses, not legal production acceptance.


## Preventing known issuance-data errors

`actualDeliveryDate` is an optional ISO calendar date on invoice creation, persisted as a nullable SQL DATE and included in the audit snapshot, draft restore, detail, PDF and XML. Existing posted documents remain null. The user must enter the actual supply date; neither invoice date nor due date is silently substituted. Standard invoices linked to an issuing unit require it; simplified documents and credit/debit notes retain their applicable rules.

The API composes a country-independent Core pre-issue callback with a pure validation function in the Saudi compliance pack. Inside the posting transaction, before accounting, stock, numbering and outbox writes, it checks active onboarding, seller/buyer VAT format, CRN format, relevant address fields and supply date. Known data failures return HTTP 422 and actionable bilingual messages, including on credit/debit forms. Ordinary invoices without a linked compliance unit remain supported. The checks were verified against official SDK 3.4.8 rules BR-KSA-15/39/40/44/63/66/67/37 and BR-KSA-F-08 on 2026-11-15; they do not guarantee provider acceptance of every possible input.

Migration `20261115150000_sales_invoice_supply_date` only adds a nullable column. Deploy the migration before the new API/worker. Rollback runs the preceding code and keeps the unused column; do not drop it or rewrite historic dates. Verification covers real-database rollback of rejected issue attempts, all six real sales-to-SDK documents, strict date DTO validation, draft dates in the Riyadh timezone, localized form errors, and existing document rendering.

Historical rejected submissions keep their UUID, ICV, XML and response. The [official technical guideline](https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-invoicing-Detailed-Technical-Guideline.pdf) requires new identifiers/counter values for corrected rejected documents and preserves the rejected document in the hash sequence. Paid or partially returned sales documents need explicit accounting reconciliation before replacement; generating duplicate sales to make an old badge green is not a correction. The current API does not offer an automatic replacement-and-payment-transfer operation.
