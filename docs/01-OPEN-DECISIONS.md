# 01 — Open Decisions

**Nothing in this file may be implemented until it is decided.** If work is blocked on
one of these, say so and move to unblocked work. Do not guess and do not pick a default
silently.

When a decision is made: move it out of "Pending", record it in
`docs/00-PRODUCT-BRIEF.md`, and write an ADR in `docs/adr/`.

---

## A. Blocking — must be decided before the milestone that depends on it

### A1. Tenant isolation strategy
**Blocks:** Milestone 1 (nothing meaningful can be built before this)
**Options:**
- **A) Schema-per-tenant** (one Postgres schema per customer, shared instance)
  - Strong isolation, easy per-tenant backup/restore/export, easy on-prem parity,
    simple "delete a tenant" story, no risk of a forgotten `WHERE tenantId`
  - Migrations must run across N schemas; connection/search-path management needed;
    gets operationally heavy past a few thousand tenants
- **B) Shared schema + `tenant_id` column + Postgres Row-Level Security**
  - Simplest migrations, cheapest at scale
  - One missing policy or one `BYPASSRLS` role and you leak another company's ledger
- **C) Database-per-tenant**
  - Maximum isolation, matches on-prem exactly
  - Expensive and operationally heavy at SaaS scale

**Recommendation: A (schema-per-tenant).** For an ERP with a realistic ceiling of
hundreds-to-low-thousands of business customers, isolation and per-tenant
export/restore matter far more than the marginal ops cost — and it makes the
single-tenant on-prem build the same code with one schema.

### A2. Data residency
**Blocks:** infrastructure choices, and every enterprise sales conversation
**Question:** Must Saudi customer data stay inside Saudi Arabia?
**Why it matters:** Saudi **PDPL** governs personal data; some public-sector and
regulated buyers require in-Kingdom hosting. This determines the cloud region and
possibly the provider.
**Recommendation:** Assume **in-Kingdom hosting is required** unless verified
otherwise, and confirm the current PDPL cross-border transfer position against
official sources before committing.

### A3. Inventory valuation method
**Blocks:** Milestone 3 (Inventory) posting logic
**Options:** FIFO / weighted average / support both per tenant
**Rule for now:** design the schema so both are possible (cost layers preserved,
valuation method as tenant configuration). **Do not implement the posting logic until
this is decided** — the journal entries differ.

### A4. ZATCA integration path
**Blocks:** Milestone 6 (compliance)
**Question:** Direct integration with ZATCA Fatoora APIs, or through an approved
solution provider?
**Why it matters:** direct means we own onboarding, CSR generation, CSID lifecycle,
clearance/reporting APIs, and certification. A provider means a dependency and a cost
per tenant, but far less regulatory surface.
**Action required:** verify the **current** ZATCA requirements, wave thresholds, and
onboarding process against official ZATCA documentation before designing. Do not rely
on model memory or on the summary in the planning document — these change.

---

## B. Pending — decide before the relevant milestone

### B1. Pricing and packaging model
Subscription per company / per user / per module / usage-based. Determines the
entitlements model in the billing module.

### B2. Plan tiers and feature gating
Which modules and limits belong to which plan. Needed before the entitlement checks
are written.

### B3. On-premise offering
Will single-tenant on-prem actually be sold, or is SaaS the only channel? If it will be
sold, licensing/activation returns as a real requirement and the deployment abstraction
must be tested, not just designed.

### B4. Sales email intake
Does the system receive customer requests automatically (mailbox integration), or does
a salesperson copy them in manually? Currently manual.

### B5. Mobile app
Tier 1 or later? Currently assumed later; the API should stay client-agnostic either way.

### B6. Approval workflow depth
Single-step amount threshold, or full multi-step configurable engine? Tier 1 assumes
the simpler version.

### B7. Fiscal year and period configuration
Per-tenant fiscal year start, number of periods, and whether 13-period or adjustment
periods are needed.

### B8. Backup, RPO, and RTO targets
What recovery point and recovery time do we commit to customers? Drives the database
plan and the backup design.

### B9. Support and upgrade policy
Do all tenants sit on the same version? Is there a maintenance window? Can a tenant
defer an upgrade? Affects migration design significantly.

---

## C. Assumptions currently in force

These are **assumptions, not decisions.** They are written down so they can be
challenged. Every one of them must be confirmed by Osama.

1. Deployment is SaaS multi-tenant; single-tenant remains a configuration, not a fork.
2. Schema-per-tenant isolation (A1) is used until decided otherwise.
3. All tenants run the same application version.
4. Base currency is configurable per tenant; SAR is the default for Saudi tenants.
5. Fiscal year defaults to the Gregorian calendar year, configurable per tenant.
6. Tier 1 has no payroll, no fixed assets, no POS, no manufacturing.
7. Users belong to exactly one tenant. Cross-tenant users (accounting firms managing
   several clients) are **not** supported in Tier 1 — if they are needed, say so now,
   because it changes the identity model.
8. Documents are numbered gapless per tenant, per document type, per fiscal year.
9. Reporting runs off the primary database in Tier 1; a read replica or reporting store
   is a later concern.
