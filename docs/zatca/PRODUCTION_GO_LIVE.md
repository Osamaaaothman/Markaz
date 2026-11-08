# ZATCA Phase 2 (Fatoora) — production go-live checklist

Written at the end of Phase 7 (2026-11-08), after the admin API/UI shipped and two real correctness
bugs were found and fixed by actually running this code against a real database and a real browser
(not just reading it). This document is the honest state of what it takes to let a real customer's
real invoice reach ZATCA — it does not round up what is unfinished, and it does not invent numbers
this repository has not verified. Where ZATCA's own behavior is unconfirmed, it says so and names
exactly what would confirm it, per CLAUDE.md §6.

**Read this alongside `docs/01-OPEN-DECISIONS.md` sections S–Z** (the full build history and every
`// REVIEW:` this package carries) and `docs/06-COMPLIANCE-PACK-RULES.md` (the binding rules this
whole pack was built against). This file is the checklist; those are the reasoning.

---

## 1. What is actually built, in one table

| Piece | State |
|---|---|
| Seller profile, EGS unit management, onboarding (CSR → compliance CSID → compliance checks → production CSID → renewal) | **Built and working.** Real-database integration tests, real browser testing, one real sandbox onboarding run (section X) with a real compliance CSID issued. |
| XML generation (6 document types), hashing, XAdES signing, QR | **Built**, verified byte-for-byte against the official SDK's own samples (sections T, U). |
| Local pre-submission validation (`checkInvoiceConsistency`, `verifySignedInvoice`) | **Built**, wired into submission. **Found a real self-consistency bug in the XML builder in the course of this** — see §6 below, not yet fixed. |
| ICV/PIH chain (gapless, no duplicate ICV/PIH under concurrency) | **Built and proven** — a 20-way DB-level concurrency test, a 12-invoice sequential submission-level test, and a real concurrent-submission test that found and fixed a second real bug (§6). |
| Submission orchestration (`InvoiceSubmissionService`) | **Built**, tested against a scripted ZATCA transport (never the real endpoint, per docs/06 §6) for every outcome: cleared, reported, rejected, transient failure + retry, auth failure. |
| **Mapping a real `SalesInvoice` to an actual ZATCA submission** | **NOT built.** `zatca-submission.job.ts` is a tested seam; nothing calls it. This is the one piece standing between everything above and a real customer invoice actually reaching ZATCA. Blocked on product decisions, not code — see §4. |
| Admin API + web UI (Phase 7) | **Built**, real-database tests, real browser verification. Found and fixed: a partial-update bug that wiped the seller profile, a silent-failure gap in the onboarding dialog, a broken authenticated-download path. |
| SDK-based validation (`runSdkValidation`) and the official Schematron/XSD cross-check | **Not run on this machine** — the local SDK install's own config points at a path (`C:\SDK\...`) that does not exist here. Pre-existing, not something this session's changes touch; whoever runs this next needs to either fix that path or accept this check stays unexercised until it is. |

---

## 2. Vendor tasks (this codebase, before any customer goes live)

In priority order — each blocks the one after it in practice, even though none is a hard dependency
in the code:

