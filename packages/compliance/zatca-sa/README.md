# @erp/compliance-zatca-sa

Saudi Arabia's ZATCA e-invoicing compliance pack — implements `@erp/compliance-contract`
(`docs/06-COMPLIANCE-PACK-RULES.md`). The word "ZATCA" lives only in this package; no module
outside it, and nothing in `packages/core`, may mention it (docs/06 §1).

Status: **M7 Phases 1, 2, 3, 4, and 5 done** (data model; onboarding; invoice XML generation;
hashing, signing, QR; submission). See `docs/14-MILESTONES.md` M7 and
`docs/01-OPEN-DECISIONS.md` sections S, T, U, V, W, and X for what was decided and why — X in
particular covers a real-sandbox smoke test that found and fixed two genuine CSR structure bugs,
and an unresolved real-sandbox blocker that needs Osama's own portal account.

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
- `onboarding/csr.ts` — `generateKeyAndCsr(input)`: generates a fresh secp256k1 EC key and a
  PKCS#10 CSR for it by shelling out to the `openssl` CLI (array-arg `execFileSync`, never a
  shell string — no injection surface; Node has no built-in CSR generator). `generateCsr` also
  accepts an existing key, for renewal. The CSR's DN/SAN fields (serial, VAT number, invoice
  type digits, location, industry) are corroborated against the SDK's own
  `csr-config-*.properties` samples and the Security Standard PDF's RDN table
  (`csr.spec.ts`, 8 tests, verified with `openssl req -verify`/`-text`/`-pubkey`).
- `onboarding/onboarding-api-client.ts` — `ZatcaOnboardingApiClient`: `requestComplianceCsid`,
  `submitComplianceInvoice`, `requestProductionCsid`, `renewProductionCsid`. Shares
  `http/zatca-http-transport.ts`'s pluggable transport and error classification with the
  submission client. `// REVIEW:` the renewal call's exact auth (current production CSID Basic
  auth + a new OTP header, both at once) is this task's best corroborated guess, not confirmed
  against ZATCA's own swagger or a reference implementation specific to renewal — see
  docs/01-OPEN-DECISIONS.md section W.
- `onboarding/onboarding.service.ts` — `OnboardingService`: `startOnboarding` (generate
  key/CSR, request the compliance CSID, store everything encrypted), `runComplianceCheck` (sign
  and submit one sample document, throwing `OnboardingError("COMPLIANCE_CHECK_FAILED")` on any
  ZATCA-reported failure — never treats a rejection as a pass), `markComplianceChecksPassed`,
  `requestProductionCsid` (guarded on `COMPLIANCE_CHECKS_PASSED`; sets
  `certificateExpiresAt` from the issued certificate's real `notAfter`), `renewProductionCsid`
  (reuses the existing private key — only the certificate and secret are replaced). All six
  Prisma writes go through a `toBytesColumn()` cast documented at its own definition (a
  `@types/node`-vs-Prisma `Buffer`/`Uint8Array<ArrayBuffer>` generics mismatch, not a real type
  hole). Covered by `onboarding.service.spec.ts` against a real database and a scripted
  transport — never the real network (docs/06 §6).
- `submission/zatca-environment.ts` — base URLs and CSR certificate template names per
  environment. `// REVIEW:` not yet confirmed against the Integration Sandbox's own swagger
  (still not reachable by this tool) — see `docs/01-OPEN-DECISIONS.md` section V.
- `http/zatca-http-transport.ts` — `HttpTransport` (generic `request(method, url, headers, body,
  timeoutMs)`, `"POST"|"PATCH"`), `FetchHttpTransport` (built on `node:fetch`), `ZatcaApiError`
  (`isTransient`: network/5xx/429 vs. everything else), `classifyErrorStatus`. Extracted in
  Phase 2 so onboarding's CSID renewal (PATCH) could share it with submission (POST-only); a
  pluggable transport keeps every test off the real network (docs/06-COMPLIANCE-PACK-RULES.md
  §6).
- `submission/zatca-api-client.ts` — `ZatcaApiClient` (`clearInvoice`/`reportInvoice`), built on
  `../http/zatca-http-transport.ts` (re-exports its types for backward compatibility).
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

## Known gaps (Phases 1, 2, 3, 4, and 5 only)

- **A real onboarding call against ZATCA's actual sandbox still fails** with
  `{"errorCategory":"Invalid-CSR"}` — even after fixing two confirmed real CSR bugs this smoke
  test found (see `docs/01-OPEN-DECISIONS.md` section X), and even though the fixed CSR is now
  verified byte-for-byte structurally identical to the official SDK's own generator's output.
  The same error comes back for a deliberately garbage request body too, so the real cause is
  not CSR content — most likely something about the OTP's validity/binding or Osama's portal
  account state that this tool cannot resolve on its own. **Blocking a real go-live**, not
  blocking further local development.
- No API endpoints or UI anywhere yet (Phase 7) — nothing creates an `EgsUnit` or triggers
  onboarding through a real use case; every test creates one directly via Prisma and drives
  `OnboardingService` directly. The OTP (from the FATOORA portal, or the fixed sandbox value) is
  passed in by whatever calls `startOnboarding`/`renewProductionCsid` — nothing captures it from
  a user yet.
- **The real integration point is still missing**: nothing maps an actual `SalesInvoice` onto
  `ZatcaInvoiceInput`, or decides which `EgsUnit` an invoice belongs to.
  `InvoiceSubmissionService` and the BullMQ wrapper
  (`apps/api/src/compliance/zatca-submission.job.ts`) are both built and tested against a
  scripted transport, but nothing calls either from a real sales flow yet. Phase 2 now provides
  a real `EgsCredential` to decrypt; what's left is a product decision this repo has not made —
  see `zatca-submission.job.ts`'s own `ZatcaSubmissionParamsLoader` doc comment.
- Onboarding's HTTP client (`onboarding-api-client.ts`) is `// REVIEW:` on the same basis as the
  submission client below — corroborated from this task's brief and one third-party reference
  implementation, not ZATCA's own swagger. The CSID renewal call's exact auth combination
  (current production CSID + a new OTP, both at once) has no reference implementation at all —
  the least-confirmed call in this package. Confirm both before a real sandbox call.
- Nothing yet tracks *which* of the required compliance-check sample documents (the 6 document
  type/subtype combinations Tier 1 needs) have actually been run — `markComplianceChecksPassed`
  is caller-driven; a caller could call it having only run one. No enforcement here that all
  required samples passed before requesting the production CSID.
- CSR field sourcing: the CN is free text (confirmed from the Security Standard PDF's own RDN
  table, not a fixed format); the SAN's `SN` attribute carries the EGS serial using OpenSSL's
  built-in "surname" (2.5.4.4) shortname by established real-world convention, not literal X.520
  semantics (there is no "serialNumber" shortname built into OpenSSL's default config) — see
  docs/01-OPEN-DECISIONS.md section W.
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
