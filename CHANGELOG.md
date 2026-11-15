# Changelog

Every breaking change and every migration is recorded here —
`docs/11-GIT-WORKFLOW.md` §7.

## [Unreleased]

### Complete interface style coverage (2026-11-15)

- Apply Balance, Canvas and Precision to small/gridlined tables, account trees,
  rounded/icon/segmented actions, pagination, popup menus, calendars and feedback.
- Add an operational component gallery using the application's shared controls
  and a browser regression gate covering locales, modes, mobile and palettes.
- Synchronize PrimeReact provider locale so portal and control labels follow the
  active language.
- Add sales invoice settlement status and outstanding balances from the existing
  receipt/credit/debit-note balance calculation, plus loaded-row status filters,
  page checkboxes and selected CSV export. No posting calculation changes.
- Replace the collapsed document list with linked document cards and a permission-
  checked Activity tab that opens existing recorded audit details on invoice,
  voucher and other document pages. Remove Precision's secondary navigation bar.
- Fix wide-table sticky headers intercepting the first row's controls. Gate the
  actual invoice/voucher routes with browser checks. No database migrations.

### Combined production release (2026-11-15)

- Add company-scoped cost centers, projects and departments to expense lines and
  journal details; preserve allocation links on reversals and legacy free text.
- Add independent interface styles and palettes, responsive module navigation and
  themed choice controls. Design-study pages remain outside the normal app build.
- Integrate pending sales-price, provisional inventory-cost, voucher and ZATCA
  validation/renewal branches. The release has four database migrations; follow
  [the rollout runbook](docs/releases/2026-11-15.md) before deploying.


### Receipt/payment voucher selection and amounts (2026-11-15)

- Filter cash and bank accounts by payment method using configurable account folders.
- Add customer, supplier, employee and account counterparties to both voucher forms,
  with matching server validation, stored counter-accounts and correct report classification.
- Fix stale memoized input cells in “Settle now”; support Arabic digits and a total
  calculated from entered allocations when the voucher amount is blank.
- Add `20261115100000_payment_counterparties`. It preserves legacy rows and configures
  standard cash/bank folders; custom charts can choose folders in account-mapping settings.
- Reverse the original accounts and retain allocation history. See
  [payment vouchers](docs/PAYMENT-VOUCHERS.md) for rollout and validation details.

### Invoice, compliance and document release (2026-11-14)
- Wire sales invoices and credit/debit notes to the compliance pack, with submission
  evidence, retry history, XML downloads and printable QR status. Sandbox data-only
  QR previews remain explicitly labelled; real onboarding still needs portal access.
- Unify company letterheads, buyer/supplier details, PDF pagination, email branding
  and inline logos. Fix stored-image content types and add English amount wording.
- Add customer/supplier/dual-role parties and multi-line cash expenses.
- Preserve insufficient-stock rejection; include the entire report cutoff date in
  sales dashboard totals, receivables and party statements after adding issuance time.
- Seven migrations: `20261114090000_zatca_submission_history`,
  `20261114100000_zatca_invoice_wiring`, `20261114110000_sales_invoice_datetime`,
  `20261114120000_cash_expense_lines`, `20261114140000_party_commercial_kinds`,
  `20261114150000_party_dual_commercial_role`, `20261114160000_party_ledger_parent_keys`.
  The expense rollout retains the legacy account column and synchronizes old inserts.
  Historical invoice dates migrate explicitly at UTC midnight.
- Rollout: back up and restore-check the database, apply migrations with the schema
  owner, then deploy API, worker and web from the same merge commit. Keep the expanded
  schema during rollback. Older releases cannot represent multi-account expenses;
  disable new expense entry if reverting application code after such documents exist.

### Reviewed operations and on-demand screens (2026-11-12)
- Load feature screens and the Excel importer on demand.
- Add item/party XLSX and CSV import previews, colored row validation and
  duplicate checks with atomic import and auditing.
- Add persistent quotation email attempts, explicit delivery checks and reviewed
  resends. Add migration `20261112130000_quotation_email_attempts`.
- Add stock replenishment suggestions that create reviewable purchase requests
  and subtract existing requests and outstanding purchase orders.
- See [operation and rollout details](docs/OPERATIONS-UPGRADES.md).

### Stability, drafts and document tracking (2026-11-11)
- Add private server drafts with autosave, version conflicts and stable submission
  keys across purchasing, sales, inventory, journals and payments. Add a
  permission-filtered document trail and persistent bilingual line labels.
- Show warehouse availability and block excessive aggregate stock consumption;
  move issuer metadata into printable page footers.
- Add Resend HTTPS email support with explicit configuration/failure feedback,
  company profile/calendar-year controls, setup fixes, exact WPS totals,
  cross-tab refresh coordination and company-timezone dashboard dates.
- Fix local official-SDK sample validation discrepancies. Actual ZATCA submission
  integration remains deferred by the owner.
