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

## M1 — Tenancy + identity foundation
**Branch:** `feat/tenancy-foundation`

- ADR: tenant isolation strategy (**blocked on decision A1**)
- `platform` schema: tenants, users, subscriptions, per-tenant migration state
- TenantContext via AsyncLocalStorage; tenant-bound Prisma client
- Authentication (tokens, refresh rotation, lockout), password hashing
- Permissions as data: roles, permissions, `IPermissionService`
- `IAuditLogger` with an append-only table and no UPDATE/DELETE grant
- **Tenant isolation test suite** (`docs/03-MULTI-TENANCY-RULES.md` §4)
- Tenant provisioning + deprovisioning pipeline, idempotent
- Migration runner across tenant schemas

**Gate:** two tenants provisioned; the full isolation suite green; a repository call
with no tenant context throws.

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

**Gate:** a job survives a worker crash and still completes exactly once; a PDF renders
correctly in Arabic RTL and English LTR.

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

## M8 — Subscription & entitlements
**Branch:** `feat/billing-entitlements`

- Plans, subscriptions, entitlements (blocked on decisions B1, B2)
- Module and limit gating enforced server-side, never only in the UI
- Suspension → read-only mode
- Trial and lifecycle states

**Gate:** a suspended tenant cannot write; a gated module returns a clean, translated
error, not a crash.

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
