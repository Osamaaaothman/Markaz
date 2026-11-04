# @erp/compliance-zatca-sa

Saudi Arabia's ZATCA e-invoicing compliance pack — implements `@erp/compliance-contract`
(`docs/06-COMPLIANCE-PACK-RULES.md`). The word "ZATCA" lives only in this package; no module
outside it, and nothing in `packages/core`, may mention it (docs/06 §1).

Status: **M7 Phases 1, 3, and 4 done** (data model; invoice XML generation; hashing, signing,
QR). No onboarding (Phase 2) and no submission (Phase 5) yet — see `docs/14-MILESTONES.md` M7 and
`docs/01-OPEN-DECISIONS.md` sections S, T, and U for what was decided and why.

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

## Known gaps (Phases 1, 3, and 4 only)

- No onboarding flow (CSR → compliance CSID → compliance checks → production CSID) — Phase 2.
  Nothing generates a real EGS key/CSR yet; Phase 4's tests sign with the SDK's own sample key.
- No submission (clearance/reporting) — Phase 5.
- No API endpoints or UI anywhere yet — nothing creates an `EgsUnit` through a real use case;
  the integration test creates one directly via Prisma. Nothing calls `buildBareInvoiceXml` or
  `signInvoiceXml` from a real SalesInvoice either — Phase 5's job to map one onto
  `ZatcaInvoiceInput` and wire in the encrypted key material from `EgsCredential`.
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
