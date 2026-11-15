# @erp/compliance-zatca-sa

Saudi Arabia's ZATCA e-invoicing compliance pack — implements `@erp/compliance-contract`
(`docs/06-COMPLIANCE-PACK-RULES.md`). The word "ZATCA" lives only in this package; no module
outside it, and nothing in `packages/core`, may mention it (docs/06 §1).

Status: **M7 Phases 1-6 done** (data model; onboarding; invoice XML generation;
hashing, signing, QR; submission; local validation). See `docs/14-MILESTONES.md` M7 and
`docs/01-OPEN-DECISIONS.md` sections S, T, U, V, W, X, and Y for what was decided and why — X in
particular covers a real-sandbox smoke test that found and fixed two genuine CSR structure bugs:
`requestComplianceCsid` has now issued a real compliance CSID against ZATCA's actual sandbox.

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
  `buildSandboxDataQrBase64` separately supports an explicitly labeled data-reading exercise
  with tags 1–5 only. It returns null outside Sandbox or for missing/oversized values. This
  unsigned preview is never used in submission XML or as evidence of ZATCA acceptance.
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
  submission client. Renewal authentication and the 428 compliance flow are confirmed by
  ZATCA's published support guidance and covered by offline contract/integration tests;
  live Simulation renewal remains unverified. See `docs/zatca/DEVELOPMENT-VALIDATION.md`.
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
- `xml/cert-parser.ts` — accepts PEM, base64 DER, and the sandbox's extra base64
  transport layer, including existing encrypted credentials armored by onboarding.
  Signing embeds the decoded DER certificate; Basic auth retains the original
  `binarySecurityToken`. OpenSSL parses all X.509 fields without an extension-bypass
  fallback. The stored sandbox certificate parsed normally once decoded (2026-11-14).
  Local troubleshooting: Docker's published API port and the host dev API may differ;
  rebuilding Docker does not refresh an already-running host Node process or its
  workspace `dist` modules. Check both the listener and resolved module before retrying.
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
  ZATCA made about the invoice. Its generated bytes and ICV remain available for retry.
- `submission/invoice-submission.service.ts` — `InvoiceSubmissionService.submit(params)`.
  Reserves the EGS's next ICV/PIH, builds and signs the invoice, calls ZATCA, and persists the
  outcome. Persisting verified signed XML advances the generation chain atomically before
  the HTTP call. A transient/auth failure cannot block later generated invoices; retry reuses
  the same XML, UUID, ICV and `ZatcaInvoiceRecord` without rewinding the chain. Older signed
  records left unadvanced by a transport failure are recovered from their persisted hash and
  XML after consistency checks. Unsigned invalid records still require preparation to finish.
  Does not hold the chain's row lock across the network call — see
  "Dependencies" below for what makes that safe. Deliberately does not know how to turn a
  `SalesInvoice` into a `ZatcaInvoiceInput`; the caller supplies that mapping
  (`SubmitInvoiceParams.buildInvoiceInput`), which keeps this package independent of
  `packages/core`.

  Basis: [ZATCA detailed technical guideline, invoice sequence FAQ](https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-invoicing-Detailed-Technical-Guideline.pdf)
  distinguishes sequential generation from submission order.

- `validation/invoice-consistency.ts` -- `checkInvoiceConsistency`: offline arithmetic/structure checks on a
  bare or signed document (EN 16931 BR-CO rules, tax breakdown, header facts). Our own safety net, **not** ZATCA's
  XSD/Schematron.
- `validation/signed-invoice-verifier.ts` -- `verifySignedInvoice`: hash, signature, SignedProperties/CertDigest and
  QR-vs-XML checks on a signed document. `InvoiceSubmissionService` runs both before anything is sent and throws
  `InvoiceValidationError` (nothing sent, ICV not consumed) on a failure.
- `validation/sdk-validator.ts` -- `runSdkValidation`: runs official SDK 3.4.8 `-validate`
  with UTF-8 and isolated PIH context. Required by CI; development use only.
- `testing/fixtures.ts` -- test-only: `describeIfSdk` (SDK-dependent suites are skipped *by name* without the SDK) and
  `generateTestCertificate` (an `openssl`-made key/self-signed certificate so pipeline tests run anywhere).

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

## Development validation and remaining limits

The API/UI onboarding, sales mapper, per-EGS worker, invoice status/history, XML export
and printed QR integration are implemented. CI requires official SDK 3.4.8 validation
of all six document types generated through the real sales services and mapper.
See [the development validation runbook](../../../docs/zatca/DEVELOPMENT-VALIDATION.md)
for setup, verified signature conventions, renewal behavior and authoritative references.

- Developer Sandbox onboarding reached ACTIVE on 2026-11-14. Its static certificates
  do not prove a valid device-key pairing or real invoice acceptance. Keep test labels.
- Live Simulation onboarding, clearance/reporting and renewal still require an authorized
  account/OTP and a certificate bound to the EGS key. Production remains unverified.
- Renewal 428/NOT_COMPLIANT is supported: repeat all required checks and request issuance.
  Invalid or mismatched renewed certificates preserve the previous credentials and chain.
- Inclusive C14N 1.0 remains byte-compatible with our supported XML subset; re-evaluate
  if xml:base, xml:lang or xml:space are introduced.
- Only 2dp currencies and the current invoice line model are supported. Document-level
  discount/charge, self-billing, export, summary, nominal-supply and advance-payment
  scenarios are outside the current product scope.
- EGS units share their company's national address; there is no per-EGS address override.


`invoiceIssueProblems` checks the known seller/buyer identity, address and supply-date rules before posting through the API composition hook. It is a local readiness check, not proof of authority acceptance. Standard sales invoices now carry an explicit supply date through to XML; no date is inferred for historic records. See [the recovery and validation notes](../../../docs/COMPLIANCE-FEEDBACK-AND-TRAIL.md) for rollout and rejected-document limitations.
