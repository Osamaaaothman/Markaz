# 14 — Milestones

Tier 1 only. Each milestone has a **gate** — it is not complete until the gate passes.
Confirm each milestone with Osama before starting it.

The ordering is deliberate: the platform guarantees (tenancy, money, ledger) come
before features, because retrofitting them is a rewrite.

---

## M0 — Repository foundation
**Branch:** `chore/monorepo-scaffolding`

- Monorepo layout per `docs/00-PRODUCT-BRIEF.md` §3
- TypeScript strict, ESLint, Prettier, commitlint, gitleaks pre-commit hook
- **Module boundary lint rules** (dependency-cruiser / `no-restricted-imports`)
- CI: lint · typecheck · build · test · dependency audit · i18n key parity
- Docker Compose: api · db · redis · worker · web, all healthchecked
- `README.md`, `CHANGELOG.md`, `docs/adr/`, `.env.example`
- Branch protection on `main`

**Gate:** `docker compose up -d` gives a working empty system; CI green.

---

## M1 — Identity & licensing foundation
**Branch:** `feat/identity-foundation`

> Simplified by `docs/adr/0002-drop-saas-single-purchase-per-customer-deployment.md`:
> one deployment = one company, so no multi-tenant platform work belongs here anymore.

- Authentication (tokens, refresh rotation, lockout), password hashing
- Permissions as data: roles, permissions, `IPermissionService`
- `IAuditLogger` with an append-only table and no UPDATE/DELETE grant
- Company/branch model inside Core (a customer may run multiple legal entities on
  their one deployment — ordinary data scoping, not a security boundary)
- License/activation **client** integration: this deployment validates its master key
  and reports seat usage against the central Activation Service, with the offline
  grace-period behavior from `docs/01-OPEN-DECISIONS.md` A5
- Install runbook: seed default chart of accounts, numbering series, fiscal calendar,
  initial admin user

**Gate:** a fresh install runs end to end via the runbook with no manual steps beyond
what it documents; the deployment keeps functioning correctly through a simulated
Activation Service outage within the grace period, and behaves correctly once that
period is exceeded.

---

## M2 — Accounting core
**Branch:** `feat/core-accounting-engine`

- Shared `Money` type, currencies, exchange rates with snapshotting
- Chart of accounts (tree, types, postable leaves), seed template
- Fiscal years and periods with state machine and DB-level closed-period enforcement
- Journal entries + lines, with **database constraints** for balance and sign
- `IAccountingEngine`: post, reverse; account mapping as tenant configuration
- `INumberingService`: gapless, transactional, per tenant/type/fiscal year
- Trial balance, balance sheet, income statement, cash flow
- **Property-based ledger integrity test** (`docs/10-TESTING-RULES.md` §2.1)

**Gate:** random operation sequences always leave the trial balance at zero; posting
into a closed period is rejected by the database; concurrent numbering produces no gaps
and no duplicates.

---

## M3 — Platform services
**Branch:** `feat/platform-services`

- BullMQ + Redis worker (separate process), job conventions, DLQ + alerting
- Outbox pattern implementation
- Idempotency key handling
- Approval workflow engine (configurable threshold — Tier 1 scope, decision B6)
- Notification/email service with bilingual templates
- Bilingual PDF rendering pipeline (server-side, RTL-correct)
- i18n scaffolding, locale key parity check in CI
- Observability: structured logging with redaction, metrics, health endpoints
- **Local print/hardware agent** (small `localhost`-bound helper, installed only on
  machines that need direct printer/device access — `docs/00-PRODUCT-BRIEF.md` §8):
  first version covering whatever hardware the first real customer actually needs

**Gate:** a job survives a worker crash and still completes exactly once; a PDF renders
correctly in Arabic RTL and English LTR; the web app successfully prints to a real
local printer through the agent on at least one target OS.

---

## M4 — Inventory
**Branch:** `feat/inventory-module`

- Items, warehouses, stock levels, stock movements
- Internal purchase request with status flow
- Reorder point with alerts
- Receiving against a purchase order → stock update → **posting via `IAccountingEngine`,
  in the same transaction**
- Stock count adjustments (gain/loss)
- Cost layers table designed to support **both** FIFO and weighted average
  (**valuation logic blocked on decision A3**)

**Gate:** inventory valuation total reconciles to the inventory control account; a
concurrent issue of the last unit fails cleanly.

---

## M5 — Purchasing
**Branch:** `feat/purchasing-module`

