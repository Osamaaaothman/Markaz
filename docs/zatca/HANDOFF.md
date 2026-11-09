# ZATCA Phase 2 — handoff to the next agent

Written mid-work because the previous session was about to run out of budget. Everything below is true as of the last
commit on `feat/compliance-zatca`. Nothing here was invented to look finished: where something is unverified, it says so.

## Paste this as the first message to the next agent

```
You are continuing the ZATCA Phase 2 (Fatoora) e-invoicing integration for Markaz (ERP for Saudi/Gulf SMEs; NestJS +
Prisma/PostgreSQL + React/Vite/PrimeReact + i18next ar/en). FIRST ACTION, before reading any file:
  git fetch origin && git checkout feat/compliance-zatca && git pull
(if that branch was already merged into main, branch from latest main under the same name instead).
Then read, in this order: CLAUDE.md (binding), docs/zatca/HANDOFF.md (this file), docs/06-COMPLIANCE-PACK-RULES.md,
docs/01-OPEN-DECISIONS.md sections S..Z, packages/compliance/zatca-sa/README.md.

Owner: Osama (Arabic speaker, .NET dev). Reply to him in Arabic. Code, comments, commits, docs: English. UI text: i18n keys
only, ar + en, never hard-coded. This is a financial system of record: no `any`, no float money, tenant-scoped queries,
never log/return/store-in-plaintext keys, CSIDs, secrets or OTPs.

Work through "What remains" in HANDOFF.md in order, in small commits, pushing to feat/compliance-zatca. Open a PR with the
template in docs/11-GIT-WORKFLOW.md and merge with a MERGE COMMIT (never squash) only when CI is green. Report honestly what is
done and what is blocked; never fake a green result or a sandbox success.
```

## Where things stand (updated 2026-11-08 — Phase 7 and Phase 8 are now done; read this before the stale "What remains" section below)

**This file's own "What remains, in order" section (below) is now historical** — it describes the
state as of 2026-11-05/06. Everything in it is done except what's flagged here. **Read
`docs/zatca/PRODUCTION_GO_LIVE.md` and `docs/01-OPEN-DECISIONS.md` section Z first** — they are the
current, authoritative statement of what is built and what actually remains. Do not re-do Phase
7a/7b or re-derive the Phase 8 gaps from the stale section below.

| Area | State |
|---|---|
| Phases 1-6 | done (as this file already said) |
| Real sandbox onboarding | **RESOLVED** (docs/01 section X): a real compliance CSID was issued end to end, two real CSR bugs found and fixed. |
| Phase 7a back end | **done**: full `compliance.controller.ts`/`dto.ts`/`module.ts`, permissions, real-DB integration tests. |
| Phase 7b web UI | **done**: seller profile, EGS units, onboarding dialog, invoice ZATCA panel — real-browser-tested. Found and fixed 3 real bugs along the way (a partial-update data-wipe, a silent onboarding-error gap, a broken authenticated XML download) — see commit `7711945`. |
| Phase 8 | **done**: a 12-invoice sequential submission concurrency test, a real concurrent-submission test (found and fixed a genuine duplicate-ICV race — migration `20261108180000`, `@@unique([egsUnitId, icv])`), and a rounding test with awkward amounts that **found a real, unfixed self-consistency bug** — see `docs/01-OPEN-DECISIONS.md` section Z and `PRODUCTION_GO_LIVE.md` §6 item 1. **This is the most urgent open item in the whole package.** |
| `docs/zatca/PRODUCTION_GO_LIVE.md` | **written** — the real next-steps document; this file is superseded by it for anything beyond "how did we get here." |
| Still not built, still blocking a real invoice from reaching ZATCA | the submission worker itself (`ZatcaSubmissionParamsLoader`), which needs the product decisions in docs/01 section Z first. |

## Environment facts the last session hit (save yourself the time)

- Cloud sessions here **cannot reach any ZATCA host** (proxy returns 403 on CONNECT; WebFetch says ENOTFOUND) and have **no copy
  of the official SDK** (`docs/vendor/` is git-ignored; Osama keeps it locally). Do not claim anything about the sandbox from
  such a session. If network access is later allowed, ask Osama first before any real call (he approved the earlier 8 calls).
