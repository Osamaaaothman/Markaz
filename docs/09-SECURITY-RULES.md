# 09 — Security & Privacy Rules

We hold other companies' complete financial records, their customers' data, and their
tax stamp private keys. The bar is higher than a normal web app.

---

## 1. Hard rules

1. **No secrets in source or in git history.** Not in code, not in Docker files, not in
   `docker-compose.yml`, not in tests, not in seeds. Only `.env.example` with
   placeholders is committed.
2. **`tenantId` never comes from client input.** See `docs/03-MULTI-TENANCY-RULES.md`.
3. **Tenant cryptographic material is never plaintext, never logged, never returned by
   an API, never in an export.**
4. **Never log financial values or personal data.** Log identifiers.
5. **No raw SQL string interpolation.** Parameterised queries only.
6. TLS everywhere. No plaintext transport, including between containers in production.
7. Passwords hashed with **argon2id** (or bcrypt with a current cost factor). Never
   MD5/SHA/plain, never a homemade scheme.

---

## 2. Authentication

- Short-lived access token + rotating refresh token, with reuse detection.
- Refresh tokens are revocable and stored hashed.
- Session invalidation on password change, role change, and tenant suspension.
- Lockout / throttling on repeated failed logins, per account **and** per IP.
- **MFA at least for tenant admins** — recommend it for everyone. A compromised admin
  account in an accounting system means fraudulent invoices.
- Password reset tokens: single-use, short-lived, hashed at rest, no user enumeration
  in the response.
- Email addresses are verified before an account is usable.

---

## 3. Authorisation

- Permissions are data, not code. `if (user.role === 'admin')` is a defect.
- Checked in the application layer for every use case, not only on the controller.
- Scoped by company/branch where relevant, not just by action.
- **Deny by default.** A new endpoint with no permission declared must fail closed, and
  a test must prove it.
- Privileged actions (period reopen, permission change, key access, tenant
  configuration, data export) require re-authentication or step-up and are always
  audited.
- Platform-admin capability (our staff) is a **separate, minimal, heavily audited**
  surface. Accessing a customer's data requires an explicit, logged, time-bounded
  reason. Never a blanket "support can see everything" backdoor.

---

## 4. Input handling

- Validate everything at the boundary; reject unknown fields.
- Body size limits, request timeouts, per-tenant rate limits.
- File uploads: extension allowlist, MIME allowlist, size cap, **magic-byte check**,
  filename sanitisation (never used to build a storage key), virus scanning hook,
  stored in object storage with non-guessable keys.
- **CSV/Excel export injection:** prefix cells beginning with `= + - @` — an exported
  report that executes a formula in the customer's Excel is a real attack.
- PDF/HTML rendering of user-supplied content must be sandboxed and must not fetch
  remote resources (SSRF).
- Any outbound URL supplied by a tenant (webhooks, logo URLs) is SSRF-guarded:
  no internal ranges, no metadata endpoints, DNS rebinding protection.

---

## 5. Secrets and key custody

- Application secrets in a managed secret store, injected at runtime, never baked into
  an image.
- **Tenant ZATCA private keys / CSIDs: envelope encryption with a KMS-managed key,
  per-tenant data keys.** Decrypted only in memory, only for the duration of a signing
  operation.
- Access to key material is separately permissioned and separately audited — log the
  access event, never the key.
- Key rotation and certificate renewal designed from day one. Expiry must produce an
  alert to us **and** to the tenant well in advance.
- Documented compromise procedure: revoke, reissue, notify.

---

## 6. Data protection (Saudi PDPL and customer procurement)

- Know and document what personal data is held, where, and for how long.
- **Data residency is an open decision** (`docs/01-OPEN-DECISIONS.md` A2) — assume
  in-Kingdom hosting is required until verified otherwise.
- Encryption at rest for the database, backups, and object storage.
- Per-tenant data export (full, machine-readable) and per-tenant deletion, with a
  documented retention window. **Note the conflict:** tax records have a ≥10-year
  retention obligation that overrides a general deletion request — document how the two
  are reconciled rather than picking one.
- Access to production data by our staff is logged, minimal, and reviewable.
- Subprocessors (email, hosting, KMS) listed and disclosed.

---

## 7. Logging and observability

**Never logged:** passwords or tokens · key material · full bank account numbers ·
national IDs · full request bodies of financial endpoints · monetary amounts and
balances · customer PII beyond an identifier · anything from another tenant.

**Always logged:** `tenantId`, `correlationId`, actor id, action, entity type, entity
id, outcome, duration.

Enforce with a **central redaction utility** in the logger, not developer discipline,
and write a test that asserts a fully populated invoice produces logs containing none
of its sensitive values.

---

## 8. Dependencies and supply chain

- Lockfile committed. Automated dependency audit in CI, failing on high/critical.
- New dependency = a decision: justify it, check maintenance and licence, prefer the
  standard library or an existing dependency. Every package is code we ship.
- No package added without telling Osama (`docs/13-COLLABORATION-PROTOCOL.md`).
- Pin base images by digest; rebuild regularly for patches.

---

## 9. Threat model (`docs/SECURITY.md` — write it, keep it current)

At minimum:

| Threat | Mitigation | Gap / future work |
|---|---|---|
| Cross-tenant data access | | |
| Compromised tenant admin account | | |
| Insider access to production data | | |
| Theft of tenant ZATCA private keys | | |
| Fraudulent invoice creation | | |
| Backup exfiltration | | |
| Export/formula injection | | |
| SSRF via tenant-supplied URLs | | |
| Denial of service via expensive reports | | |
| Dependency compromise | | |
| Silent ledger corruption via a bug | | |

Be honest about what is not mitigated yet. A documented gap is manageable; an unknown
one is not.

---

## 10. Incident readiness

Before the first paying customer:
- Backups **tested by actually restoring**, not just configured
- A documented procedure for: suspected breach, key compromise, data corruption,
  a bad migration
- Alerting on: failed ZATCA submissions, dead-letter queue growth, trial balance drift,
  authentication anomalies, backup failure
- A rollback plan for every deployment