- Suppliers
- Purchase request → supplier/price selection → Purchase Order
- Approval path above a configurable amount
- Goods receipt
- Simplified 3-way matching (PO ↔ receipt ↔ invoice) before final approval
- Supplier invoice posting

**Gate:** full purchase cycle end to end; a quantity or price variance is surfaced and
handled, not silently absorbed.

---

## M6 — Sales & AR
**Branch:** `feat/sales-module`

- Customers
- Quotation → Sales Order → Invoice, as one linked chain
- VAT via **tax treatment codes**, not bare rates
- Invoice posting: revenue, VAT output, receivable, COGS
- Payments, partial payments, credit notes
- Customer statement, **aging report**
- Bilingual PDF, email delivery

**Gate:** AR sub-ledger reconciles to the receivables control account; the aging report
ties to the ledger.

---

## M7 — ZATCA compliance pack
**Branch:** `feat/compliance-zatca`

> **Verify current ZATCA requirements against official documentation first**
> (`docs/06-COMPLIANCE-PACK-RULES.md` §0). Blocked on decision A4.

- `compliance/contract` — country-agnostic interface
- `compliance/zatca-sa` — UBL 2.1 XML, cryptographic stamp, QR TLV, hash chaining
- Per-tenant onboarding (CSR → compliance CSID → production CSID)
- **Key custody with envelope encryption** (`docs/09-SECURITY-RULES.md` §5)
- B2B/B2G clearance vs B2C reporting paths, both through the outbox
- Retry, dead-letter, alerting, tenant-visible status
- 10-year archival: XML, UUID, hash, QR, full ZATCA response
- Golden-file and failure-mode test suites

**Gate:** sandbox end-to-end for both paths, including timeout, rejection, and retry;
no key material anywhere in logs; a crash between commit and submission still results in
submission.

---

## M8 — Licensing & activation
**Branch:** `feat/licensing-activation`

> Replaces the old SaaS "subscription & entitlements" milestone —
> `docs/adr/0002-drop-saas-single-purchase-per-customer-deployment.md`.

- **Activation Service** (separate small standalone service, Osama's own
  infrastructure — not part of any customer deployment): issues a master key per
  customer deployment and a sub-key per employee seat
- Periodic check-in from each deployment, with the offline grace period and lockout
  behavior finalised per `docs/01-OPEN-DECISIONS.md` A5
- Seat management: add/revoke an employee seat against the license's seat limit,
  kept deliberately separate from `IPermissionService` (licensing is not authentication)
- Module/limit gating (if any packaging tiers exist — decisions B1, B2), enforced
  server-side, never only in the UI

**Gate:** a deployment activates, works normally, survives a simulated Activation
Service outage through its full grace period, and degrades predictably (not silently,
not catastrophically) if the outage outlasts it; a gated module returns a clean,
translated error, not a crash.

---

## M9 — Frontend completion
**Branch:** `feat/web-tier1-screens`

- All Tier-1 screens, both locales, both directions
- Chart of accounts TreeTable, financial statement views
- Document entry screens with keyboard-first data entry
- Server-side pagination/sorting/filtering everywhere
- Export to Excel/CSV/PDF, generated server-side
- Loading, empty, and error states on every async surface

**Gate:** every Tier-1 journey completable in both AR and EN; RTL verified on every screen.

---

## M10 — Hardening & pre-launch
**Branch:** `chore/pre-launch-hardening`

- Performance fixture (3 years, 200k lines) and report benchmarking
- Security review against `docs/09-SECURITY-RULES.md`; `docs/SECURITY.md` written
- Backup **restore actually performed**
- Alerting verified by triggering real alerts
- Rollback tested on staging
- Provisioning and deprovisioning runbooks executed end to end
- Full pre-first-customer checklist (`docs/12-OPS-AND-DEPLOYMENT.md` §10)

**Gate:** the entire checklist green, verified — not assumed.

---

## Ordering rules

- **M0 → M1 → M2 are strictly sequential.** Everything else depends on them.
- M4, M5, M6 have real dependencies (inventory before purchasing receipt posting;
  sales before compliance) — do not parallelise them into a half-integrated state.
- M7 depends on M6 existing, but the compliance **contract** can be designed earlier.
- **Do not start Tier 2 or Tier 3 anything.** Not "while we're here."

## If scope must be cut

Cut in this order, documenting every cut:
1. UI polish (keep it functional and bilingual)
2. Approval workflow depth → single threshold
3. Multi-currency → single currency per tenant at launch
4. Advanced reports → the core statements only

**Never cut:** tenant isolation · ledger integrity · money precision · audit trail ·
ZATCA correctness · backups. Those are the product.
