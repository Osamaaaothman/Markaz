# 01 — Open Decisions

**Nothing in this file may be implemented until it is decided.** If work is blocked on
one of these, say so and move to unblocked work. Do not guess and do not pick a default
silently.

When a decision is made: move it out of "Pending", record it in
`docs/00-PRODUCT-BRIEF.md`, and write an ADR in `docs/adr/`.

---

## A. Blocking — must be decided before the milestone that depends on it

### A1. Tenant isolation strategy — **SUPERSEDED, now moot**
**Decided 2026-09-09, reversed the same day.** The SaaS/schema-per-tenant decision
below was replaced within hours by Osama dropping SaaS entirely — see
`docs/adr/0001-delivery-model-and-tenant-isolation.md` (superseded) and
`docs/adr/0002-drop-saas-single-purchase-per-customer-deployment.md` (current).

**Current model:** every customer gets a fully isolated deployment (own database, own
backend). There is no shared platform and no schema-per-tenant mechanism — the
question this item asked no longer applies. Kept here, unedited below, only as the
historical record of what was considered and why it was reversed.

<details>
<summary>Original options considered (no longer relevant)</summary>

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

</details>

### A2. Data residency — **narrowed, still open for one hosting path**
**Blocks:** nothing structural now; matters only when a specific customer chooses
cloud hosting (`docs/00-PRODUCT-BRIEF.md` §2, hosting option 2).
**Question:** For a customer hosted on a cloud account (e.g. Railway) rather than
their own hardware, does *that customer* require in-Kingdom (Saudi) data residency?
**Why it matters:** Saudi **PDPL** governs personal data; some public-sector and
regulated buyers require in-Kingdom hosting. This is now a **per-customer sales
question** (does this specific buyer require it, and does the chosen provider offer a
Gulf/KSA region), not a single platform-wide infrastructure decision.
**Action required:** before offering cloud hosting to any customer who might care,
verify the current region offerings of the proposed provider (e.g. Railway) against
their own current documentation — do not assume from training data, it changes.
Customers who require in-Kingdom hosting and whose chosen provider can't offer it get
routed to the on-premise path instead.

### A3. Inventory valuation method
**Blocks:** Milestone 4 (Inventory) posting logic — does **not** block Milestone 2
(the accounting core engine is generic; it has no inventory-specific logic).
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

### A5. Activation Service parameters
**Blocks:** the licensing-equivalent of Milestone 8, and cannot be finalised before
that milestone, but the *shape* of the design is already decided (see
`docs/adr/0002-drop-saas-single-purchase-per-customer-deployment.md`): periodic
check-in with an offline grace period, master key per customer deployment, sub-key
per employee seat. **What's still open is the actual numbers and edge behavior:**
- Check-in interval (proposed: weekly) and offline grace period before a warning
  appears (proposed: 30 days) and before any functional lockout (proposed: longer
  still, or none at all — a full lockout of a live financial system is a serious
  support event and may not be worth the enforcement benefit).
- What a sub-key revocation actually restricts (can't log in vs. a visible admin
  warning) when an employee leaves and a seat is freed or reassigned.
- Whether license terms ever change post-purchase (e.g. an optional paid annual
  support/update subscription layered on top of the one-time purchase) — linked to
  B1 below, deliberately deferred with it.
**Recommendation:** favor generous grace periods and soft warnings over hard lockouts
— the commercial risk of over-enforcing against a paying customer's live accounting
system outweighs the piracy risk this system realistically faces at this stage.

---

## B. Pending — decide before the relevant milestone

### B1. Pricing and packaging model
Subscription per company / per user / per module / usage-based. Determines the
entitlements model in the billing module.

### B2. Plan tiers and feature gating
Which modules and limits belong to which plan. Needed before the entitlement checks
are written.

### B3. On-premise offering — **DECIDED**
On-premise (customer's own hardware) is one of two standard hosting paths offered to
every customer, alongside a customer-paid cloud account operated by Osama — see
`docs/00-PRODUCT-BRIEF.md` §2. Licensing applies identically to both paths via the
Activation Service (A5) — there is no separate "trust-only" on-prem edition.

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

1. Every customer gets a fully isolated deployment (own database, own backend) — no
   shared multi-tenant platform of any kind (`docs/adr/0002-...md`).
2. Each customer deployment can independently be on a different application version —
   there is no forced simultaneous upgrade across customers the way a SaaS platform
   would have. A deliberate rollout cadence per customer still needs designing (B9).
3. Base currency is configurable per company; SAR is the default for Saudi customers.
4. Fiscal year defaults to the Gregorian calendar year, configurable per company.
5. Tier 1 has no payroll, no fixed assets, no POS, no manufacturing.
6. Users belong to exactly one company deployment. Cross-deployment users (e.g. an
   accounting firm managing several clients' separate installs) are **not**
   supported in Tier 1 — if they are needed, say so now, because it changes the
   identity model.
7. Documents are numbered gapless per company, per document type, per fiscal year.
8. Reporting runs off the primary database in Tier 1; a read replica or reporting store
   is a later concern.
9. The local print/hardware agent is only installed on machines that actually need
   local device access — not on every employee's machine by default.
