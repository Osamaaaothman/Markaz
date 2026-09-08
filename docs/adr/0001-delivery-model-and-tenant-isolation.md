# ADR-0001: SaaS delivery model with schema-per-tenant isolation

## Status
Accepted — 2026-09-09

## Context

The original planning document (`docs/Planning/claude-code-prompt-نظام-محاسبي.md`,
§1–§2) specified the product as **on-premise / single-tenant only**: a fully separate
instance deployed at each customer's own infrastructure, with no multi-tenant platform,
and called for a license-key/activation mechanism from day one to prevent unlicensed
copies from running.

`docs/01-OPEN-DECISIONS.md` (A1) was drafted assuming the opposite — a SaaS multi-tenant
platform — without that assumption having been confirmed by Osama, creating a direct
conflict between the "already decided" planning document and the working rules. This
was surfaced explicitly and Osama resolved it in `docs/00-PRODUCT-BRIEF.md` §2: the
product is **SaaS primary**, not on-premise-only.

## Decision

1. **Delivery model: SaaS primary.** We operate a multi-tenant platform: we run
   migrations, own backups/RPO/RTO, and custody tenant ZATCA cryptographic material.
2. **Tenant isolation: schema-per-tenant** on a shared PostgreSQL instance (Option A of
   the three considered in `docs/01-OPEN-DECISIONS.md` A1), with a shared `platform`
   schema holding the tenant registry, and per-tenant business schemas.
3. **Single-tenant on-premise remains deployable** from the same codebase via
   `DEPLOYMENT_MODE=saas | single_tenant` — an infrastructure/configuration switch, not
   a fork and not a second codebase. In single-tenant mode there is exactly one tenant
   row; every other mechanism (permissions, posting, numbering, audit) is identical.
4. **License-key/activation middleware is dropped** for the SaaS path; subscription and
   entitlements (Core `billing` module, Milestone 8) replace it as the gating mechanism.
   Whether a *sold* on-premise edition still needs a licensing/activation guard is not
   yet decided — tracked as an open sub-item under `docs/01-OPEN-DECISIONS.md` B3.

## Alternatives considered

- **On-premise / single-tenant only, no SaaS** (the original planning document's
  stated position). Rejected: superseded by Osama's explicit SaaS decision. Would have
  required license/activation infrastructure that is now unnecessary for the primary
  channel, and would have made scaling to hundreds of customers operationally heavy
  (Osama runs upgrades/backups per-install rather than centrally).
- **Shared schema + `tenant_id` column + Postgres Row-Level Security.** Cheaper at
  scale and simpler migrations, but one missing policy or one `BYPASSRLS` role leaks
  another company's ledger — unacceptable risk for a financial system of record at the
  hundreds-to-low-thousands-of-tenants scale this product targets.
- **Database-per-tenant.** Maximum isolation and closest match to true on-prem, but
  operationally heavy (connection/credential sprawl, migration fan-out) at SaaS scale
  for no isolation benefit over schema-per-tenant.

## Consequences

**Gets easier:**
- Per-tenant export, restore, and "delete a tenant" are schema-level operations —
  straightforward and safe.
- No risk of a forgotten `WHERE tenantId` leaking data across tenants, since the
  connection's `search_path` scopes every query.
- The on-premise story is "the same code, one schema" rather than a second codebase to
  maintain in parallel.

**Gets harder:**
- Migrations must run across N schemas (see `docs/03-MULTI-TENANCY-RULES.md` §6):
  the runner must be idempotent, resumable, and track per-tenant migration state.
- Connection pooling must not leak `search_path` between requests — this needs an
  explicit test (`docs/03-MULTI-TENANCY-RULES.md` §4), not just a code review.
- We now hold customers' ZATCA private keys and CSIDs (`docs/06-COMPLIANCE-PACK-RULES.md`
  §5) — a serious security and liability obligation that on-premise-only would not have
  created.
- Data residency (`docs/01-OPEN-DECISIONS.md` A2) becomes a real, immediate question
  rather than a hypothetical — Saudi PDPL and enterprise procurement will ask where the
  shared platform is hosted.

**Will regret at scale (watch for):**
- Schema-per-tenant gets operationally heavier past a few thousand tenants (more
  schemas to migrate, more connection/search-path bookkeeping). Acceptable at this
  product's realistic ceiling; would need revisiting if the customer count grows far
  beyond "hundreds to low thousands."
- If on-premise is ever actually sold as a distinct paid channel, the dropped
  license/activation mechanism may need to come back for that channel specifically —
  left open in `docs/01-OPEN-DECISIONS.md` B3 rather than assumed away.
