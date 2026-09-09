# 03 — Multi-Tenancy Rules

> **Superseded premise.** This file was originally written for a SaaS multi-tenant
> platform (schema-per-tenant, shared instance). That decision was reversed the same
> day it was made — see `docs/adr/0002-drop-saas-single-purchase-per-customer-deployment.md`.
> **Every customer now gets a fully isolated deployment: own database, own backend.**
> Most of the rules that used to live in this file are moot for the customer-facing
> application. They are kept below, marked historical, because the one real
> multi-tenant system left in this product — the central **Activation Service** — has
> to get the isolation question right too, and the same discipline applies at a
> smaller scale.

---

## 1. The customer-facing application: single company per deployment

Each customer's deployment has **exactly one** database, serving that one customer.
There is no tenant resolution step, no shared instance, no `platform` schema, and no
risk of a query crossing into another customer's data — because another customer's
data does not exist anywhere in that deployment's reach.

What this means concretely:
- No `TenantContext` / `AsyncLocalStorage` tenant-binding layer is needed for the
  customer-facing API. A "company" or "branch" concept still exists inside Core
  (`docs/00-PRODUCT-BRIEF.md` §4) for customers running multiple legal entities or
  branches on their one deployment — but that is ordinary application data scoping,
  not a security boundary between strangers, and does not need the isolation-test
  rigor of §4 below.
- No cross-customer isolation test suite is needed for the customer-facing API, since
  there is no cross-customer data path to test.
- Backups, migrations, and upgrades happen **per deployment**, not across a fleet in
  one operation — see `docs/12-OPS-AND-DEPLOYMENT.md`.

**What is *not* dropped:** ordinary tenant-shaped discipline that was always good
practice regardless of SaaS — no secrets in code, parameterised queries, pagination,
rate limits, audit logging — stays exactly as specified in
`docs/09-SECURITY-RULES.md` and `docs/07-API-RULES.md`.

---

## 2. The one real multi-tenant system: the Activation Service

The central Activation Service (`docs/00-PRODUCT-BRIEF.md` §8, ADR-0002) is
deliberately **not part of any customer's deployment** — it is Osama's own
infrastructure, and it is the one place in this product that legitimately holds
records for many customers in one place: license records, not business or financial
data.

Rules for it, adapted from the same reasoning that applied to the old SaaS platform,
scaled to what it actually holds:

- **It never stores customer business or financial data** — only what's needed to
  identify a deployment and validate its license: a deployment identifier, the master
  key, issued sub-keys (seat count and identifiers, not employee personal data beyond
  what's needed to label a seat), and check-in history.
- **A leak here is a licensing/business problem, not a "another company's ledger is
  exposed" problem** — it is real and must be taken seriously, but the blast radius is
  categorically smaller than what this file used to guard against. Do not
  over-engineer it to the same isolation bar as a shared financial database; do not
  under-engineer it either — it is still one company's confidential purchase relationship.
- **A deployment authenticates to the Activation Service using its master key** —
  never a customer-supplied identifier that could be guessed or spoofed to answer for
  another customer's license.
- **Every write is scoped to the deployment/master key making the request.** The same
  category of bug this file used to warn about — "a query built without the scoping
  key applied" — is still possible here at a smaller scale, and still needs a test:
  one deployment must not be able to read or affect another deployment's license
  record via the Activation Service's API.
- **Rate-limit and log every check-in and every activation attempt**, per deployment.
  Repeated failures from one deployment (a cracked/shared master key, a
  misconfigured customer) should be visible, not silent.

---

## 3. Historical reference — the original SaaS multi-tenancy design

Kept only because a future reversal or a hosted-offering reconsideration
(`docs/adr/0002-...md` "will regret at scale") might need to revisit it. **None of
this applies to the current customer-facing application.**

<details>
<summary>Original schema-per-tenant SaaS design (superseded)</summary>

The single boundary rule was: exactly one place in the codebase resolves the tenant
and binds the database connection to it —
`Request → Auth guard resolves tenant → TenantContext (AsyncLocalStorage) →
tenant-bound Prisma client → every repository call inherits it`. Isolation strategy
was schema-per-tenant on a shared PostgreSQL instance, with a shared `platform` schema
for the tenant registry. Hard prohibitions included: `tenantId` never taken from
client input, no raw SQL without tenant scoping, no global in-memory cache holding
tenant data, no sequential/guessable tenant identifiers. The mandatory test suite was:
two-tenant isolation test per read endpoint, direct-id cross-tenant access must 404
(never 403), a repository call with no tenant context must throw, a search-path leak
test across pooled connections, and a job-context test. Provisioning was a first-class
idempotent pipeline (create tenant row → create schema → migrate → seed → create admin
→ activate), with deprovisioning (suspend/export/hard-delete) designed at the same
time. Migrations ran per-tenant-schema via a resumable runner, expand/contract only.
Per-tenant configuration covered currency, fiscal year, numbering formats, tax
defaults, approval thresholds, valuation method, enabled modules, compliance pack —
all data, never a code branch. Noisy-neighbour concerns (per-tenant rate limits, job
queue fairness, query timeouts, mandatory pagination) applied because many customers
shared infrastructure.

</details>
