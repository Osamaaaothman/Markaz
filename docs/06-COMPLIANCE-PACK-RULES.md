# 06 — Compliance Pack Rules (ZATCA / e-invoicing)

---

## 0. Verify before you build

Your training data contains e-invoicing details that **age quickly**. Wave thresholds,
API endpoints, XML profiles, and onboarding steps change.

**Before designing or implementing anything in this area, verify against current
official ZATCA documentation and say explicitly what you verified and when.** Do not
build from the summary in the planning document, and do not build from memory. If you
cannot verify, say so and mark the work blocked.

---

## 1. The isolation rule

Compliance is a **plug-in**, not a feature of the sales module.

```
packages/compliance/
├── contract/        Country-agnostic interface + shared types.  No country logic.
├── zatca-sa/        Saudi implementation
└── (future) uae/, oman/   — different model entirely (Peppol 5-corner)
```

Hard rules:
- `modules/sales` imports **`compliance/contract` only**. It never imports `zatca-sa`.
- The word "ZATCA" does not appear in `core/` or in any module outside `zatca-sa`.
- Which pack is active is **tenant configuration**, resolved at runtime.
- A tenant with no compliance pack (or a future non-mandated country) must still be
  able to issue invoices — the pack is optional infrastructure, not a hard dependency.

This is what lets the product be sold in Saudi Arabia now and extended to UAE/Oman
later without touching the sales module. The UAE/Oman Peppol model is **structurally
different** from Saudi's centralised model, so the contract must not assume a
clearance-style flow.

---

## 2. The contract shape (design it to fit both models)

```
interface ICompliancePack {
  onboardTenant(config): Promise<OnboardingResult>
  validateBeforeIssue(invoice): Promise<ValidationResult>   // fail fast, locally
  process(invoice): Promise<ComplianceOutcome>              // clearance OR reporting OR send
  getStatus(documentId): Promise<ComplianceStatus>
  renderArtifacts(documentId): Promise<{ xml, qr, pdfAttachments }>
}
```

- `ComplianceOutcome` is a **discriminated union** with explicit states, not a boolean:
  `CLEARED | REPORTED | ACCEPTED_WITH_WARNINGS | REJECTED | PENDING_RETRY | PACK_UNAVAILABLE`
- Warnings are preserved, not swallowed. ZATCA can accept a document with warnings and
  those matter to the customer.
- Every outcome stores the **full provider request and response** for audit.

---

## 3. Saudi (ZATCA) requirements to implement

Per the planning brief, subject to §0 verification:

- Invoice XML per **UBL 2.1** with the ZATCA profile
- **Cryptographic stamp** using the tenant's CSID
- **QR code** with TLV encoding
- **B2B / B2G → Clearance**: real-time, before the invoice is legally valid. An
  uncleared invoice has no tax value and the buyer cannot deduct input VAT.
- **B2C → Reporting** within 24 hours of issuance
- **Archival ≥ 10 years**: UUID, hash, XML, QR, and the full ZATCA response
- **Per-tenant onboarding** linking the tenant to their Fatoora account
- Invoice hash chaining (each document referencing the previous) — get the exact
  current requirement from official docs
- Arabic content is required on the tax invoice regardless of UI language

---

## 4. Flow design — clearance is synchronous, your API must not be

The user is waiting, ZATCA may be slow, and a tax obligation cannot be lost.

- The invoice document and its ledger entry commit **first**, in the database
  transaction, in state `PENDING_CLEARANCE`.
- The ZATCA call happens **outside** that transaction — never inside it.
- Use the **outbox pattern**: the intent to submit is written in the same transaction
  as the document; a worker picks it up. This is what guarantees a tax obligation is
  never lost to a crash between commit and API call.
- For B2B clearance the UI may poll or use a short synchronous wait with a strict
  timeout and a clear pending state — but the source of truth is the persisted status,
  never the HTTP response of the moment.
- **Retries:** bounded, exponential backoff with jitter, idempotent (never submit the
  same invoice twice). After exhausting retries → dead-letter + **alert the tenant and
  us**. A silently failed tax submission is the worst possible outcome.
- Explicit downstream timeouts on every ZATCA call. Never an unbounded wait.
- Every state transition is persisted and visible in the UI and to support.

Document the full state machine in an ADR:
`DRAFT → PENDING → SUBMITTING → CLEARED | REPORTED | REJECTED | FAILED_RETRYABLE → ...`

---

## 5. Cryptographic material — highest-sensitivity data in the system

> Each customer's isolated deployment holds and onboards **its own** ZATCA keys —
> there is no central custody across customers
> (`docs/adr/0002-drop-saas-single-purchase-per-customer-deployment.md`). This section
> still applies in full **inside every deployment**, and on a cloud-hosted deployment
> Osama operates for a customer, Osama's own admin access to that key material is
> exactly the kind of access `docs/09-SECURITY-RULES.md` §3 requires logging.

- Private keys and CSIDs are **encrypted at rest** (envelope encryption with a KMS
  where the hosting environment provides one; otherwise a strong local encryption
  scheme with the decryption key held outside the database). Never plaintext in the
  database, never in an environment variable, never in a file on the API container.
- **Never logged. Never returned by any API. Never included in an export, a backup
  dump the support team can read, or an error message.**
- CSR generation, compliance CSID, and production CSID have a lifecycle: issuance,
  renewal, revocation. Design renewal from day one — certificates expire and an expired
  CSID stops a customer from invoicing.
- Access to key material is a separately audited privilege. Log every access
  (who, when, why) — the access, not the key.
- Document the compromise procedure: how a tenant's key is revoked and reissued.

Write this up in `docs/SECURITY.md` before implementing. If Osama is not comfortable
holding customer keys, that is a strong argument for the approved-service-provider
route in `docs/01-OPEN-DECISIONS.md` A4 — raise it explicitly.

---

## 6. Testing

- **Never call the production ZATCA environment from tests.** Use the sandbox, and a
  mock adapter by default in CI.
- Golden-file tests for XML generation: fixed input → byte-exact expected XML. This is
  the only practical way to catch a silent formatting regression.
- QR TLV encoding tested against known-good vectors.
- Hash chain continuity tested across a sequence of invoices, including a rejection in
  the middle.
- Failure tests: ZATCA times out · returns 5xx · returns a rejection · returns
  malformed XML · returns accepted-with-warnings. Each must produce a correct,
  persisted, recoverable state.
- Retry test proving the same invoice is never submitted twice.
- A test asserting no key material appears in logs.

---

## 7. Non-negotiables

- **Never fabricate a clearance status.** If we do not have a ZATCA confirmation, the
  invoice is not cleared, and the UI says so plainly.
- Never mark an invoice legally valid based on local validation alone.
- Never lose a document that must be reported. The outbox is the guarantee.
- Never hard-delete an e-invoice record — the retention period is a legal obligation.
- Mock/sandbox mode must be **visibly labelled** in the data and the UI. A tenant must
  never be unable to tell whether their invoices are real.
