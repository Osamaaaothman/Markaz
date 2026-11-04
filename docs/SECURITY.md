# SECURITY.md — ZATCA key custody

Required by `docs/06-COMPLIANCE-PACK-RULES.md` §5 before implementing `EgsCredential`. Scope:
the encryption scheme for a deployment's own ZATCA private keys and CSIDs, nothing else (the
broader threat model table in `docs/09-SECURITY-RULES.md` §9 is still a TODO and not
duplicated here).

## What is stored, and where

Per-EGS, in `egs_credentials` (`packages/db/prisma/schema.prisma`):

| Column | Sensitivity | Storage |
|---|---|---|
| `csr` | Public (derived from the key pair, contains no secret) | Plaintext |
| `private_key_ciphertext` | **Highest** — signs every invoice | Encrypted |
| `compliance_csid_ciphertext` / `compliance_secret_ciphertext` | High — authenticates to ZATCA's compliance APIs | Encrypted |
| `production_csid_ciphertext` / `production_secret_ciphertext` | High — authenticates to ZATCA's reporting/clearance APIs | Encrypted |
| `certificate_expires_at` | Not secret (a public certificate's own expiry) | Plaintext — queried directly for renewal alerting |

Each customer's isolated deployment holds and encrypts **its own** key material; there is no
central custody across customers (`docs/adr/0002-...md`), so this document describes what
happens *inside one deployment*, not a cross-customer key management service.

## Encryption scheme

`packages/compliance/zatca-sa/src/key-encryption.ts`:

- **AES-256-GCM**, authenticated. A stored value is `[12-byte IV][ciphertext][16-byte auth
  tag]`, one `Bytes` column per secret. A tampered or truncated value fails to decrypt instead
  of silently returning wrong bytes.
- A fresh random IV every call — the same plaintext never produces the same ciphertext twice,
  so an attacker with read access to the table cannot tell two secrets apart by comparing
  bytes.
- The **decryption key lives outside the database**: `ZATCA_KEY_ENCRYPTION_KEY`, a 32-byte
  value, base64-encoded, in the deployment's environment (`.env`, or the hosting platform's
  secret store) — never in a column, never in a migration, never in a seed file. This is the
  "strong local encryption scheme with the decryption key held outside the database" option
  docs/06 §5 names as the fallback when the hosting environment has no KMS, which is the case
  for every Tier-1 deployment target today (Docker Compose, on-prem or a plain cloud VM).
- Decrypted only in memory, only for the duration of a signing or authentication call — Phase 2
  onward must not cache a decrypted secret in a variable that outlives that one operation, and
  must not pass a decrypted value to anything that might log it (docs/09 §7's redaction rule
  covers ordinary log fields, not a value a careless `catch` block might stringify).

## Key loss

**Losing `ZATCA_KEY_ENCRYPTION_KEY` makes every stored private key and CSID permanently
unrecoverable** — there is no recovery path, by design (the alternative, a recoverable scheme,
would mean the key is not actually required to read the secrets). This means:

- `ZATCA_KEY_ENCRYPTION_KEY` must be included in whatever the deployment backs up as
  "application secrets" (alongside the database credentials and the Activation Service master
  key, per `docs/09-SECURITY-RULES.md` §5) — backing up the database alone is not enough.
- If it is lost anyway: every EGS unit must be re-onboarded from a new OTP (new CSR, new
  compliance/production CSIDs). The invoices already cleared or reported before the loss are
  unaffected (their signed/cleared XML is stored separately, in the clear, on
  `zatca_invoice_records` — it does not need the key to be read back). Only the *ability to
  sign new invoices* is lost until re-onboarding completes.
- This is the same risk CLAUDE.md §1 calls "unrecoverable trust damage" if mishandled — the
  go-live report (M7's final deliverable) must tell every client exactly how their deployment's
  backup covers this env var.

## Access and audit (not yet built)

Per docs/09 §5, "access to key material is a separately audited privilege." **Not implemented
in Phase 1**: nothing calls `IAuditLogger` around a decrypt yet, because nothing decrypts
anything yet — `EgsCredential` has no reader or writer beyond the integration test. This is a
Phase 2 requirement (the onboarding and signing services), not a gap in this document; tracked
in `packages/compliance/zatca-sa/README.md` and `docs/01-OPEN-DECISIONS.md` section S.

## Compromise procedure (outline — finalise in Phase 2)

1. Revoke the compromised CSID in the Fatoora portal (customer-initiated on Path A; Osama
   assists directly on a Path B deployment he operates — `docs/09-SECURITY-RULES.md` §5).
2. Generate a new EC key pair (secp256k1 — `docs/01-OPEN-DECISIONS.md` section S) and CSR for
   the affected EGS unit; re-run onboarding with a new OTP.
3. The old `egs_credentials` row's ciphertext columns are overwritten, not kept — there is no
   legal requirement to retain a revoked key, unlike an invoice's signed XML.
4. Any invoice signed with the compromised key before revocation remains valid (ZATCA's
   clearance/reporting already accepted it); this procedure stops *future* abuse, it does not
   retroactively invalidate past documents.

This outline is not yet exercised end to end — doing so is part of Phase 2/6 (onboarding +
local SDK validation) and must be proven against the sandbox before it is trusted for a real
compromise.
