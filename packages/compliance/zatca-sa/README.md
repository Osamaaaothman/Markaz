# @erp/compliance-zatca-sa

Saudi Arabia's ZATCA e-invoicing compliance pack — implements `@erp/compliance-contract`
(`docs/06-COMPLIANCE-PACK-RULES.md`). The word "ZATCA" lives only in this package; no module
outside it, and nothing in `packages/core`, may mention it (docs/06 §1).

Status: **M7 Phase 1 (data model) and Phase 3 (invoice XML generation) done.** No onboarding
(Phase 2), no hashing/signing/QR (Phase 4), no submission (Phase 5) yet — see
`docs/14-MILESTONES.md` M7 and `docs/01-OPEN-DECISIONS.md` sections S and T for what was decided
and why.

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

## Dependencies

`@erp/compliance-contract`, `@erp/db`, `@erp/shared` — no dependency on `packages/core` or any
`packages/modules/*` (docs/02-ARCHITECTURE-RULES.md §1; this package is a leaf). Nothing may
import this package except via the compliance contract (enforced by
`.dependency-cruiser.cjs`'s `no-module-depends-on-zatca-directly` rule).

## Known gaps (Phases 1 and 3 only)

- No onboarding flow (CSR → compliance CSID → compliance checks → production CSID) — Phase 2.
- No hashing, signature, or QR — Phase 4. The XML builder produces the document those three
  things get added to, never on its own.
- No submission (clearance/reporting) — Phase 5.
- No API endpoints or UI anywhere yet — nothing creates an `EgsUnit` through a real use case;
  the integration test creates one directly via Prisma. Nothing calls `buildBareInvoiceXml` from
  a real SalesInvoice either — Phase 5's job to map one onto `ZatcaInvoiceInput`.
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
- Whether the PIH's hex-then-base64 double-encoding also applies to the invoice hash used in
  the XAdES signature and the QR code's tag-6 field is still open — the Security Standard's QR
  section implies tag 6 is the raw 32-byte digest, not this form. Resolve per field in Phase 4.
