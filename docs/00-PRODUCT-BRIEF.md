# 00 — Product Brief

Working summary of pinned product decisions. If this conflicts with a direct
instruction from Osama, **flag the conflict — do not silently pick one.**

---

## 1. What this is

A commercial **ERP-Lite / accounting system** sold to businesses in **Saudi Arabia**
first, then other Gulf markets (UAE, Oman later).

- **Not** an internal system for one company — it is a product with many customers.
- **General-purpose**, not industry-specific. Trade/distribution is the primary use
  case today; manufacturing and retail are future tiers.
- Serves **small, medium, and large** companies from one codebase — no separate
  edition per size.
- **Arabic and English from day one.** Full RTL and LTR. Not a later translation pass.

---

## 2. Delivery model — **one-time purchase, isolated deployment per customer**

> **Supersedes both the original planning document's bare "on-premise only" position
> and the short-lived SaaS decision.** See
> `docs/adr/0001-delivery-model-and-tenant-isolation.md` (superseded) and
> `docs/adr/0002-drop-saas-single-purchase-per-customer-deployment.md` (current).

- **Pricing:** one-time purchase, not subscription. Packaging/pricing detail is
  deferred — `docs/01-OPEN-DECISIONS.md` B1/B2.
- **Deployment:** every customer gets a **fully isolated instance** — own database,
  own backend, own ZATCA keys and onboarding, own everything. **There is no shared
  multi-tenant platform.** No `platform` schema, no schema-per-tenant, no cross-customer
  database of any kind. `docs/03-MULTI-TENANCY-RULES.md` reflects this — it is now
  almost entirely about the one exception (the Activation Service, §4 below), not
  about the customer-facing application.
- **Frontend stays a web app** (React + TypeScript + Vite + PrimeReact) — **not
  Electron.** The one genuine desktop-shaped need (printing to / talking to hardware
  attached to an employee's PC) is solved by a small **local print/hardware agent**
  installed on machines that need it, not by turning the whole application into a
  desktop app. See §8.
- **Hosting is a per-customer choice**, not one fixed answer:
  1. **Customer's own physical server** (true on-premise) — customer owns backup and
     maintenance; Osama installs and hands over.
  2. **A cloud account the customer pays for** (e.g. Railway), operated by Osama —
     the customer holds the bill/account, Osama holds admin access to deploy and
     maintain it. This access is logged and reasoned like any privileged access to a
     live customer system (`docs/09-SECURITY-RULES.md` §3), even though there is no
     shared platform underneath it.
  - The same Docker images and Compose bundle target both paths — see
    `docs/12-OPS-AND-DEPLOYMENT.md`.
- **Licensing/activation is back**, refined from the original plan — a central
  Activation Service (Osama's own infrastructure, separate from every customer
  deployment) issues a master license key per customer and a sub-key per employee
  seat. Validation is **periodic with a generous offline grace period** — a
  deployment must keep working normally through a temporary loss of connectivity to
  the Activation Service. Full design: §8 below and
  `docs/adr/0002-drop-saas-single-purchase-per-customer-deployment.md`.

**Do not build two codebases for the two hosting paths.** The isolation model is
identical either way; only where the containers run differs.

---

## 3. Architecture pattern

**Modular Monolith.** Not microservices. One deployable API, strong internal module
boundaries.

```
repo/                        ← ships to every customer deployment
├── apps/
│   ├── api/                 NestJS — composes all modules into one API
│   ├── web/                 React + TypeScript + Vite
│   └── print-agent/         Small local helper, installed per machine that needs
│                             printer/hardware access — talks to web app via localhost
├── packages/
│   ├── core/                Fixed platform — the five contracts live here
│   ├── modules/
│   │   ├── inventory/
│   │   ├── purchasing/
│   │   └── sales/
│   ├── compliance/
│   │   ├── contract/        The country-agnostic interface
│   │   └── zatca-sa/        Saudi implementation
│   ├── shared/              Money, dates, errors, result types, logging
│   └── db/                  Prisma schema, migrations, seeds
├── docker/
└── docs/

activation-service/           ← SEPARATE repo/deployment — Osama's own infrastructure,
                                not shipped to customers. Issues and validates license
                                keys; never holds customer business or financial data.
```

Rationale for monolith over microservices: a financial ledger needs **transactional
consistency across modules** (an invoice, its stock movement, and its journal entry
must commit together). Distributed transactions here buy nothing and cost correctness.

---

## 4. Core (fixed platform)

Note: since each customer has an isolated deployment (§2), "per tenant" below means
**per company/branch within that one customer's deployment** (a customer may run
several legal entities or branches on their single instance) — it is not a
cross-customer SaaS concept.

- Tree-structured **Chart of Accounts**, customisable per company
- **Posting engine** — automatic double-entry
- Multi-company / multi-branch, **multi-currency** with exchange rates
- Central **permissions** at screen and action level
- Configurable **approval workflows**
- Full **audit trail** on every create/update/delete
- Central, per-company configurable **document numbering**
- Core financial reports: **balance sheet, income statement, cash flow**
- *(additions required by the licensing model — see §8)* background job runner,
  notification service, license/activation client integration

---

## 5. The five integration contracts (mandatory for every module)

No module implements these itself. Ever.

1. `IAccountingEngine` — modules request a posting; they never write to the ledger
2. `IPermissionService` — same roles and users as Core
3. `INumberingService` — every document gets its number from the central generator
4. `IAuditLogger` — one mechanism for all audit records
5. **Unified reporting layer** — module data appears in the general financial reports,
   never in an isolated report

