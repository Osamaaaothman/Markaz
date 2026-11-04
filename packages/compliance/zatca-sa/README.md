# @erp/compliance-zatca-sa

Saudi Arabia's ZATCA e-invoicing compliance pack — implements `@erp/compliance-contract`
(`docs/06-COMPLIANCE-PACK-RULES.md`). The word "ZATCA" lives only in this package; no module
outside it, and nothing in `packages/core`, may mention it (docs/06 §1).

Status: **M7 Phase 1 (data model) only.** No onboarding, no XML, no submission yet — see
`docs/14-MILESTONES.md` M7 and `docs/01-OPEN-DECISIONS.md` section S for what was decided and
why.

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

## Dependencies

`@erp/compliance-contract`, `@erp/db`, `@erp/shared` — no dependency on `packages/core` or any
`packages/modules/*` (docs/02-ARCHITECTURE-RULES.md §1; this package is a leaf). Nothing may
import this package except via the compliance contract (enforced by
`.dependency-cruiser.cjs`'s `no-module-depends-on-zatca-directly` rule).

## Known gaps (Phase 1 only)

- No onboarding flow (CSR → compliance CSID → compliance checks → production CSID) — Phase 2.
- No XML builder, hashing, signature, or QR — Phase 3/4.
- No submission (clearance/reporting) — Phase 5.
- No API endpoints or UI anywhere yet — nothing creates an `EgsUnit` through a real use case;
  the integration test creates one directly via Prisma.
- `FIRST_INVOICE_PREVIOUS_HASH` (base64(SHA-256("0"))) is this task's starting assumption, not
  yet verified against the current official documentation — see the `// REVIEW:` comment next
  to it and `docs/01-OPEN-DECISIONS.md` section S.
- The curve for key generation (secp256k1) is confirmed from two independent sources (ADR-0004,
  docs/01 section S) but not yet cross-checked against the SDK's own docs — do that before
  Phase 2's CSR code ships.
- No per-EGS address override — every EGS at one company currently shares the company's
  national address (docs/01 section S explains the trade-off).