1. **Fix or confirm the rounding self-consistency bug** (docs/01 section Z, "Found while writing
   Phase 8's rounding test"). A completely ordinary multi-line invoice can fail local validation
   permanently (`UnrecoverableError`, no automatic retry) because the per-line displayed tax amount
   and the document subtotal round the same numbers two different ways. **This needs ZATCA's actual
   Schematron rules or a real sandbox submission with deliberately awkward amounts before it is
   fixed** — guessing the rounding convention risks a legally wrong invoice. Effort once the rule is
   confirmed: half a day (the fix is small; confirming the rule is the real work).
2. **Answer the product decisions in docs/01 section Z**, so the submission worker can be written
   correctly: which `EgsUnit` issues a given invoice, standard-vs-simplified rule, tax exemption
   reason codes, item unit-of-measure codes, invoice time (not just date), payment means code.
3. **Build the submission worker**: a real `ZatcaSubmissionParamsLoader` (decrypts the real
   `EgsCredential`, maps a real `SalesInvoice` to `ZatcaInvoiceInput`) and register a per-EGS BullMQ
   worker at `concurrency: 1` in `apps/api/src/jobs/worker.ts` (docs/01 section V). Effort: 2–3 days
   once §2's decisions are made, assuming the rounding bug is already fixed.
4. **Confirm the still-`// REVIEW:` HTTP contract** (docs/01 section V): endpoints, headers
   (`Accept-Version`, `Clearance-Status`), and the clearance/reporting JSON shapes are from the task
   brief and third-party write-ups, not ZATCA's own Integration Sandbox swagger. Section X proved
   `requestComplianceCsid` works for real; `submitComplianceInvoice`/clearance/reporting have never
   been exercised against the real sandbox. **Needs Osama to pull the live swagger from the
   authenticated Fatoora portal**, the same way section X's `/developer-portal` endpoint question
   was finally resolved — do not trust a third-party forum post over ZATCA's own documentation.
5. **Confirm CSID renewal's auth shape** against the real sandbox (docs/01 section W) before the
   first real EGS certificate approaches expiry — this path has never been exercised, real or
   scripted, beyond unit-level assumptions.
6. **Resolve the SDK-gated test gap** (§1 above) so `runSdkValidation` and the Schematron
   cross-check suite actually run somewhere in this project's lifecycle, even if only on Osama's own
   machine with the SDK correctly pathed — they currently prove nothing.

## 3. Per-client tasks (every new customer going live on ZATCA)

1. **Fatoora portal registration.** The customer (or whoever manages their ZATCA relationship) logs
   into the Fatoora portal and obtains an OTP per EGS unit they want to onboard — this product never
   stores or requests a Fatoora portal password, only the OTP, once, per onboarding/renewal step
   (docs/09-SECURITY-RULES.md §5).
2. **Seller profile data**, collected once in the admin UI before onboarding: VAT number, CR number
   and scheme, full address (street, building number, district, city, postal code), the Arabic legal
   name (ZATCA requires it regardless of the UI's display language). All required fields are
   enforced by `requireCompleteSeller` before onboarding can even start.
3. **One EGS unit per issuing point.** A single-branch SME needs one; a multi-branch company needs
   one per branch today's schema supports (`EgsUnit.branchName`) — but see §4's "which EGS issues
   this invoice" gap before promising multi-branch support actually works end to end.
4. **Environment choice.** `ZATCA_ENVIRONMENT` starts every new deployment on `sandbox`. Moving a
   real customer to `production` is a deliberate, config-only switch (see §4) — never do it before
   a full onboarding + sample-submission dry run has passed on that customer's own data in sandbox.

## 4. Exact configuration

- **`ZATCA_KEY_ENCRYPTION_KEY`** — 32 random bytes, base64-encoded (`openssl rand -base64 32`).
  Generated once per customer deployment, stored **outside** the database (the deployment's secret
  manager / environment, never in `.env` committed to git, never logged). See §5 — losing this key
  is permanent, unrecoverable data loss for every stored private key and CSID.
- **`ZATCA_ENVIRONMENT`** — `sandbox | simulation | production`, default `sandbox`. This is the
  *only* code-level switch between environments; everything else (certificate template name per
  environment, base URL) is already keyed off it in `packages/compliance/zatca-sa`. Confirm it is
  actually set to `production` before a real customer's first real invoice — the default is
  deliberately the safe one.
- **No other ZATCA-specific env var exists today.** If §2's HTTP-contract confirmation (item 4)
  turns up a different base URL or header requirement for clearance/reporting than what
  `zatca-api-client.ts` currently hard-codes, that is a code change, not a new env var — flag it as
  a decision, do not silently add configuration to work around an unconfirmed contract.

## 5. Security hardening

- **`ZATCA_KEY_ENCRYPTION_KEY` is the single point of failure for every onboarded EGS.** It decrypts
  every private key and CSID this deployment has ever stored (AES-256-GCM envelope encryption,
  docs/01 section S). **Before any customer onboards their first real EGS:**
  - Back it up somewhere independent of the application database (a password manager entry, the
    deployment's own secret store with its own backup policy — never inside the Postgres backup
    that also holds the ciphertext it decrypts, or the backup is useless).
  - Write down, for whoever operates this deployment, exactly what "lost the key" means in
    practice: every EGS unit must be re-onboarded from a fresh CSR (a new OTP from the customer's
    Fatoora portal, a new compliance CSID, new compliance checks, a new production CSID) — there is
    no recovery path for the old key material, by design (docs/09-SECURITY-RULES.md §5: this is
    the tradeoff of not having a KMS).
  - **Rotation is not built.** If this deployment ever needs to rotate the encryption key, that is
    unbuilt work: decrypt every stored secret with the old key, re-encrypt with the new one, in one
    transaction, with the old key still available until it is verified. Not attempted here — flag
    as a decision if a customer's security policy requires periodic key rotation.
- **`egs_chain_states` needs the same backup discipline as the rest of the ledger.** Losing or
  restoring-from-stale-backup this table is not just data loss — a chain restored to an earlier ICV
  and then advanced again would reissue an ICV ZATCA has already seen, which is exactly the
  tamper-evidence property this chain exists to prevent. Back it up at the same cadence as the
  accounting tables it sits beside, never less frequently.
- **OTPs are never stored or logged** (verified by this session's own integration test,
  "an OTP never appears in results or audit rows") — this holds today and should be re-asserted by
  any future change to the onboarding path, not assumed to still hold after a refactor.

## 6. Known risks (read before promising a go-live date)

1. **The rounding self-consistency bug (§2 item 1) is the most urgent open item.** It is not a rare
   edge case — any multi-line invoice whose line-level tax amounts (computed to 4 decimal places per
   docs/01 D3/E3) land on a rounding boundary can trigger it, and the failure is a permanently stuck
   invoice, not a retryable one. This should be resolved before the submission worker (§2 item 3) is
   built, not discovered later against a real customer's books.
2. **Nothing has been proven against ZATCA's actual clearance/reporting endpoint.** Section X proved
   `requestComplianceCsid` works for real. Every other real-network call this package will ever make
   — compliance-check submission, clearance, reporting, renewal — rests on an HTTP contract read
   from a task brief and third-party integration write-ups, not ZATCA's own confirmed documentation.
   Budget real sandbox time for this before committing to a production date, the same way section X
   budgeted "as many calls as necessary, not just one."
3. **The ICV/PIH chain's concurrency safety depends on an operational guarantee that does not exist
   yet** (one BullMQ worker per EGS at `concurrency: 1` — not registered anywhere in `worker.ts`
   today). This session added a defense-in-depth database constraint
   (`@@unique([egsUnitId, icv])`, migration `20261108180000`) so a violation of that guarantee fails
   fast and cheap (before any real network call) instead of corrupting the chain or silently losing
   a real submission — proven by a real concurrent-call integration test. The constraint is a safety
   net, not a substitute for actually wiring the worker correctly.
4. **Certificate renewal's auth shape is unconfirmed** (§2 item 5). If a real EGS certificate expires
   before this is confirmed and exercised, the renewal call may simply fail against the real sandbox
   in a way no test here has ever observed.
5. **10-year retention** (docs/06 §2: "never hard-delete an e-invoice record") is a database-level
   convention today (`EgsCredential`/`ZatcaInvoiceRecord` have no delete path exposed anywhere in
   this codebase, and the application DB role has no `DELETE` grant on `zatca_invoice_records` —
   confirmed directly while cleaning up this session's own test data, which needed the migrator
   role). This is a real, working safeguard, not just a policy statement — but it has never been
   deliberately tested as a retention *feature* (e.g. "can a 10-year-old record still be read back
   correctly after several migrations"), only observed as a side effect of normal development.
6. **The 24-hour B2C reporting deadline** (docs/06 §7) has no monitoring or alerting built around it.
   Today, a `SUBMITTING`/`FAILED_RETRYABLE` invoice sitting unresolved for over 24 hours is
   indistinguishable, in the UI, from one that has been stuck for five minutes. Before go-live,
   decide who is alerted and how (email? a dashboard badge with an age threshold?) — not guessed at
   here, it is an operations decision for whoever runs this deployment day to day.
7. **No certificate-expiry alerting exists outside the admin screen itself.** `expiry`/
   `daysUntilExpiry` (`EXPIRING_SOON` at a configurable `expiryWarningDays`, default 30) are computed
   and shown on the ZATCA settings page, but nothing pushes a notification — someone has to remember
   to look. Same open question as item 6: decide the alerting mechanism before relying on this for a
   real customer's compliance.

## 7. Effort estimate for what remains

Rough, not a commitment — every number assumes the decisions in §2 item 2 are answered promptly and
no new real-sandbox surprise shows up (section X's own history says budget for at least one).

| Item | Estimate |
|---|---|
| Confirm ZATCA's rounding rule + fix the self-consistency bug | 0.5–2 days (mostly waiting on confirmation, not coding) |
| Product decisions (docs/01 section Z) | Not this repo's estimate to give — depends entirely on how fast Osama can decide |
| Submission worker + real `SalesInvoice` → `ZatcaInvoiceInput` mapping | 2–3 days |
| Confirm clearance/reporting HTTP contract against real sandbox | 1–2 days of real sandbox calls, spread over however long it takes to get it right (section X took three real findings to resolve one endpoint) |
| Confirm renewal auth shape | 0.5 day, once a real EGS is close enough to expiry to test against, or deliberately tested early |
| Reporting-deadline and certificate-expiry alerting | 1 day for a minimal version (a dashboard badge + a scheduled check) |
| SDK/Schematron validation actually running | 0.5 day, environment-only (fix the path) |

**Total before a first real customer invoice can safely reach ZATCA: roughly 1–2 weeks of focused
work**, assuming no new real-sandbox surprises and the product decisions come back quickly. This is
a floor, not a ceiling — section X's own history (three real findings across ten real sandbox calls
to get one endpoint right) is the honest precedent for how this kind of estimate tends to move.
