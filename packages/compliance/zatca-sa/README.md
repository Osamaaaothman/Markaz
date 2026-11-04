# @erp/compliance-zatca-sa

Saudi Arabia's ZATCA e-invoicing compliance pack — implements `@erp/compliance-contract`
(`docs/06-COMPLIANCE-PACK-RULES.md`). The word "ZATCA" lives only in this package; no module
outside it, and nothing in `packages/core`, may mention it (docs/06 §1).

Status: **M7 Phases 1, 3, 4, and 5 done** (data model; invoice XML generation; hashing, signing,
QR; submission). No onboarding (Phase 2) yet — see `docs/14-MILESTONES.md` M7 and
`docs/01-OPEN-DECISIONS.md` sections S, T, U, and V for what was decided and why.

## Owns

Tables (defined in the shared Prisma schema — this is a single-schema monolith, same as every
other module — but only this package's code may read or write them):

- `egs_units` — one e-invoice generation solution unit (one device/branch).
- `egs_credentials` — an EGS's key material and CSID lifecycle. Highest-sensitivity table in the
  system (docs/09-SECURITY-RULES.md §5): the `*_ciphertext` columns are encrypted blobs, never
  plaintext, never logged, never selected into an API response.
- `egs_chain_states` — the ICV/PIH chain for one EGS, advanced atomically.
- `zatca_invoice_records` — one sales invoice's ZATCA submission record and artifacts.

Also owns new nullable columns on `companies` (seller/taxpayer profile: VAT number, CR number,
national address) and `parties` (buyer VAT number and national address, for a B2B customer).

## Exports (`src/index.ts`)

- `key-encryption.ts` — `encryptSecret`/`decryptSecret`/`encryptText`/`decryptText`,
  AES-256-GCM envelope encryption, and `loadEncryptionKey` (reads `ZATCA_KEY_ENCRYPTION_KEY`
  from the environment — never from the database).
- `egs-chain.service.ts` — `EgsChainService`: `createFor` (initialise a new EGS's chain state),
  `peekNext` (row-locks and returns the ICV/PIH the next invoice must use), `advance` (writes
  the chain forward once that invoice has been built and hashed). Call `peekNext` and `advance`
  inside the same transaction that builds the invoice — the lock must be held across both.
- `xml/invoice-xml-builder.ts` — `buildBareInvoiceXml(input: ZatcaInvoiceInput): string`. Builds
  the UBL 2.1 invoice XML for all six document types Tier 1 needs (standard/simplified ×
  invoice/credit note/debit note) — everything EXCEPT `ext:UBLExtensions`, `cac:Signature`, and
  the QR `cac:AdditionalDocumentReference`, which Phase 4 adds after hashing and signing this
  builder's output. Throws `ZatcaXmlError` for a missing billing reference/instruction note on a
  credit/debit note, a missing buyer on a standard invoice, a missing exemption reason on a
  zero-rated/exempt line, or no lines at all. Cross-checked against 5 of the SDK's 6 official
  sample documents (`invoice-xml-builder.spec.ts`) — not just this package's own expectations.
- `xml/canonicalize.ts` — `canonicalizeXml`/`canonicalizeElementByLocalName`, wrapping
  `xml-crypto`'s inclusive C14N. The one piece of this phase that was never going to be
  hand-rolled safely — see "Dependencies" below.
- `xml/invoice-hash.ts` — `hashInvoiceXml`/`hashCanonicalBytes`/`zatcaHashOf`: one SHA-256 digest,
  rendered in the three different encodings the spec actually uses at different call sites (see
  the file's own header comment). Reproduces the official sample's real signed digest exactly
  (`invoice-hash.spec.ts`).
- `xml/qr.ts` — `buildQrTlv`/`buildQrBase64`. Reproduces two real signed samples' own embedded QR
  codes byte-for-byte (`qr.spec.ts`), which is how two tags turned out to be UTF-8 text of a
  base64 string rather than the raw bytes the Security Standard's prose seems to describe.
- `xml/signing.ts` — `signData`/`verifyData` (ECDSA-SHA256 via `node:crypto`, no new dependency
  needed), `extractPublicKeyDer`, `extractCertificateSignatureDer` (a minimal, targeted DER
  reader for our own certificate's fixed 3-field top-level shape — not a general ASN.1 library).
  All verified against the official sample key/certificate (`signing.spec.ts`).
- `xml/xades-signature.ts` — `signInvoiceXml(bareXml, context): SignedInvoice`. Assembles
  `ext:UBLExtensions` + `cac:Signature` + the QR reference and splices them into
  `buildBareInvoiceXml`'s output. The resulting document's own signature verifies against its own
  certificate, and its top-level element order matches a real signed sample exactly
  (`xades-signature.spec.ts`).
- `submission/zatca-environment.ts` — base URLs and CSR certificate template names per
  environment. `// REVIEW:` not yet confirmed against the Integration Sandbox's own swagger
  (still not reachable by this tool) — see `docs/01-OPEN-DECISIONS.md` section V.
- `submission/zatca-api-client.ts` — `ZatcaApiClient` (`clearInvoice`/`reportInvoice`), built on
  `node:fetch`. A pluggable `HttpTransport` keeps every test off the real network
  (docs/06-COMPLIANCE-PACK-RULES.md §6). `ZatcaApiError.isTransient` is the retry/no-retry line:
  network/5xx/429 vs. everything else.
- `submission/submission-outcome.ts` — maps a ZATCA response (or a transport failure) onto
  `@erp/compliance-contract`'s `ComplianceOutcome`. An auth failure (401/403) becomes
  `PACK_UNAVAILABLE`, not `REJECTED` — it is our own credential/config problem, never a judgement
  ZATCA made about the invoice, so it must not consume the chain's ICV.
- `submission/invoice-submission.service.ts` — `InvoiceSubmissionService.submit(params)`.
  Reserves the EGS's next ICV/PIH, builds and signs the invoice, calls ZATCA, and persists the
  outcome — advancing the chain on any DEFINITIVE outcome (success or a genuine business
  rejection: docs/06 §7, a correction is a new document) and leaving it untouched on a transient
  failure or `PACK_UNAVAILABLE`, so a retry reuses the exact same chain position and
  `ZatcaInvoiceRecord`. Does not hold the chain's row lock across the network call — see
  "Dependencies" below for what makes that safe. Deliberately does not know how to turn a
  `SalesInvoice` into a `ZatcaInvoiceInput`; the caller supplies that mapping
  (`SubmitInvoiceParams.buildInvoiceInput`), which keeps this package independent of
  `packages/core`.

## Dependencies

`@erp/compliance-contract`, `@erp/db`, `@erp/shared` — no dependency on `packages/core` or any
`packages/modules/*` (docs/02-ARCHITECTURE-RULES.md §1; this package is a leaf). Nothing may
import this package except via the compliance contract (enforced by
`.dependency-cruiser.cjs`'s `no-module-depends-on-zatca-directly` rule).

**`xml-crypto` (+ its own `@xmldom/xmldom` dependency, added explicitly too)** — added for Phase
4, with Osama's explicit approval (docs/09-SECURITY-RULES.md §8: a new dependency is a decision,
not a default). Used only for its C14N canonicalizer; ECDSA signing uses `node:crypto` directly.
`xadesjs`/`xmldsigjs` were considered and rejected — the only dedicated XAdES library available,
but archived by its own maintainer in Aug 2025.

## Known gaps (Phases 1, 3, 4, and 5 only)

- No onboarding flow (CSR → compliance CSID → compliance checks → production CSID) — Phase 2.
  Nothing generates a real EGS key/CSR yet; every test signs with the SDK's own sample key.
- No API endpoints or UI anywhere yet — nothing creates an `EgsUnit` through a real use case;
  every test creates one directly via Prisma.
- **The real integration point is still missing**: nothing maps an actual `SalesInvoice` onto
  `ZatcaInvoiceInput`, decrypts a real `EgsCredential`, or decides which `EgsUnit` an invoice
  belongs to. `InvoiceSubmissionService` and the BullMQ wrapper
  (`apps/api/src/compliance/zatca-submission.job.ts`) are both built and tested against a
  scripted transport, but nothing calls either from a real sales flow yet. Blocked on Phase 2 (a
  real `EgsCredential` to decrypt) and a product decision this repo has not made — see
  `zatca-submission.job.ts`'s own `ZatcaSubmissionParamsLoader` doc comment.
- The submission HTTP client's exact endpoints/headers/JSON shape (`zatca-api-client.ts`) are
  `// REVIEW:` — built from this task's brief plus consistent third-party write-ups, not ZATCA's
  own swagger (still not reachable by this tool). Confirm before a real sandbox call.
- `apps/api`'s per-EGS, concurrency-1 worker wiring (`createMonitoredWorker`'s new
  `workerOptions` parameter) is ready but not registered in `worker.ts` — there is no list of
  real `EgsUnit`s to enumerate yet (Phase 2).
- `xades:CertDigest` could not be cross-checked: the official sample's own value does not match
  SHA-256 of its own embedded certificate (a sample-data inconsistency). This package computes it
  the spec-correct way; confirm against a real sandbox response once reachable.
- Inclusive C14N **1.0** stands in for the spec's declared C14N **1.1** — argued and empirically
  verified to be byte-identical for every document this package produces (neither uses
  `xml:base`/`xml:lang`/`xml:space`, the only things the two versions disagree on), but worth
  re-confirming if either of those attributes is ever introduced.
- The XML builder has no document-level discount/charge model (Tier 1's `SalesInvoice` has none
  either — docs/01-OPEN-DECISIONS.md section E6) — it always emits the zero-amount
  `AllowanceCharge` placeholder every official sample carries, never a real one.
- Only 2dp currency amounts are supported (hard-coded, not looked up per currency) — fine for
  SAR, would need revisiting for a 3dp currency (KWD/BHD) if ZATCA e-invoicing is ever needed
  outside SAR.
- Self-billing, export, summary, nominal-supply, and advance-payment invoice scenarios are not
  modelled (the `InvoiceTypeCode` "name" attribute's other 6 digits) — out of Tier 1 scope.
- `FIRST_INVOICE_PREVIOUS_HASH` is now verified against the official SDK's `Data/PIH/pih.txt`
  and pinned with a golden-value test — see `docs/01-OPEN-DECISIONS.md` section S for what the
  original (wrong) assumption was and the open question it raised about other hash encodings.
- The curve for key generation (secp256k1) is now confirmed from three independent sources,
  including the SDK's own sample key file — settled, see docs/01 section S.
- No per-EGS address override — every EGS at one company currently shares the company's
  national address (docs/01 section S explains the trade-off).
- **Resolved in Phase 4** (was open after Phase 1): the PIH's hex-then-base64 double-encoding is
  specific to the PIH (and to `xades:SignedProperties`/`CertDigest`) — the XAdES signature's own
  `ds:Reference/DigestValue` and the QR code's tag 6 both use plain `base64(raw digest)` instead,
  confirmed by decoding a real signed sample's QR byte-for-byte. See docs/01 section U.