- Pack tests that need SDK files use `describeIfSdk` (`packages/compliance/zatca-sa/src/testing/fixtures.ts`): skipped *by name*
  without the SDK. Never use plain `describe.skip` with a body that reads files: Jest still runs the body.
- The pack tests need `DATABASE_URL` (a Postgres with all migrations applied via `prisma migrate deploy` using the migrate
  role's URL) to run the DB suites; without it they skip.
- After changing the pack, run `npm run build` inside `packages/compliance/zatca-sa` before type-checking `apps/api`
  (it resolves the pack through `dist`).
- Prisma client must be regenerated after switching branches (`npx prisma generate --schema packages/db/prisma/schema.prisma`).
- Commit types allowed by commitlint: feat, fix, refactor, test, docs, chore, perf, db, i18n, style (NOT `build`).
  End every commit message with:
  `Co-Authored-By: Claude <noreply@anthropic.com>` and the session trailer if one is given.
- `npm run migrate:deploy` needs a `.env` at the repo root; in a bare container run `prisma migrate deploy` directly from
  `packages/db` with `DATABASE_URL=$MIGRATE_DATABASE_URL`.

## What remains, in order

### 1. Finish Phase 7a (API)

`apps/api/src/compliance/compliance-admin.service.ts` already implements (read it first): `overview`, `sellerProfile` /
`updateSellerProfile` (locked once any certificate is issued), `listEgsUnits` / `getEgsUnit` / `createEgsUnit`,
`startOnboarding` (OTP -> CSR -> compliance CSID), `runComplianceChecks` (all six samples, all attempted, unit advances only if all
pass), `requestProductionCsid`, `renew`, `invoiceRecord`, `invoiceStatuses`, `xml(signed|cleared)`, `resubmit` (throws
`SUBMISSION_NOT_WIRED` unless a `Resubmitter` is provided, which today it is not on purpose).

To do:
- `compliance.dto.ts`, `compliance.controller.ts`, `compliance.module.ts` (model them on `apps/api/src/setup/*`), registered in
  `apps/api/src/app.module.ts`. Routes (all under `v1/compliance`): `GET overview`; `GET|PUT seller-profile`; `GET|POST egs-units`,
  `GET egs-units/:id`; `POST egs-units/:id/onboarding/start {otp}`, `.../compliance-checks`, `.../production-csid`, `.../renew {otp}`;
  `GET invoices/:salesInvoiceId`, `GET invoices/statuses?ids=a,b`, `GET invoices/:salesInvoiceId/xml?kind=signed|cleared`
  (send as an attachment), `POST invoices/:salesInvoiceId/resubmit`. Map `ComplianceError` codes to HTTP like
  `mapHrPaymentErrors` in `apps/api/src/hr/hr.controller.ts` (NOT_FOUND -> 404, WRONG_STATUS/SELLER_LOCKED/SELLER_PROFILE_INCOMPLETE/
  SUBMISSION_NOT_WIRED -> 409 with `{ message, code, details }`, ENCRYPTION_KEY_MISSING -> 409 or 503).
- DTO validation: VAT 15 digits starting and ending with 3; `buildingNumber` and `additionalNumber` 4 digits; `postalCode` 5 digits;
  `crNumberScheme` one of CRN MOM MLS SAG OTH NAT GCC IQA PAS CCN CBI; `countryCode` 2 letters; `invoiceTypes` 4 characters of 0/1;
  OTP digits only, never echoed or logged.
- Permissions: add `compliance:read` and `compliance:manage` to `packages/db/prisma/seed.ts` (PERMISSIONS list and the Admin
  role). Onboarding / profile / EGS endpoints need `manage` (a separately audited privilege, docs/06 §5); reads need `read`.
- Config: env var `ZATCA_ENVIRONMENT` (`sandbox|simulation|production`, default `sandbox`, validated) -> `defaultEnvironment`;
  `ZATCA_KEY_ENCRYPTION_KEY` is already documented in `.env.example` (add `ZATCA_ENVIRONMENT` there too). The module builds the
  `OnboardingService` lazily (a thunk) so the API still boots without the key: `new OnboardingService(prisma, loadEncryptionKey())`.
- Integration test (`apps/api/src/compliance/compliance-admin.integration.spec.ts`, real DB, scripted transport as in
  `packages/compliance/zatca-sa/src/onboarding/onboarding.service.spec.ts`): profile validation and lock, EGS create (chain row
  exists), onboarding steps and status transitions, a failing sample keeps the unit at COMPLIANCE_CSID_ISSUED and reports every
  failure, an OTP never appears in audit rows or responses, tenant isolation (another company's unit is 404), `invoiceRecord`
  never exposes ciphertext.

### 2. Phase 7b (web)

`apps/web/src/features/compliance/`: (a) settings page: seller profile form + EGS units list/create + certificate-expiry warning
(use `expiry`/`daysUntilExpiry` from the API); (b) onboarding page for one EGS: OTP input -> run step 1 -> run checks (show each
document's result) -> production CSID -> renewal, each step's result visible; (c) an invoice ZATCA panel on the sales-invoice
detail/list: status badge, warnings/errors, download signed/cleared XML, QR, environment label ("sandbox" must be visibly
labelled, docs/06 §7), a **Resubmit** button shown only when `capabilities.resubmit` is true and `canResubmit`.
Follow the patterns in `apps/web/src/features/setup/*` and `features/audit/*`; nav entry + route guarded by `compliance:read`
(`apps/web/src/app/layout/NavConfig.ts`, `AppRoutes.tsx`); ar + en keys with parity (`npm run i18n:parity`); RTL-correct.
Verify in a real browser in Arabic (Playwright is preinstalled) and take screenshots for the PR.

### 3. Phase 8 (honest scope)

Already covered: XML builder, hash, signing, QR TLV, chain (20-way concurrency in `egs-chain.integration.spec.ts`), rounding in
the builder, submission outcomes, onboarding. Missing and worth adding: a submission-level concurrency test (many invoices for
one EGS through `InvoiceSubmissionService`, chain stays gapless) and a rounding test with awkward amounts. The full sandbox proof
(onboarding, 3 simplified chain + 2 standard + credit/debit notes, SDK validation of every type) **cannot be done** until section X
is resolved and the SDK is available; write that into the go-live report instead of mocking it.

### 4. `docs/zatca/PRODUCTION_GO_LIVE.md` (write last)

Ordered checklist tied to this code: vendor tasks, per-client tasks (Fatoora portal login, OTP per EGS, exact legal/address data),
exact config (env vars, URLs, certificate template names, key storage), security hardening (the `ZATCA_KEY_ENCRYPTION_KEY` env var
is the single point of failure: backups, loss procedure, rotation; backup of `egs_chain_states`), operations (certificate renewal
before expiry, monitoring failed/pending, the 24 h reporting deadline, alerting, 10-year retention of signed XML), known risks (section X
prominent, everything marked `// REVIEW:`), and an effort estimate per remaining item.

## Known gaps to put in docs/01 as a new section Z and in the go-live report

- **Nothing submits invoices yet.** No code maps a `SalesInvoice` to a `ZatcaInvoiceInput` or chooses the EGS
  (`apps/api/src/compliance/zatca-submission.job.ts` has the seam; no worker is registered). Missing data for a correct mapping:
  `TaxCode` has no exemption reason code (a Z/E line cannot be built), `Item.unit` is free text (needs a UN/ECE unit code),
  `SalesInvoice.invoiceDate` is a date without a time, sales has no debit note, standard-vs-simplified rule (proposal: customer with a VAT
  number = standard), payment means code. These are product decisions: ask Osama (docs/13 format), do not guess.
- `ZATCA_BASE_URL.sandbox` still points at `.../developer-portal`; section X found `.../simulation` returns real structured errors. Left as is
  until the environment/endpoint question in X is answered by Osama.
- Endpoints, headers and JSON shapes in `zatca-api-client.ts` / `onboarding-api-client.ts` are `// REVIEW:` (unconfirmed against ZATCA's swagger).
- `runSdkValidation` flags and verdict line are unconfirmed.
- Compliance-check sample content and the CSR `registeredAddress` format are unconfirmed (`// REVIEW:` in the code).
