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

### A3. Inventory valuation method — DECIDED (2026-09, weighted average)

Weighted average, company-wide (no per-tenant FIFO option built). The schema still keeps
`cost_layers` (one row per receipt, quantity_remaining unused by valuation today) so FIFO
remains addable later without a migration, per the "design the schema so both are possible"
rule this decision used to carry.

Implemented in `packages/core/src/inventory/weighted-average.util.ts` — per item+warehouse,
the only state kept is quantity and value (`item_warehouse_stock`), never a separately stored
rounded average; issuing the full remaining quantity takes the full remaining value rather than
`quantity × rounded average`, which is what keeps the Inventory control account balance exactly
equal to the sum of stock values (docs/05-ACCOUNTING-INTEGRITY-RULES.md §7), proven by a
300-iteration property test and a real-database integration test.

Posting rules (goods receipt, stock issue to a project, stock count gain/loss) and the "no
negative stock" rule were confirmed with Osama in chat; `GoodsReceiptService`,
`StockIssueService`, `StockCountService` in the same folder. Still open: the two stock-count
gain/loss accounts (`COUNT_GAIN`/`COUNT_LOSS` in `account_mappings`) need the accountant's
account codes before a real company can post a count — the keys exist, nothing is mapped to
them by default.

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

### B10. Cash flow statement method
**Blocks:** the fourth M2 report (trial balance, balance sheet, and income statement
are built; cash flow is not — `docs/14-MILESTONES.md` M2).
**Question:** direct or indirect method? This is an accounting-treatment choice, not a
code decision (CLAUDE.md §4: "Osama is not an accountant — guessing here produces
confidently wrong software").
**Action required:** confirm the method (with an accountant if needed) before this is
built.

### B11. Observability metrics library
**Blocks:** the "metrics" item of M3's observability scope (structured logging and
health endpoints are done; metrics is not).
**Question:** which metrics library/format (e.g. `prom-client` + a `/metrics`
Prometheus endpoint, or something else)? A new dependency, per CLAUDE.md §4.

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

---

## D. Accounting treatments built with a stated default (M5 purchasing)

These are **implemented**, but each is an accounting judgement made without an accountant. Every one
is marked `// REVIEW:` in code (`packages/core/src/purchasing/`) so it is isolated and cheap to change.
Confirm or change each before the first real customer posts a supplier invoice.

- **D1. Price variance.** When a supplier invoice price differs from the order price, the difference
  is booked to a *purchase price variance* account (mapping key `PURCHASE_PRICE_VARIANCE`) and stock
  keeps the order price. Alternative: re-cost the stock on hand. Needs the buyer to accept it per invoice.
- **D2. Input VAT.** Treated as fully recoverable: all VAT on a supplier invoice debits `VAT_INPUT`.
  Partially or non-recoverable input VAT is not modelled.
- **D3. VAT rounding.** Tax is rounded per invoice line to four decimals and summed. Some regimes
  round on the invoice total instead.
- **D4. Match tolerance.** None. Any quantity above received-and-not-yet-invoiced is refused; any price
  difference needs explicit acceptance. A percentage tolerance would be a setting.
- **D5. GRNI residue.** A receipt values each line at quantity x order price rounded to four decimals;
  an invoice clears quantity x order price rounded once. Many tiny partial receipts can leave a residue
  of at most 0.0001 per receipt line in GRNI. Not reconciled automatically yet.
- **D6. Tax codes.** The standard Saudi codes (VAT 15% standard, 0% zero-rated, exempt, out of scope)
  are offered by a button, never seeded silently. 15% matches ZATCA's published standard rate; the
  accountant confirms the code list before use.
- **D7. Approval segregation.** The user who creates a purchase order may also approve it. A rule
  "requester cannot approve" would block a one-person company, so it is not enforced.

**Known gaps, M5:** no debit notes or purchase returns; no supplier payments or AP ageing (arrive with the
payments work); purchase orders cannot be edited (cancel and re-issue); a retried receipt or invoice is not
replayed at document level (the ledger itself is protected by the idempotency key).

## E. Accounting treatments built with a stated default (M6 sales)

Marked `// REVIEW:` / documented in `packages/core/src/sales/`. Confirm before the first customer invoice.

- **E1. Revenue and cost recognised at invoice.** An invoice books revenue, output VAT and the receivable,
  and for stock lines the cost of goods sold at weighted-average cost, in one posting. There is no delivery
  note: the goods leave stock when the invoice is posted. A separate delivery step (revenue on delivery,
  stock out earlier) is a different design.
- **E2. Credit notes do not return stock.** A credit note reverses revenue, output VAT and the receivable
  only. A customer return to stock (and the COGS reversal that goes with it) is a separate document, not built.
- **E3. Output VAT.** Computed per line from the tax code and rounded to four decimals, like input VAT (D3).
  VAT on a credit note reverses on the credit note's own date.
- **E4. Revenue account.** One mapped default (`SALES_REVENUE`); a line may name its own postable account.
  A per-item or per-category revenue account is not modelled.
- **E5. Payment terms.** No terms table: the due date is entered per invoice and defaults to the invoice date.
- **E6. Price list.** Items carry no selling price; the price is typed on each line.

**Known gaps, M6:** no customer payments, statement or ageing yet (next slice); no invoice PDF or email yet; no
ZATCA e-invoicing fields (UUID, hash, QR) — that is the compliance pack, M7, and is blocked on decision A4.