Details and the module checklist: `docs/02-ARCHITECTURE-RULES.md`.

---

## 6. Scope — Tier 1 only

### Inventory
- Internal purchase request from inventory staff, status: pending / processed / rejected
- Item ↔ warehouse binding, reorder point with automatic alert
- Receive purchase orders → update quantity → post journal entry (inventory increase)
- Inventory valuation — **PENDING DECISION** (FIFO vs weighted average). Design the
  schema so it supports both; see `docs/01-OPEN-DECISIONS.md`
- Stock count adjustments (physical vs book difference)

### Purchasing
- Receive purchase requests from Inventory
- Supplier and price selection, with multi-supplier comparison later
- Formal Purchase Order linked to supplier, item, price
- Optional approval path above a configurable amount
- On receipt: simplified **3-way matching** (PO ↔ receipt ↔ invoice) before final approval

### Sales & Accounts Receivable
- Customer request intake (manual for now) → **Quotation**
- Quotation → Sales Order → **formal Invoice**
- The invoice is part of the accounting cycle — **not a detached PDF**
- The invoice passes through the compliance pack (ZATCA) before it is final
- Email quotation/invoice as a **bilingual (AR/EN) PDF**
- Collections tracking, customer statement, **aging report**

### Compliance pack — ZATCA (Saudi Arabia)
See `docs/06-COMPLIANCE-PACK-RULES.md`. Mandatory in Tier 1.

### Tier 2 (not now)
Full accounts payable, payroll, fixed assets, POS, UAE/Oman compliance packs.

### Tier 3 (not now)
Manufacturing/BOM, budgeting and financial planning, advanced BI, external integrations.

---

## 7. Fixed tech stack — **do not propose alternatives**

| Layer | Choice |
|---|---|
| Backend | **NestJS** (TypeScript, `strict`) |
| ORM | **Prisma** |
| Database | **PostgreSQL** |
| Frontend | **React + TypeScript + Vite** |
| UI library | **PrimeReact** (RTL support, DataTable/TreeTable for CoA and statements) |
| State | **Zustand** (local UI state) + **TanStack Query** (server state) |
| Forms | React Hook Form + **Zod** |
| i18n | **i18next** |
| Backend validation | class-validator / class-transformer |
| Logging | **Pino** |
| Local dev deployment | **Docker Compose** (api + db + web) |

---

## 8. New components required by the single-purchase, per-customer model

These are **not** stack replacements — they are components this delivery model
requires that a plain single-company app would not. Each needs Osama's approval
before real design/build work starts (`docs/13-COLLABORATION-PROTOCOL.md`):

| Need | Why it is unavoidable | Proposed |
|---|---|---|
| Background job queue (inside each customer deployment) | ZATCA B2C reporting within 24h, retries with backoff, email sending, aging reports, month-end jobs. HTTP requests cannot own these. | **BullMQ + Redis**, per deployment |
| Local print/hardware agent | Browsers cannot reach a printer or device attached to an employee's PC; the app stays a web app instead of becoming Electron | Small local background service per machine that needs it, exposed over `localhost` — see `docs/02-ARCHITECTURE-RULES.md` |
| Central Activation Service (Osama's infrastructure, not part of any customer deployment) | Enforces the one-time-purchase license per customer and per seat, without making Osama's uptime a dependency for every customer's daily operation | Master key per customer deployment, sub-key per employee seat; periodic check-in with an offline grace period — **design detail (interval, grace length, lockout behavior) still to confirm, see `docs/01-OPEN-DECISIONS.md`** |
| Per-deployment rollout tooling | Every update/migration must be pushed to N separate customer deployments individually — there is no single shared database to migrate once | A documented, repeatable rollout runbook per customer — `docs/12-OPS-AND-DEPLOYMENT.md` |
| Observability (per deployment) | Support must be able to diagnose one customer's instance without any cross-customer data ever existing to confuse with | Structured logs + metrics, scoped to that single deployment |
| Data residency (only relevant for the cloud-hosting path) | If a customer's deployment runs on a cloud account rather than their own hardware, where that provider's region is may matter for Saudi PDPL / procurement | Decided **per customer at hosting-choice time** — see `docs/01-OPEN-DECISIONS.md` A2 |

---

## 9. Regional requirements that are easy to miss

Treat these as functional requirements, not polish:

- **Timezone:** `Asia/Riyadh` default per tenant; all timestamps stored in UTC,
  rendered in tenant timezone. Fiscal period boundaries use **tenant local time**.
- **Hijri calendar:** Saudi business documents commonly show both Gregorian and Hijri
  dates. Store Gregorian; render both. Do not compute Hijri by hand — use a library.
- **Arabic-Indic numerals** (٠١٢٣): a display preference, never a storage format.
- **Arabic is legally required on Saudi tax invoices.** The invoice PDF and the ZATCA
  XML must carry Arabic content, regardless of the user's UI language.
- **VAT:** standard rate, zero-rated, exempt, and out-of-scope are **different**
  treatments with different ledger and reporting consequences. Model them as distinct
  tax treatment codes, never as "rate = 0".
- **Currency:** SAR base for Saudi tenants, but multi-currency is Core. Every foreign
  currency transaction stores the amount, the currency, the rate used, **and the rate
  date** — the rate is snapshotted at transaction time, never re-derived later.