- Add migrations `20261111090000_document_drafts`,
  `20261111091000_commercial_submission_keys` and
  `20261111092000_request_count_submission_keys`; all are additive.
- See [rollout and ownership notes](docs/STABILITY-DRAFTS-RELEASE.md) and
  [production email configuration](docs/QUOTATION-EMAIL.md).

### Purchasing workflow and operation feedback (2026-11-10)
- Start orders from approved requests in Purchase Orders. Request and review pages no longer create orders;
  the picker copies all items and quantities, leaving supplier and prices to the buyer. Stale or already
  processed requests cannot silently become unrelated orders, and background refreshes preserve entered prices.
- Dialogs use 80% of the desktop viewport and 96% on small screens; maximized viewers remain full screen.
- A shared toast host reports mutation outcomes across the application, survives navigation, and distinguishes
  partial bulk results. Existing creation/result dialogs and previews suppress duplicate success toasts.
- Stock movement lists and CSV exports include the source document's customer/supplier names in English and
  Arabic. Lookups are batched and company-scoped; internal movements without a party remain blank. No migration.

### Added
- M0 repository foundation: npm workspaces + Turborepo monorepo layout, TypeScript strict
  config, ESLint + dependency-cruiser module-boundary rules, Prettier, commitlint,
  a gitleaks-or-fallback pre-commit secret scan, CI (lint/typecheck/build/test/
  boundaries/audit), and the Docker Compose bundle (api, db, redis, worker, web)
  that is the actual per-customer deployment unit.
- Empty package skeletons for `apps/api`, `apps/web`, `apps/print-agent`,
  `packages/core` (five contract type shapes only), `packages/shared`,
  `packages/db` (Prisma tooling, no models yet), `packages/compliance/contract`
  and `packages/compliance/zatca-sa` (both empty placeholders).
- M1: identity, permissions, audit, and the Activation Service client. JWT auth
  with refresh-token rotation and reuse detection; role-based permissions,
  deny-by-default; append-only audit log enforced at the database level (a
  restricted `erp_app` Postgres role with no UPDATE/DELETE grant, separate from
  the schema-owning migration role); license grace-period logic, unit-tested.
- M2: the accounting core. `Money` value object (decimal.js, half-up rounding to
  the currency's minor unit — docs/adr/0003); chart of accounts, fiscal years/
  periods, journal entries with real database-level integrity: a deferred
  constraint trigger enforcing debit==credit (in both transaction and base
  currency) at commit, a closed-period trigger, and the same append-only role
  restriction already proven for audit_log now also covering journal_entries/
  journal_entry_lines. `IAccountingEngine` and `INumberingService` implemented
  for real (gapless, transactional numbering; idempotent posting; mirrored
  reversals that never touch the original entry). Property-based ledger
  integrity test against a real Postgres, plus a minimal HTTP surface (trial
  balance, manual posting, reversal) verified end-to-end through the actual
  Docker Compose stack.

### Fixed
- `docker-compose.yml` had hard-coded placeholder passwords committed directly
  in source (a real docs/09-SECURITY-RULES.md §1 violation introduced in the M0
  commit) — every credential now comes from a git-ignored `.env` via Compose
  substitution.
- `packages/shared`/`packages/core`/`packages/db` published `main`/`types`
  pointing at raw `.ts` source instead of a compiled `dist/`, which only worked
  for TypeScript-aware tooling — a production container running compiled JS
  crashed on startup unable to resolve `@erp/shared`. Fixed by actually building
  these packages and switching the Docker build to `turbo run build` so it
  respects the dependency graph.
- A local-timezone `new Date(y, m, d)` for a calendar-fact field (`@db.Date`)
  serializes to the wrong day on any machine whose local timezone isn't UTC —
  bit an early draft of the M2 integration test. Fixed at the source: the whole
  Node process now runs in UTC (Docker `ENV TZ=UTC` plus a `process.env.TZ`
  fallback), not just the one call site that happened to get caught.
- Turbo's cache didn't know the `test` task's result depends on `DATABASE_URL`,
  so it could silently replay a stale "skipped" result from before the database
  was configured even once it became available. Declared as a cache-key input.
- Two dependency vulnerabilities newly disclosed after the M0/M1 dependency set
  had already audited clean (`multer` via `@nestjs/platform-express`,
  `deepmerge-ts` via prisma's config tooling) — fixed via `overrides`.
- Settling an end-of-service gratuity of zero (e.g. a resignation under two years) failed with
  HTTP 500: the service tried to post a zero-amount journal entry, which the posting engine
  rightly rejects. A settlement with nothing owed is now recorded, ends the employment and posts
  no entry. **Migration** `20261103150000_eosb_settlement_nullable_journal_entry` (expand-only,
  backward-compatible): `end_of_service_settlements.journal_entry_id` becomes nullable, with a
  CHECK that it may be null only when `net_entitlement = 0`. API change: `journalEntryId` in the
  `POST /v1/end-of-service-settlements` response is now `string | null`.
