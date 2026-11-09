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

### A4. ZATCA integration path — DECIDED 2026-10-07: direct, no provider
Decided by Osama in chat; recorded with what was verified and what is still unverified in
`docs/adr/0004-zatca-direct-integration.md`. Still open inside this decision: the curve (P-256 vs
secp256k1), the sandbox API contract, the current wave schedule — all need the developer-portal
downloads listed in the ADR. The original question is kept below.

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
- Whether license terms ever change post-purchase — **decided with B1 (2026-10-21):**
  yes, an optional paid annual maintenance/support subscription on top of the one-time
  purchase. What that subscription actually gates (updates only? support SLA? both?)
  and how the Activation Service enforces its lapse are still open.
**Recommendation:** favor generous grace periods and soft warnings over hard lockouts
— the commercial risk of over-enforcing against a paying customer's live accounting
system outweighs the piracy risk this system realistically faces at this stage.

---

## B. Pending — decide before the relevant milestone

### B1. Pricing and packaging model — **DECIDED (2026-10-21)**
One-time purchase per customer deployment, with an **optional annual maintenance/support
subscription** layered on top (linked to A5's "whether license terms ever change
post-purchase" question — this is that change). No per-seat or usage-based billing within
the one-time-purchase price; seat limits are a packaging question (B2) independent of the
pricing model itself.

### B2. Plan tiers and feature gating
Which modules and limits belong to which plan. Needed before the entitlement checks
are written. Still open — B1 fixes *how* the system is sold (one-time + optional annual
maintenance), not *what's bundled* at each price point.

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

### B8. Backup, RPO, and RTO targets — **RPO decided (2026-10-21)**
**RPO: 1 hour maximum data loss.** Drives the backup design toward hourly (or continuous
WAL-archiving) backups rather than a daily snapshot — a daily-only backup cannot meet this
on its own. **RTO (how long a customer can stay down before service is restored) is still
open** — needs its own number before M10's "backup restore actually performed" gate can be
designed against a real target, not just performed once.

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
5. Tier 1 has no payroll, no fixed assets, no POS, no manufacturing. **Confirmed by Osama,
   2026-10-21:** this assumption stands — payroll (`packages/core/src/hr/`, GOSI, EOSB, the
   WPS wages file, payslips) was built because Osama asked for it directly, but it is a
   module **outside official Tier 1 scope**, not a redefinition of Tier 1. Treat it like any
   other built-but-not-baseline feature: it ships, it is tested to the same bar as everything
   else, but it is not implied by "Tier 1" in scope discussions and is not required for a
   Tier-1-only customer.
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
- **D8. Debit notes (2026-10-18).** Built as the exact AP mirror of the sales credit note (E2 below):
  free-typed lines against an expense account, posted as `Dr Accounts payable / Cr expense account /
  Cr Input VAT`, gated so debit notes against one invoice never exceed its gross. It never touches the
  purchase order's received/invoiced quantities, GRNI, or price variance — same choice E2 made for sales
  credit notes not re-touching stock. `packages/core/src/purchasing/supplier-invoice.service.ts`'s
  `createDebitNote`. Confirm before the first real debit note posts, same as D1-D7.

- **D9. Purchase returns.** Osama chose to build only the return of goods that were received and **not yet
  matched to a supplier invoice**. The posting reverses the receipt: GRNI is debited at the order price (what
  the receipt credited), Inventory is credited at the weighted-average cost actually taken out of stock, and
  any difference goes to `PURCHASE_PRICE_VARIANCE` (same account as D1). Without that last line GRNI would keep
  a residue no invoice can clear whenever the average cost has drifted from the order price. The returned
  quantity is no longer "received": it can be received again, and the order status follows the counters
  (a fully returned order goes back to APPROVED). **Not built, needs an accountant:** sending back goods that
  are already invoiced. The debit note of D8 does not cover it: it corrects only the amount owed and never
  moves stock, GRNI or price variance. That case needs a ruling on reversing input VAT and the price variance.
  Direct receipts with no purchase order cannot be returned yet.

**Known gaps, M5:** no return of goods that are already invoiced (D9; the debit notes of D8 correct only the
amount owed, they do not move stock); purchase orders cannot be edited (cancel and re-issue); a retried
receipt, invoice or return is not replayed at document level (the ledger itself is protected by the
idempotency key). Supplier payments and AP ageing are **done** — they are the generic
`packages/core/src/payments/` module shared with sales (`direction: "PAYMENT"` / `side: "SUPPLIER"`), not a
separate purchasing feature.

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

## F. Chart of accounts: delete and stop (2026-11-03)

Decided by Osama: an account **nothing points at** may be deleted for good; an account that is used is **never** deleted
and can only be **stopped**.

- **Used** means any of: a ledger line, an automatic-posting mapping, a supplier-invoice line, a sales-invoice line that names
  it as revenue account, a payment or salary advance that names it as cash account, a sub-account, or a linked party.
  `ChartOfAccountsService.usage` counts them; `delete` refuses with `ACCOUNT_IN_USE` (409) if any is non-zero.
- The database is the second wall: every foreign key to `accounts` is `ON DELETE RESTRICT` (the parent key was `SET NULL`
  and is now `RESTRICT`; the missing key on `sales_invoice_lines.revenue_account_id` was added `NOT VALID`, so old rows
  cannot block a deployment but every new row is enforced). `erp_app` now has `DELETE` on `accounts` and nothing else
  changed for other tables.
- **Stopping** an account (`isActive=false`) keeps its history and reports, blocks new postings, and hides it from pickers.
  Refused for: an account an automatic posting is mapped to, a folder with active sub-accounts, and (unless acknowledged)
  an account whose balance is not zero. Restarting needs an active parent.
- New permission `account:delete` (delete only); stop/restart uses `account:update`. Existing installations must run the
  seed again so the Admin role receives it: `npm run seed --workspace=@erp/db`.
- `// REVIEW:` the stopped/zero-balance rules are mine, not an accountant's. Confirm that stopping a folder or an account with
  a non-zero balance is acceptable, and whether a stopped account with a balance should block closing a period.
- Not done: the same "used? then no delete" rule for parties, items, warehouses, tax codes and employees. They have no
  delete today, only a stop flag with no check (question 3 of the plan).

## G. Salary advances: repayment and leavers (2026-11-03)

Decided by Osama: an employee who still owes a salary advance **cannot be settled or stopped** until the advance is repaid.

- **Repayment** (`SalaryAdvanceService.repay`, permission `salary_advance:repay`): the employee pays money back outside payroll.
  Posting: Dr the bank or cash account, Cr `SALARY_ADVANCES_RECEIVABLE`. Insert-only table `salary_advance_repayments`.
  Allowed for an employee who is no longer active.
- **Remaining balance** of an advance = amount − payroll deductions − repayments, computed in one place
  (`packages/core/src/hr/salary-advance-balance.ts`) and used by the lists, the payroll run and the checks.
- **Blocked:** `EndOfServiceService.settle` and a manual stop of an employee fail with `OUTSTANDING_ADVANCES` (409) while any
  balance remains. Reason: once an employee is inactive payroll stops recovering the advance, and the receivable would stay on
  the books for good.
- **Concurrency:** a repayment and a payroll run both take a per-employee advisory lock (`salary_advances` is insert-only for the
  application role, so `SELECT ... FOR UPDATE` is not available), and payroll now reads the advances inside its transaction.
  Before this, a repayment made while a run was being prepared could have been deducted a second time.
- `// REVIEW:` not built, and a question for an accountant and a lawyer: netting the balance against the end-of-service
  gratuity. A deduction from end-of-service dues has statutory limits.
- New permission `salary_advance:repay`. Existing installations must run the seed again:
  `npm run seed --workspace=@erp/db`.

## H. Purchase requests: a review step (2026-11-03)

Before this, a request became an order directly and "accepted" was implicit. Now a request is reviewed first.

- **Statuses:** `PENDING` (waiting for review) → `ACCEPTED` (a buyer may make an order) → `PROCESSED` (an order exists),
  or `REJECTED` (from `PENDING` or `ACCEPTED`, with a reason). Who accepted and when is stored (`accepted_by`, `accepted_at`).
- **An order can only be made from an `ACCEPTED` request** (`REQUEST_NOT_ACCEPTED`, 409). Requests that were already
  `PENDING` before this change appear on the review page; no data migration.
- **Permissions:** new `purchase_request:review` (accept). Reject stays `purchase_request:reject`. Create, review and
  approve are separate, so one person or three may hold them. Existing installations must run the seed again:
  `npm run seed --workspace=@erp/db`.
- **Queue badges** in the menu come from `GET /v1/purchasing/pending-counts`. Each number is returned only if the user may
  act on it. Review page = requests to review. Purchase orders = accepted requests still without an order + orders waiting
  for approval. The list refreshes after every request/order action and once a minute.
- Not built: the same person may create and accept a request (no segregation setting yet, same as D7); no notification to the
  requester (needs configured email).

## J. Employee accounts: a party and three ledger accounts per employee (2026-11-03)

Decided by Osama: every employee gets **three real accounts** in the chart of accounts, and a party (kind `EMPLOYEE`) they hang on.
Detailed choices below were made without an accountant and are marked `// REVIEW:` in the code.

- **The three accounts**, created under three parent *folders* (group accounts) chosen in the account mapping
  (`EMPLOYEE_ADVANCES_PARENT` asset, `EMPLOYEE_SALARY_PAYABLE_PARENT` liability, `EMPLOYEE_EOSB_PARENT` liability):
  1. advances owed **by** the employee; 2. salary owed **to** the employee; 3. end-of-service owed **to** the employee.
  Codes come from the chart's own numbering rule (`packages/core/src/accounting/account-code.ts`, a copy of the web
  `suggestNextCode`; keep the two in step). A per-company advisory lock stops two new employees getting one code.
- **Created with the employee**, in the same transaction: party + three accounts + the employee row, or nothing.
  If **none** of the three folders is mapped the employee is created without accounts and payroll keeps using the company-wide
  accounts (the earlier plan said to refuse; I chose to fall back so a company is not blocked from hiring on upgrade). If
  **some but not all** are mapped, creation is refused (`ACCOUNTS_PARENTS_INCOMPLETE`).
- **Posting:** a payroll run credits each employee's net pay to their own salary-payable account (employees without one share the
  company-wide `NET_PAY_PAYABLE` line); end-of-service accrual credits their own account.
- **Advances keep the account they were granted on** (`salary_advances.receivable_account_id`, null = company-wide). Repayments
  and payroll deductions credit that same account, so an advance never ends split between two accounts. Nothing already posted is
  moved when an employee is given accounts later: their earlier balances stay on the company-wide accounts (no opening entry).
- **Backfill:** `POST /v1/employees/:id/accounts` (button on the employee page) and `POST /v1/employees/accounts/provision-missing`
  (button on the employees list). Idempotent; one transaction per employee.
- An employee's account counts as "in use" for account delete protection (section F).
- The employee's bank IBAN stays employee data, not an account: the bank is the company's account.
- Questions for an accountant: whether net pay should sit per employee or in one account with the party as sub-ledger; whether
  the end-of-service gratuity should be accrued monthly per employee (today it is booked only at settlement); and the account names.
- Not built: paying salary and paying the gratuity through the Payments module against the new party (it needs a payment
  direction for employees). New migration `20261103120000_employee_accounts` (expand-only). No new permission; existing
  `employee:update` covers provisioning.

## I. After creating something, opening its details (2026-11-03)

- Done: a record that has a details screen **opens on it straight away, with the "saved successfully" message shown over it**
  (a toast in the app shell; `CreatedInfo.onOpen` in `CreatedDialog`). There is no extra button. Employee, purchase order, sales
  order and sales invoice open their page; journal entry and purchase request open their dialog. A quotation has no details
  screen, so it keeps the confirmation dialog.
- Known gap (not built): supplier invoice, payment/receipt, goods receipt, stock issue, stock count and goods return have no
  details screen and no `GET :id` endpoint (goods receipts and issues have no list either). Each needs a read endpoint, a page
  and tests, so it is its own piece of work. Their confirmation dialog still shows the saved fields.
- Not planned: master data (parties, items, warehouses, tax codes, accounts); the confirmation dialog already shows all their fields.

## K. Allowance types (2026-11-03)

Decided by Osama: allowances are a **table of types the company defines**, replacing the two fixed fields (housing, other).

- **Tables:** `allowance_types` (code, name in two languages, `isHousing`, `inGosiBase`, `inEosbBase`, active), `employee_allowances`
  (an amount per employee per type) and `payroll_run_line_allowances` (a copy of each allowance as it was on the run date, insert-only).
- **What the flags do:** GOSI is computed on basic salary + the allowances flagged `inGosiBase` (the 45,000 cap is unchanged);
  the end-of-service gratuity on basic salary + those flagged `inEosbBase`. `isHousing` marks the one type reported in the housing
  column of the WPS wages file and the payslip; every other allowance is reported as other earnings. The housing and other
  totals on a payroll line are still stored, so the WPS file, payslip and screens that show two numbers are unchanged.
- **Migration** `20261103130000_allowance_types` carries today's data over: for each company with employees it creates `HOUSING`
  (GOSI yes, end-of-service yes, housing column) and `OTHER` (GOSI no, end-of-service yes) and turns each employee's existing amounts
  into rows. This reproduces exactly today's rules (GOSI on basic + housing; end-of-service on basic + housing + other, Osama 18 Oct
  2026), so payroll and gratuity for existing data are unchanged. The old `employees.housing_allowance` / `other_allowances`
  columns stay (expand-only) but are no longer read or written.
- **Never silent:** the usual types (housing, transport, food, phone, nature of work, travel, cost of living) are added only when the
  user presses "Add the usual types". New types default to **not** in the GOSI base and **in** the end-of-service base.
  `// REVIEW:` whether each common allowance belongs in either base is for an accountant and a labour-law adviser; the company
  can change both flags per type, and a posted run keeps what it used.
- **Rules:** a type's code and housing marker never change; a type paid to an active employee cannot be stopped (`IN_USE`);
  a stopped type cannot be given to anyone new.
- New permissions `allowance_type:create` and `allowance_type:update` (listing needs `employee:read`). Existing installations must
  run the seed again: `npm run seed --workspace=@erp/db`.
- Not built: allowances that vary by month (a bonus in one run only), percentage-of-basic allowances, and per-type accounts or cost
  centres. All allowances still post to the one salary expense account.

## L. Details pages for documents (2026-11-03, continues section I)

- Done in this slice: supplier invoice / debit note (`GET /v1/supplier-invoices/:id`) and goods return (`GET /v1/goods-returns/:id`)
  each have a read endpoint and a details page: header facts, lines, the journal entry it posted (button, for anyone who may read
  entries), and links to the order. A supplier invoice also shows what is still owed (the same definition payments and ageing
  use), the payments set against it and the debit notes raised against it. A new invoice or return opens on its page with the
  "saved" message over it; the lists link to the page.
- Second slice: payment/receipt (`GET /v1/payments/:id`: bank account, the invoices it settled with links, what stayed on account)
  and stock count (`GET /v1/stock-counts/:id`: lines as counted against what the books said, the entry a posted count made, and a
  "post" button on a draft). A stock count stores no entry id of its own, so the page finds it through the lines it posted.
- Third slice: goods receipt and stock issue. They had no list either, so each now has a list page (`GET /v1/goods-receipts`,
  `GET /v1/stock-issues`, newest first, paged) and a details page (lines with the cost stored at posting, the entry it made, the
  supplier and order for a receipt, the cost centre for an issue). The menu entries now open these lists (read permission); the
  entry forms are reached from a button on the list. A new receipt or issue opens on its page with the "saved" message over it.
- With this slice every document that posts an entry has a details page. Not done: documents made inside a purchase-order receipt
  (the order's "receive" dialog still just closes), and the numbering prefix question below.
- Observed, not changed: goods returns, goods receipts, stock issues and stock counts are numbered `000001`, with no prefix
  (the numbering service creates their series without one, unlike purchase orders and invoices, which get `PO-2026-000001`).
  Changing it affects the format of numbers already issued, so it needs a decision.

## O. Reading the audit log (2026-11-03)

- New page "Audit log" (Settings) and `GET /v1/audit-log` (+ `/filters`), permission `audit_log:read`: who changed what and when, with the
  before and after of each change, filters by record type, user, action text and dates. Read-only; the table stays append-only for the
  application role.
- **Found while building it:** audit rows never recorded the company (`audit_log.company_id` was always null), so the log could not be
  read per tenant. The logger now records the actor's company. Older rows are not rewritten (the log is append-only): the reader shows
  a company its own rows plus older rows whose actor is one of its users, and never a row it cannot attribute.
- Existing installations must run the seed again to give the Admin role `audit_log:read`. New migration only adds an index.
- Not built: exporting the log, and showing a friendly name for the record (it shows the record type and its id).

## M. Paying salaries, social insurance and end-of-service (2026-11-03)

Payroll and end-of-service credited three debts (net salaries, social insurance, gratuity) and nothing ever paid them. Now:

- **Three payments** (`hr_payments`, API `/v1/hr-payments/...`, page "Pay salaries and dues"): pay a payroll run's salaries (all unpaid,
  or chosen employees), remit social insurance (partial allowed, never more than owed), pay an employee's gratuity (once).
- **Posting is the mirror of the original entry, so no new accounting treatment:** salaries Dr the account each net pay was credited to,
  GOSI Dr GOSI payable, gratuity Dr the account the gratuity was credited to; every one Cr the chosen bank or cash account.
- **Which account was credited** is now stored on each payroll line (`net_pay_account_id`) and settlement (`payable_account_id`), so the
  payment debits the same account. The migration backfilled existing rows exactly (an employee's own account only if the run's own entry
  credited it); everything else stays null and uses the company-wide mapping, as it was posted.
- **Guards:** a salary line and a settlement can be paid once (unique keys, plus an advisory lock so two clicks cannot both pay);
  social insurance owed = what the runs credited minus what was remitted; the payment date cannot precede the run or termination date;
  the bank must be an active postable asset account. Insert-only tables.
- New permissions `hr_payment:create` and `hr_payment:read`. Existing installations must run the seed again.
- Still not built: payment of advances to employees is a separate thing (advances already have grant and repayment); the settlement of
  a gratuity against an employee's advance (a legal question, section G).
- Found and not fixed here: a settlement with a **zero** entitlement fails with a 500 (it posts a zero-amount entry the engine refuses).
  Tracked as a separate task; the fix needs `journal_entry_id` to become nullable on settlements.

## P. First-run setup: roles, checklist, proposed account links (2026-11-03)

What a fresh install gets from the seed: the company, SAR, the permission catalog, an Admin role, the standard chart, the current fiscal year
and the first admin. It does **not** get account mappings, tax codes, a warehouse or allowance types (the last two kinds are added by a
button, never silently). New in this slice:

- **Preset roles** (Accountant, Purchasing, Warehouse, Sales, Human resources) are created by the seed only if no role of that name exists,
  so re-running the seed never undoes a company's own edits; a permission added in a later version does not reach an existing preset
  (grant it by hand). The permission sets are a starting point I chose, for the company to edit.
- **"First-run setup" page** (menu, second entry): a checklist in the order to do things, required steps vs optional, with progress
  (for example 9 of 19 accounts linked) and a link to each place. Counts only; no business data.
- **Proposed account links** on the same page. The seeded chart is mostly folders with no postable account inside, so most proposals read
  "create the account X inside folder Y and link it"; a few link an existing account (GRN payables 2110602, VAT input 1111701, service
  revenue 4110301) and the three employee keys use folders (1111201, 2111101, 2111102). Nothing is created or linked until a person
  ticks and confirms; creating accounts needs `account:create` as well as `account_mapping:update`.
  `// REVIEW:` every proposal is my reading of the chart's names, not an accounting ruling: have an accountant check them.
  No proposal on purpose for cost of goods sold, price variance, project issue expense, count loss/gain, GOSI employer expense and
  end-of-service expense: the chart has no obvious place for them and choosing one is an accounting decision.
- **Observed, not built:** the company record has no VAT registration number, commercial register number or address, and the printed
  invoices carry only the name and logo. A Saudi tax invoice needs the seller's VAT number and address, so this belongs to the
  compliance work (docs/06) and should be decided before the first real invoice.

## N. The employee's third account is "dues" (2026-11-03)

Decided by Osama: the third per-employee account is the employee's **dues** (what is owed to them besides salary), not an
"end-of-service" account. It is created as "Employee dues - <name>" / "مستحقات - <name>" under the third folder in the account mapping
(key `EMPLOYEE_EOSB_PARENT`, kept so nothing migrates; only its label changed). Today the end-of-service gratuity is posted to it, and
leave pay or bonuses can use it later. In the standard chart the folder "Employees Other Dues" (2111102) fits. Choosing it makes the
gratuity a **current** liability, whereas the chart's "End of Services - EOS" (2210201) is non-current: that is an accounting
choice for Osama's accountant. Accounts already created keep the name they were given.
## Q. End-of-service settlement with nothing owed (2026-11-03)

Decided by Osama: a settlement whose net entitlement is **0** (e.g. a resignation under two years of service) is recorded, ends the
employment (employee terminated and inactive) and writes the usual audit record, but **posts no journal entry**. Nothing is owed, so
there is no ledger event; the posting engine rejects zero-amount lines by design.

- **Schema:** `end_of_service_settlements.journal_entry_id` is nullable (migration `20261103150000_eosb_settlement_nullable_journal_entry`,
  expand-only; rollback in its header). A CHECK, `end_of_service_settlements_journal_entry_check`, allows a null entry only when
  `net_entitlement = 0`, so the database itself refuses a settlement that owes money without an accrual entry.
- **Contract:** `journalEntryId` in the settle response is `string | null`. The employee screen's confirmation shows
  "No entry — zero entitlement" instead of a link to the entry.
- **Readers must handle null:** anything that reads settlements and follows the entry must treat null as "nothing owed". The payable
  lists already select `netEntitlement > 0` (`HrPaymentService`, section M).
- **Follow-up (still open):** now that `feat/hr-payments` is merged, add the "no payable shown" assertion to
  `end-of-service.integration.spec.ts` — after a zero settlement, `HrPaymentService.payables` must not list it, and paying it must fail
  with `NOTHING_TO_PAY`. Not done as part of this merge.

## S. M7 ZATCA — Phase 1 data model (2026-11-04)

A4 (direct integration) was already decided; this is the schema-only first slice, built with Osama's explicit instruction to
build everything for real — no shortcuts anywhere in this integration — so every item below is a real, committed design choice,
not a placeholder. No network calls, no XML, no onboarding flow yet (that is Phase 2+); verified against the three official
ZATCA PDFs already in `docs/vendor/zatca/` (extracted with `pypdf`, since this machine has no `pdftoppm`/poppler) where this
phase touches spec detail.

- **Curve: secp256k1, not the Security Features Standard's stated "P-256".** Confirmed from THREE independent sources now:
  ZATCA's own Developer Portal SDK-download page (read live), the official SDK's own sample key file
  (`docs/vendor/zatca/sdk/Data/Certificates/ec-secp256k1-priv-key.pem`), and consistent third-party integration reports
  (`docs/adr/0004-zatca-direct-integration.md`). Settled — the CSR/key code in Phase 2 will use secp256k1.
- **First-invoice PIH — verified, and the original implementation was WRONG.** `EgsChainService.FIRST_INVOICE_PREVIOUS_HASH`
  is **not** base64 of the raw SHA-256("0") digest (this task's starting spec, and what the first commit of this file actually
  computed). Checked against the official SDK's `Data/PIH/pih.txt` (`zatca-einvoicing-sdk-238-R3.4.8`, 2026-11-04): the correct
  value is base64 of the digest's **hex-string** representation — hash, render as 64 lowercase hex characters, then base64
  *that text*. Fixed in the same commit, pinned with a golden-value test (`egs-chain.service.spec.ts`) against the SDK's literal
  value so a future refactor can never silently drift from it. **Open question this raises:** whether this same hex-then-base64
  double-encoding applies to the invoice hash used elsewhere (the XAdES signing input, the QR code's tag-6 "XML Hash") — the
  Security Standard's QR section states tag 6 is exactly 32 bytes, which is the *raw* digest, not this 44-byte double-encoded
  form, so at least two different hash representations exist depending on where in the spec a hash is carried. Resolve this
  explicitly per field in Phase 4, do not assume they all match the PIH's encoding.
- **National address lives on `Company` (seller) and `Party` (buyer), not per-`EgsUnit`.** The CSR's SAN `registeredAddress`
  is technically a property of the issuing EGS/branch in the official model, so a company with EGS units at genuinely different
  physical addresses is not modelled correctly yet. Chosen because Tier 1 targets single-branch SMEs (docs/00 §1) and the task's
  own Phase 1 breakdown scoped address to the taxpayer profile; cheap to add a per-EGS override later (nullable column,
  falls back to the company's address) without a breaking change. Flag if a real customer needs this before it is built.
- **Buyer fields are not snapshotted onto the invoice.** `Party.vatNumber`/address are read live at XML-generation time, the
  same way `SalesInvoice` already reads `customer.name` live today rather than copying it. The immutable legal record of what
  was actually sent is the generated `signedXml`/`clearedXml` on `ZatcaInvoiceRecord`, not a frozen copy of the party row.
- **Key custody:** `EgsCredential`'s `*Ciphertext` columns are AES-256-GCM, envelope-style (random IV + ciphertext + auth tag
  packed into one `Bytes` value), decrypted only in memory for a signing operation. The decryption key
  (`ZATCA_KEY_ENCRYPTION_KEY`) is a 32-byte base64 value in the environment, outside the database — this deployment has no KMS
  (docs/09-SECURITY-RULES.md §5). **Losing that env var makes every stored key and CSID permanently unrecoverable** — this
  belongs in the key/backup procedure the go-live report (Phase 8 deliverable) must spell out.
- **`EgsCredential` is a mutable 1:1 row per EGS unit**, not an append-only history table: CSIDs rotate in place as onboarding
  and renewal progress. History of who changed what and when comes from the audit log (`IAuditLogger`, not yet wired to this
  table — that lands with Phase 2's onboarding service, which is the first thing to actually call these tables through a use
  case rather than a raw Prisma call in a test).
- **The ICV/PIH chain primitive is built and proven under concurrency now**, ahead of Phase 5 (Submission), because it is the
  one piece of M7 that CLAUDE.md's invariant bar applies to immediately: two invoices must never receive the same ICV or PIH.
  `EgsChainService.peekNext`/`advance`, row-locked (`SELECT ... FOR UPDATE`), same discipline as `PrismaNumberingService`. Proven
  with a 20-way concurrent test (`egs-chain.integration.spec.ts`) — gapless, no duplicate ICV, no duplicate PIH, and the chain
  ties together when sorted back into order.
- **Migration `20261104130000_m7_zatca_schema`** (expand-only): seller/buyer address+VAT columns on `companies`/`parties`; new
  tables `egs_units`, `egs_credentials`, `egs_chain_states`, `zatca_invoice_records`. No column was removed or narrowed.
- **Not built in this slice:** any API endpoint, any UI, CSR/onboarding (Phase 2), XML/hash/signature/QR (Phase 3/4),
  submission (Phase 5). `EgsUnit` rows do not exist yet outside tests — nothing creates one through a real use case.
- **Known gap carried from section P:** the company record had no VAT/CR/address fields before this; they exist now but are
  still empty until Settings (or first-run setup) gets a screen to fill them in — not built in this slice.

## T. M7 ZATCA — Phase 3 invoice XML generation (2026-11-04)

`buildBareInvoiceXml` (`packages/compliance/zatca-sa/src/xml/invoice-xml-builder.ts`) builds the UBL 2.1 XML for all six
document types Tier 1 needs. Built and verified directly against the official SDK's own sample XML files
(`docs/vendor/zatca/sdk/Data/Samples`, `zatca-einvoicing-sdk-238-R3.4.8`), not from memory or the task spec's description —
every element's presence, order, and attribute decoration was read from a real sample before being coded, and 5 of the 6
samples are cross-checked by a dedicated test comparing top-level element order against the actual file on disk.

- **Scope split confirmed against the samples themselves:** the builder's output deliberately excludes `ext:UBLExtensions`,
  `cac:Signature`, and the QR `cac:AdditionalDocumentReference` — docs/06 §3's "remove before hashing" instruction actually
  describes the *reverse* operation (recovering the pre-signature document from an already-signed one to verify its hash).
  Phase 4 hashes this builder's bare output, signs it, and *adds* those three elements; it never has to remove anything.
- **A real bug caught by the SDK cross-check, fixed in the same commit:** the invoice line's tax category must be wrapped in
  `cac:ClassifiedTaxCategory`, not `cac:TaxCategory` (which is correct everywhere else — `AllowanceCharge` and
  `TaxSubtotal`). Caught by the "decorates TaxCategory..." test failing against the real sample structure, not noticed by
  inspection alone — exactly why the cross-check tests exist.
- **Two three-way attribute-decoration rules, easy to get backwards:** `cac:TaxCategory` (inside `AllowanceCharge` and
  `TaxSubtotal`) carries `schemeID="UN/ECE 5305" schemeAgencyID="6"` on its `ID` and `schemeID="UN/ECE 5153"
  schemeAgencyID="6"` on `TaxScheme/ID`; `cac:ClassifiedTaxCategory` (inside an `InvoiceLine`'s `Item`) carries neither.
- **Two `cac:TaxTotal` elements always, even when `DocumentCurrencyCode` == `TaxCurrencyCode`** (true for every Tier-1
  scenario): a minimal one with only the grand total, then a full one with `TaxSubtotal` per tax category. Every official
  sample does this regardless of whether the currencies actually differ — followed literally rather than theorised about.
- **`cac:Delivery` is independent of standard vs. simplified** — confirmed by `Simplified_Credit_Note.xml` carrying one
  while `Simplified_Invoice.xml` doesn't. The builder already treated it as purely "present if `actualDeliveryDate` is
  given," which turned out to be correct; a test that first assumed otherwise was the one that needed fixing, not the code.
- **`// REVIEW:` (not an accountant's ruling, a schema-compliance guess):** every invoice always emits one zero-amount
  `AllowanceCharge` per tax category, matching every sample, because Tier 1's `SalesInvoice` has no discount/charge model
  (section E6) to feed a real one. If ZATCA's schema actually *requires* this placeholder (rather than merely allowing it),
  this is correct by accident; confirm against the Schematron rules in `docs/vendor/zatca/sdk/Data/Rules` before trusting it
  for a real submission.
- **Amounts are always rendered to 2 decimal places**, hard-coded rather than looked up per currency (`Money.round(2)`) —
  correct for SAR, a known gap for any future 3dp currency (KWD/BHD) if ZATCA e-invoicing is ever needed outside SAR.
- **Not built:** hashing/signing/QR (Phase 4), self-billing/export/summary/nominal-supply/advance-payment scenarios (other
  `InvoiceTypeCode` name-attribute digits), anything wiring a real `SalesInvoice` into `ZatcaInvoiceInput` (Phase 5).

## U. M7 ZATCA — Phase 4 hashing, signing, QR (2026-11-04)

The task description itself calls this "the part most likely to break." Every structural piece and encoding below was
verified against the official SDK's own signed sample files and key/certificate pair (`docs/vendor/zatca/sdk`), by
decoding and recomputing ground truth directly — not from memory, not from the Security Features Standard's prose alone,
and in two places not even from this task's own starting assumptions.

- **New dependency: `xml-crypto`**, approved by Osama before installing (docs/09-SECURITY-RULES.md §8). XML
  canonicalization (C14N) is the one piece of this phase that cannot be hand-rolled safely — the subtlety that makes it
  risky (whitespace, attribute ordering, namespace-declaration inheritance across a removed subtree) is exactly the kind
  of thing that silently breaks a hash chain, which is precisely what happened to the first-invoice PIH in Phase 1.
  `xadesjs`/`xmldsigjs` (the only dedicated XAdES library) were considered and rejected — archived by their own
  maintainer in Aug 2025, too risky a foundation for a multi-year product. ECDSA signing itself needed no new dependency:
  `node:crypto` supports secp256k1 natively.
- **Decisive verification, not just argument:** canonicalizing and hashing the official SDK's own bare (Phase-4-elements-
  stripped) `Standard_Invoice.xml` and `Simplified_Invoice.xml` reproduces each one's own real `ds:Reference/DigestValue`
  exactly — the value ZATCA itself accepted when clearing that invoice (`invoice-hash.spec.ts`). This proves
  xml-crypto's inclusive **C14N 1.0** stands in correctly for the samples' declared C14N **1.1** (the two specs differ only
  in rebasing inherited `xml:base`/`xml:lang`/`xml:space` across a removed ancestor, which none of these documents use).
- **The QR TLV's tags 6 and 7 are UTF-8 TEXT of a base64 string, not raw bytes** — found by decoding two real samples'
  embedded QR codes byte-for-byte, which directly contradicts the Security Features Standard's own prose ("length of hash
  (SHA256) is 32 bytes" for tag 6). Empirical ground truth was trusted over the PDF text, and `qr.ts`'s golden-value
  tests reproduce both samples' real QR codes byte-for-byte as proof. Tag 8 (EC public key) and tag 9 (certificate
  signature, simplified only) ARE raw binary DER, confirmed the same way.
- **One underlying digest, three different encodings depending on where it is carried** (this is the resolution to the
  open question Phase 1 raised in section S):
  - `InvoiceHash.digest` — the raw 32 bytes, used by nothing directly.
  - `InvoiceHash.xmldsigBase64` = base64(raw digest) — `ds:Reference/DigestValue` and QR tag 6 (as text).
  - `InvoiceHash.zatcaHash` = base64(hex-string(raw digest)) — the PIH, and `xades:SignedProperties`/`CertDigest`.
  Tag 7 (the QR's "ECDSA signature") turned out to be literally the same base64 string as `ds:SignatureValue` — the
  signature is computed once, over the canonicalized `ds:SignedInfo`, and reused verbatim, not recomputed differently
  for the QR.
- **`xades:CertDigest` could not be cross-checked**: the official sample's own `CertDigest` value does not match SHA-256
  of its own embedded `ds:X509Certificate` — a sample-data inconsistency (likely assembled from two different example
  runs), not a bug in this code. `zatcaHashOf(cert.raw)` is the spec-correct computation; confirm against a real sandbox
  response once reachable, since this is the one field with no ground truth to verify against.
- **RESOLVED/EXTENDED (2026-11-10):** once a test-harness bug (below) let `validation.spec.ts`'s cross-check against
  every real sample in `docs/vendor/zatca/sdk/Data/Samples` actually run for the first time on a machine that has the
  SDK, every single signed sample — all six Tier-1 document types, no exceptions — failed `verifySignedInvoice` with
  `SIGNATURE_INVALID` and `SIGNED_PROPERTIES_DIGEST_MISMATCH`. Investigated, not guessed at: the canonical
  `ds:SignedInfo` and `xades:SignedProperties` our `xml-crypto`-based canonicalizer produces were independently
  hand-reconstructed byte-for-byte from the raw sample XML (manually normalizing self-closing tags and adding the
  inherited namespace declarations) and matched the library's output exactly — so the canonicalization itself is
  correct, not the bug. The SHA-256 of that correctly-canonicalized `SignedProperties` still does not equal what the
  sample's own `ds:Reference`/`DigestValue` claims. Conclusion: this is the same class of self-inconsistency as the
  `CertDigest` finding directly above, now confirmed on two more fields, uniformly across every sample in the
  directory — strong evidence these particular published files had their certificate/signature pairing altered for
  anonymized public release, not a live independently-verifiable signed set. `verifySignedInvoice` and the signing
  pipeline it mirrors (`xades-signature.ts`) are not shown to be wrong by this; `ALLOWED_SAMPLE_DEVIATIONS` in
  `validation.spec.ts` now documents both codes alongside `CERT_DIGEST_MISMATCH`. **Not fully closed:** this is strong
  circumstantial evidence, not a certainty — the one thing that would fully close it is a real sandbox submission
  (or an independent XAdES-SA validator run) confirming our OWN signed output is accepted, which is Phase 6/7's
  existing gap (`sdk-validator.spec.ts`, blocked on this machine by the installed SDK's own broken relative-path
  resolution — a separate, still-open issue, not investigated further here).
- **Unrelated test-harness bug found and fixed while investigating the above:** `generateTestCertificate`
  (`src/testing/fixtures.ts`) shelled out to `openssl req -new -x509` without controlling `OPENSSL_CONF`; this
  machine has a system-wide `OPENSSL_CONF` (set by an unrelated PostgreSQL/psqlODBC install) pointing at a path the
  Git-for-Windows `openssl` on `PATH` can't read, so every test needing a throwaway test certificate failed to even
  start — `xades-signature.spec.ts`, `validation.spec.ts`, `onboarding.service.spec.ts`,
  `invoice-submission.service.spec.ts` included. Fixed by clearing `OPENSSL_CONF` for that one subprocess call only
  (not a system/global change). The real onboarding code (`csr.ts`) was never affected — it already passes
  `-config <path>` explicitly on every real CSR call, which overrides `OPENSSL_CONF` regardless of the machine's
  setting. This is what let the sample cross-check above run at all on this machine for the first time.
- **`extractCertificateSignatureDer`** is a minimal, targeted DER/TLV reader for an X.509 certificate's fixed top-level
  shape (`SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }`) — not a general ASN.1 library, deliberately,
  since this only ever parses our own certificate (trusted input, not adversarial). Verified to extract the exact bytes
  the real sample's own QR tag 9 carries.
- **`signInvoiceXml`'s self-verification**: the signature it produces, once its own `ds:SignedInfo` is canonicalized the
  same way, verifies against its own certificate's public key — proven for both a standard and a simplified invoice
  (`xades-signature.spec.ts`), and the resulting document's top-level element order matches a real signed sample exactly.
- **Not built:** nothing in Phase 2 (onboarding) exists yet, so nothing generates a real EGS key/CSR — Phase 4's tests
  sign with the SDK's own sample key/certificate. Nothing wires a real `SalesInvoice`/`EgsCredential` into this pipeline
  yet (Phase 5). The encrypted-at-rest key material in `EgsCredential` is never touched by this phase — Phase 5 decrypts
  it just-in-time for a signing call, per `docs/SECURITY.md`.

## V. M7 ZATCA — Phase 5 submission (2026-11-05)

`InvoiceSubmissionService` (`packages/compliance/zatca-sa/src/submission/`) orchestrates one invoice's submission end to
end: reserve the EGS's next ICV/PIH, build and sign the XML (Phases 3/4), call ZATCA, persist the outcome. A thin BullMQ
wrapper (`apps/api/src/compliance/zatca-submission.job.ts`) adapts it to a job, mirroring `notification.job.ts`'s shape.

- **The chain lock is never held across the network call.** docs/02-ARCHITECTURE-RULES.md §5 forbids calling external
  HTTP from inside a DB transaction; docs/06-COMPLIANCE-PACK-RULES.md §4 offers the way out the task spec itself
  suggested — "a per-EGS BullMQ queue with concurrency 1" — instead of a Postgres row lock held for the whole call.
  `createMonitoredWorker` gained an optional `workerOptions` parameter so `{ concurrency: 1 }` can be set per EGS queue
  (`zatcaSubmissionQueueName(egsUnitId)`); `EgsChainService.peekNext`'s row lock is held only for the instant it takes
  to read-and-reserve, same as before, never across the call.
- **Three-way outcome classification, not two.** A transient failure (network/5xx/429) is `PENDING_RETRY` — the ICV is
  NOT consumed, a retry reuses the exact same `ZatcaInvoiceRecord` and chain position (verified:
  `invoice-submission.service.spec.ts` "does NOT consume the ICV on a transient failure..."). A genuine business
  rejection (ZATCA actually evaluated the invoice and said no) is `REJECTED` — the ICV IS consumed, per docs/06 §7 ("a
  correction is a new document, not a resubmission under the same UUID/ICV"), and resubmitting after that throws
  `AlreadySubmittedError`. **A third case the original design missed:** an auth failure (401/403) is neither — it is
  our own credential/config problem, not ZATCA's judgement on this invoice, so burning the ICV over it would be wrong.
  Reclassified to `PACK_UNAVAILABLE` (an existing `ComplianceOutcome` kind that fit this exactly) before writing any
  test for it, not after a test caught it — the kind of thing worth getting right by inspection, not by accident.
- **Idempotent retry by construction**: `submit()` checks for an existing `ZatcaInvoiceRecord` by `salesInvoiceId`
  first. A definitive outcome refuses a second call outright; `SUBMITTING`/`FAILED_RETRYABLE` resumes at the SAME
  stored `icv`/`previousInvoiceHash` (no new chain reservation) and re-signs (a fresh ECDSA signature — signatures are
  not required to be byte-identical across attempts, only valid) rather than minting a new document.
- **Credentials and key material never cross the job payload.** `ZatcaSubmissionJobData` carries only
  `salesInvoiceId`/`egsUnitId`; a `ZatcaSubmissionParamsLoader` (not implemented — see below) is responsible for
  decrypting `EgsCredential` fresh inside the job, never storing a decrypted secret in Redis (docs/09-SECURITY-RULES.md
  §5).
- **New dependency: none.** `node:fetch` (built into Node 18+) is the HTTP client; no package was added for Phase 5.
- **Still blocked — the actual integration point**: nothing maps a real `SalesInvoice` onto `ZatcaInvoiceInput`,
  decrypts a real `EgsCredential`, or decides which `EgsUnit` an invoice belongs to (`SalesInvoice` has no such field
  today). This needs Phase 2 (a real `EgsCredential` to decrypt) and a product decision this repo has not made — not
  guessed at here, per CLAUDE.md §4. `apps/api`'s per-EGS worker is not registered in `worker.ts` either — there is no
  list of real `EgsUnit`s yet to enumerate.
- **The HTTP contract itself is still `// REVIEW:`** — endpoints (`/invoices/clearance/single`,
  `/invoices/reporting/single`), headers (`Accept-Version: V2`, `Clearance-Status: 1`), and the request/response JSON
  shape come from this task's own brief plus multiple consistent third-party integration write-ups, not ZATCA's own
  Integration Sandbox swagger (still unreachable by this tool — ADR-0004 flagged this as needed from Osama's browser
  back in Phase 1, still not resolved). Confirm before any real sandbox call.

## W. M7 ZATCA — Phase 2 onboarding (2026-11-05)

`OnboardingService` (`packages/compliance/zatca-sa/src/onboarding/`) drives the full CSR → compliance CSID →
compliance checks → production CSID lifecycle, plus CSID renewal.

- **New dependency: the `openssl` CLI, shelled out to, not a new npm package.** Node has no built-in PKCS#10 CSR
  generator. `csr.ts` calls `openssl ecparam`/`openssl req` via `execFileSync` with array arguments only — never a
  shell string, so there is no injection surface even though CSR field values (company name, address) ultimately
  come from tenant data. Added `openssl` to `apps/api/Dockerfile`'s runtime stage (bookworm-slim links `libssl` into
  Node itself but does not install the standalone CLI tool). No new JS dependency — a decision Osama did not need to
  approve since nothing was added to `package.json`, but flagged here since it is still a new infrastructure
  component per CLAUDE.md §4.
- **CSR field sourcing, cross-checked against three sources, not one.** The task brief, the SDK's own
  `Data/Input/csr-config-*.properties` samples, and a Microsoft Dynamics 365 onboarding guide's worked example all
  agree on the field list and OIDs, with one exception: the Security Standard PDF's own "CSR Subject field content"
  table appears to map both the invoice-type digits and the industry/business-category to OID 2.5.4.15, which is
  almost certainly a transcription artifact in that PDF (two different fields cannot share one OID in a single
  certificate extension). Went with the SDK-and-reference-implementation-corroborated mapping instead: `title`
  (2.5.4.12) for invoice type digits, `businessCategory` (2.5.4.15) for industry.
- **`SN` in the SAN is OpenSSL's "surname" shortname (2.5.4.4), not literal X.520 "serialNumber" (2.5.4.5).** OpenSSL
  has no `serialNumber` shortname in its default config; every real-world ZATCA CSR implementation found uses `SN`
  for the EGS serial by convention. Documented, not silently "corrected" to a technically purer OID with no evidence
  ZATCA's own validator expects it.
  **The CN field is free text**, not a fixed format — confirmed directly from the Security Standard PDF's own RDN
  table, which lists no required structure for it (unlike every other field, which the standard pins down exactly).
- **`// REVIEW:` — CSID renewal's auth is the least-confirmed call in this package.** `PATCH /production/csids`
  sends both the current production CSID as `Authorization: Basic` AND a new OTP as a header. This task's brief says
  only "PATCH with a new OTP"; no reference implementation specific to renewal (as opposed to initial compliance/
  production CSID issuance, which two independent sources corroborate) was found. Flagged inline at the call site
  and here rather than guessed at silently — confirm against the real sandbox, or ask ZATCA support, before this
  path is ever exercised against production.
- **Encryption, not a new scheme**: Phase 2 reuses Phase 1's `key-encryption.ts` envelope encryption unchanged (only
  widened its parameter types from `Buffer` to `Uint8Array` so a Prisma-read ciphertext needs no caller-side cast).
  The private key never leaves the service as plaintext except transiently in memory to build the CSR and to sign
  compliance-check sample documents.
- **`runComplianceCheck` never treats a ZATCA rejection as a pass.** Throws `OnboardingError("COMPLIANCE_CHECK_FAILED")`
  on any non-empty `errorMessages` or a `NOT_CLEARED`/`NOT_REPORTED` status; `markComplianceChecksPassed` is a
  separate, explicit, caller-driven step — this service does not itself track which of the required sample document
  types were actually exercised (listed as a known gap in the package README, not silently assumed complete).
- **Still blocked**: no API endpoint or UI captures an OTP or triggers onboarding yet (Phase 7); nothing enforces
  that all required compliance-check sample types ran before `requestProductionCsid` is called.

## X. Real ZATCA sandbox smoke test — RESOLVED: real compliance CSID issued end to end (2026-11-05)

Before starting Phase 6, Osama approved (relayed via the peer session) running a real onboarding call against ZATCA's
actual sandbox (`https://gw-fatoora.zatca.gov.sa`, OTP `123345`, confirmed reachable). This is the first real network
contact this package has ever made with ZATCA — everything before this was against a scripted mock
(docs/06-COMPLIANCE-PACK-RULES.md §6 still holds for the committed test suite; every real-network step below used a
manual, uncommitted, immediately-deleted smoke-test file, never part of the repo).

**End state: our own code, calling the real sandbox, now succeeds.** `generateKeyAndCsr` + `ZatcaOnboardingApiClient
.requestComplianceCsid("123345", csrBase64, "en")` against `ZATCA_BASE_URL.sandbox` (`.../e-invoicing/developer-portal`
— **unchanged, correct, never actually broken**) returned a real `200`, `"dispositionMessage":"ISSUED"`, with a real
`binarySecurityToken` and `secret`. This took three real findings to get to, two of them genuine code bugs (now fixed
and covered by tests) and one a mistake in this investigation's own debugging, caught and corrected before it could
cause a wrong "fix":

1. **Two real CSR structure bugs**, found by decompiling the official SDK's own CSR generator
   (`com.zatca.sdk.service.CsrGenerationService` inside `docs/vendor/zatca/sdk/Apps/zatca-einvoicing-sdk-238-R3.4.8.jar`
   — this machine has a working JRE 23, so the jar actually runs, despite the readme saying Java 11–15) and, for
   confirmation, actually running that jar (`java -jar ... -csr -csrConfig Data/Input/csr-config-example-EN.properties
   -pem`, with the `SDK_CONFIG` env var pointed at `Configuration/config.json` to work around a hardcoded-absolute-path
   NPE in the jar's own config loader) to produce a real reference CSR and diff it byte-for-byte (`openssl asn1parse`)
   against ours:
   - The `certificateTemplateName` extension (OID `1.3.6.1.4.1.311.20.2`) must be **UTF8String**, not
     PrintableString. First guess from the decompiled bytecode (`DisplayText(2, templateName)`) was BMPString —
     **wrong**, from assuming `DisplayText`'s `int` constant ordering (IA5/BMP/UTF8/VISIBLE) from memory instead of
     reading it; `DisplayText.class`'s own `ConstantValue` attributes show `CONTENT_TYPE_UTF8STRING = 2`. Caught by
     diffing against the real jar's output rather than trusting the first guess.
   - **Drop `basicConstraints` and `keyUsage`** from the CSR's requested extensions entirely. They looked like
     reasonable defaults for a code-signing CSR, but the official generator's `Requested Extensions` attribute
     contains exactly two extensions — `certificateTemplateName` and `subjectAltName` — nothing else.
   - `csr.ts`'s output is now byte-for-byte structurally identical to the official generator's own output: same DN
     string types (`PrintableString` for `C`, `UTF8String` for `OU`/`O`/`CN`), same two extensions, same OIDs
     throughout (including the SAN's `SN`=surname=2.5.4.4, which this package's own earlier `// REVIEW:` had flagged
     as an unconfirmed convention — now confirmed directly from the official generator's own bytecode: it uses
     `RFC4519Style.sn`, the exact same OID). `csr.spec.ts` updated to assert the UTF8String encoding on the raw DER
     bytes (openssl's `-text` dump renders the extension's 2-byte tag/length prefix as dots ahead of the plain text,
     which looks confusingly like an interleaved-null BMPString at a glance — asserting on raw bytes avoids that trap).
2. **This investigation's own mistake, caught before it caused a wrong fix**: after the two real bugs above were
   fixed, repeated calls to `.../e-invoicing/simulation/compliance` still returned `{"errorCategory":"Invalid-CSR"}`
   — and, suspiciously, returned the *identical* error for a deliberately garbage, non-CSR body too. That pointed
   investigation at "it must be an account/OTP problem, not CSR content" — a reasonable-sounding but **wrong**
   conclusion. The peer session had Osama pull ZATCA's own live Swagger doc for this endpoint directly from the
   authenticated sandbox portal, which gave an official example CSR request. Submitting that exact official sample
   to `.../e-invoicing/developer-portal/compliance` (the ORIGINAL URL this file already had for `"sandbox"` — the
   one earlier abandoned, mid-investigation, in favor of `/simulation` on the strength of one unconfirmed third-party
   forum post) returned `200`/`"ISSUED"` immediately. **`/developer-portal` was correct all along; `/simulation` was
   never the right endpoint for this call.** `ZATCA_BASE_URL.sandbox` needed no code change — the real lesson is
   procedural: a plain-text `"Invalid Request"` from `/developer-portal` against a garbage body (seen early in this
   investigation) was wrongly read as "this whole path is a dead end," when it was actually just that endpoint's
   (less informative) way of rejecting a malformed body, same as `/simulation`'s JSON error was for the same body.
   Re-running our own freshly generated CSR (fix 1 above, our own code, a fresh key) against `/developer-portal`
   confirmed the full, final result: a real compliance CSID, issued by ZATCA's actual sandbox, from this package's
   own code, unmodified in its URL mapping.

**Net effect**: two real, necessary code fixes landed (commit `951d4e1`); `ZATCA_BASE_URL` needed no change. 10 real
calls were made in total across this investigation — finding and fixing two genuine structural bugs, and both
confirming and then correcting one wrong turn in the investigation itself, is a reasonable amount of live-sandbox
cost for the first-ever confirmed real network success this package has had. `onboarding-api-client.ts`'s `// REVIEW:`
on the compliance-CSID call's endpoint/headers/body shape can now be considered **confirmed** for `requestComplianceCsid`
specifically (not yet for `submitComplianceInvoice`/`requestProductionCsid`/`renewProductionCsid`, none of which have
been exercised against the real sandbox yet).

## Y. M7 ZATCA — Phase 6 local validation (2026-11-06)

Written in a cloud session that **could not reach ZATCA** (the network policy returns 403 for every ZATCA host) and has **no
copy of the official SDK** (`docs/vendor/` is git-ignored). So this phase is built from what the repository itself can prove,
and says plainly what it cannot.

- **Found and fixed first: the pack's own tests failed anywhere without the SDK.** `describe.skip` still runs its callback,
  and four suites read SDK files while registering, so on any cloud checkout or CI runner they crashed instead of skipping --
  CI on this branch was red. `src/testing/fixtures.ts` now provides `describeIfSdk` (body not executed, the skip is reported
  by name with the missing path) and `generateTestCertificate()` (a throw-away secp256k1 key + self-signed certificate made
  with `openssl`), so signing, submission and onboarding orchestration run everywhere. The byte-for-byte comparisons against
  the SDK samples still run, unchanged, wherever the SDK exists.
- **`src/validation/invoice-consistency.ts` -- `checkInvoiceConsistency(xml)`.** Offline checks of a bare or signed document:
  the EN 16931 arithmetic rules ZATCA's schema builds on (BR-CO-10, -13, -14, -15, -16, -17) in exact integer hundredths, the
  per-category tax breakdown against the lines, header facts (UUID, ICV, PIH shape, issue date/time, type code and `name`
  flags, billing reference + reason on credit/debit notes, buyer on a standard invoice, seller VAT is 15 digits), currency
  consistency. **It is not ZATCA's validation:** the XSD and Schematron live in the SDK (`Data/Rules`) and are not
  re-implemented. A `valid` report is never evidence of acceptance (docs/06 §7).
  - `// REVIEW:` the per-line "tax ~ rate x net" and "net ~ quantity x price" checks are warnings with a 0.01 tolerance (the
    exact per-line rounding rule was not confirmed); "VAT number starts and ends with 3" is a warning, remembered not re-read.
- **`src/validation/signed-invoice-verifier.ts` -- `verifySignedInvoice(xml)`.** Recomputes the invoice hash with the three
  uncovered elements stripped, verifies the signature over the canonicalized `SignedInfo` with the embedded certificate,
  checks the SignedProperties and certificate digests, and decodes the QR: required tags present (9 only for simplified) and
  **every QR value equal to the same fact in the XML**.
- **Wired into submission (`InvoiceSubmissionService`).** Both checks now run before anything is sent. A failure writes the
  reasons onto the `ZatcaInvoiceRecord` (`FAILED_RETRYABLE`, `validationErrors`, `attempts` untouched -- ZATCA was never
  called), throws `InvoiceValidationError`, and leaves the chain position reserved but unconsumed, so a fixed resubmission
  reuses the same ICV. The BullMQ wrapper turns it into `UnrecoverableError` (retrying the same data cannot succeed).
  Tests: nothing is sent, chain untouched, resubmission reuses the ICV; a QR that disagrees with the document is refused.
- **`src/validation/sdk-validator.ts` -- `runSdkValidation`.** Runs the SDK's own `-validate` (dev/test only, never in a
  customer deployment). **Not run, and partly guessed:** the flags (`-validate -invoice <file>`) and the verdict line
  (`GLOBAL VALIDATION RESULT = PASSED|FAILED`) are from the SDK's documented command line, not observed. An unrecognised
  output is `UNKNOWN`, never a pass. `sdk-validator.spec.ts` (gated on the SDK) first checks the harness against the SDK's
  own sample, then validates our signed output. **First run on a machine with the SDK may need the verdict pattern
  adjusted -- read the printed output; do not loosen the test.**
- **Not done / not provable here:** the official Schematron and XSD rules (SDK not available); the gated "agrees with the SDK
  sample documents" suite in `validation.spec.ts` has not been run (it allows only the known `CERT_DIGEST_MISMATCH` sample
  inconsistency from section U -- any other disagreement is a validator bug or a finding about the samples).

## Z. M7 ZATCA — Phase 7 admin API/UI, and what still blocks a real invoice from ever reaching ZATCA (2026-11-08)

Phase 7 (`apps/api/src/compliance/compliance-admin.service.ts` + controller/DTO/module, `apps/web/src/features/compliance/`)
gives a company a screen to fill its seller profile, create an EGS unit, run it through onboarding (CSR → compliance CSID →
compliance checks → production CSID → renewal), and see a sales invoice's ZATCA status once one exists. Covered by a
real-database integration suite (8 tests) and manually verified in a real browser against the real API — see the Phase 7b
commit for what that testing found and fixed (a real data-wipe bug in `updateSellerProfile`, a silent-failure gap in the
onboarding dialog, and a broken XML-download auth path).

**What Phase 7 does NOT do, and nothing in this repo does yet: make a real sales invoice actually reach ZATCA.**
`zatca-submission.job.ts` is a complete, tested *seam* — nothing calls it. The gap is the same one Phase 5 (section V) and
the HANDOFF document already named; restated here as the formal "known gaps" section both of them pointed at, with each
item re-checked against the schema as it stands today rather than copied forward unverified:

- **Which `EgsUnit` issued a given `SalesInvoice`.** No field exists for it. A single-EGS company could default to "the
  company's only active unit," but a multi-branch company needs a real choice — this is a product decision, not a guess
  (CLAUDE.md §4).
- **Standard vs. simplified invoice.** ZATCA treats these as genuinely different documents (different `InvoiceTypeCode`
  name-attribute digits, different QR/signing requirements for simplified only). Nothing in this codebase decides which one
  a given `SalesInvoice` is. Proposed rule carried over from the original task brief, never confirmed: a customer with a VAT
  number on file is a standard (B2B) invoice, one without is simplified (B2C) — this needs Osama's sign-off, not silent
  adoption, since it is the rule that decides a legal document's structure.
- **Tax exemption reason code.** The XML builder itself already supports this correctly — `buildBareInvoiceXml` refuses a
  Z/E line with no `exemptionReasonCode`/`exemptionReason` (Phase 3, `invoice-xml-builder.ts`). What is actually missing is
  the source: `TaxCode.treatment` is `STANDARD | ZERO_RATED | EXEMPT | OUT_OF_SCOPE` with no reason-code column, so nothing
  maps a real company's zero-rated/exempt tax code to the specific ZATCA-coded reason (e.g. which exemption clause) it
  needs. Inventing a default reason would be a tax-law guess (CLAUDE.md §4 — likely needs the accountant, not just Osama).
- **Item unit of measure.** `Item.unit` is free text today; ZATCA's schema wants a UN/ECE Recommendation 20 unit code
  (e.g. `PCE`, `KGM`). No mapping exists from the free-text values already on real items to a code list.
- **`SalesInvoice.invoiceDate` has no time component** (`@db.Date`). ZATCA's issue-date/time pair is part of the hash input
  and the clearance deadline calculation; a real submission needs a real timestamp, not a date defaulted to midnight.
- **Payment means code.** Not captured anywhere on a sales invoice today; ZATCA's schema expects one (cash, credit transfer,
  etc. — UNCL4461).
- **Corrected from the Phase 7a hand-off note that first listed this gap list:** "sales has no debit note" is no longer
  true — section R (2026-11-04) built it as a real AR feature, and it is usable as one of the required ZATCA compliance
  samples once Phase 7's sample-submission step needs one. The rest of this list still stands as written.

None of this blocks Phase 7's admin screens, which only need a seller profile, an EGS unit, and a sandbox OTP to exercise —
none of it reads or writes a real `SalesInvoice`. It blocks exactly one thing: a worker that maps a real invoice to
`SubmitInvoiceParams` and calls `createZatcaSubmissionProcessor`. That worker is the next piece of real, user-facing ZATCA
work, and it cannot be built correctly without the decisions above — guessing any one of them risks a legally wrong invoice
reaching a government system, which is a different order of mistake than guessing a UI label.

**Found while writing Phase 8's "rounding test with awkward amounts" (2026-11-08), not yet fixed — this one is urgent,
likely to affect a normal real invoice, not a contrived edge case:** `buildBareInvoiceXml` can produce a document that
fails its own local validation on perfectly ordinary numbers. Each `InvoiceLine`'s own `cbc:TaxAmount` is rounded to 2
decimal places independently (`amountEl` → `Money.round(2)`, per line). The document's `cac:TaxTotal`/`cac:TaxSubtotal`,
by contrast, are built by summing every line's **full-precision, un-rounded** tax amount and rounding that sum **once**
(`buildTaxTotals`). These two roundings of the same underlying numbers can legitimately disagree by 0.01 — proven with
three lines each carrying a per-line tax amount of exactly `0.125` (a real value a 4-decimal-precision tax calculation
elsewhere in this app can genuinely produce, per D3/E3's "tax is rounded per invoice line to four decimals"): each line
independently displays `0.13`, but the subtotal sums `0.125 × 3 = 0.375` and rounds once to `0.38`, not `0.13 × 3 = 0.39`.
`checkInvoiceConsistency` correctly flags this as **hard errors** `BR_CO_14`/`BR_CO_17_TAX` — correctly, because the
document genuinely is self-inconsistent at that point: a human adding up what each line says gets a different number than
the subtotal states. In production this throws `InvoiceValidationError`, which the job wrapper classifies as
`UnrecoverableError` — the invoice does not just fail once, it sits permanently stuck until someone manually intervenes,
for an invoice that did nothing wrong.
  - Test: `invoice-xml-builder.spec.ts` "buildBareInvoiceXml — awkward (boundary) rounding amounts" (two tests, both
    passing — proving the current, broken behavior, not a fix).
  - **Not fixed here on purpose.** The safe-looking fix (sum the already-rounded per-line display values for the
    subtotal, instead of summing full precision and rounding once — which makes "sum of what's shown per line" and "the
    subtotal" agree by construction, regardless of which convention is "right") touches exactly the kind of ZATCA
    Schematron rounding behavior section Y's own `// REVIEW:` already flags as unconfirmed (no SDK/Schematron access in
    this or any prior session). Guessing the wrong convention here is not a cosmetic risk — it is a legal-document
    rounding rule. **This needs either ZATCA's official Schematron rules (`docs/vendor/zatca/sdk/Data/Rules`, which
    Osama has locally) or a real sandbox submission with deliberately awkward amounts to observe what ZATCA itself
    accepts, before it is fixed.**
  - Blocking: not Phase 7 (already delivered), but it blocks any real invoice submission (the worker above) from being
    trustworthy — this should be resolved before that worker is built, not discovered later against a customer's books.

**RESOLVED (2026-11-09) — the Schematron Osama has locally (`docs/vendor/zatca/sdk/Data/Rules/Schematrons/
CEN-EN16931-UBL.xsl`) was checked directly, which this task's own note above said was the way to resolve it.**
Two real findings, one validator fix and one builder fix:

- **The validator (`invoice-consistency.ts`) was stricter than ZATCA's own rule, in two ways.** First, BR-CO-17 (the
  rule governing a TaxSubtotal's tax amount) carries the real Schematron's own explicit tolerance —
  `count(//cac:InvoiceLine) * 0.01` — exactly to absorb this class of boundary disagreement; our code instead compared
  the subtotal against "the sum of the lines' own independently-rounded TaxAmount" (not what BR-CO-17 checks at all)
  with zero tolerance. For the three-line/0.125 case: taxable = 2.50, rate = 15%, and 2.50 × 0.15 rounds to exactly
  0.38 — the same value `buildTaxTotals` already produces — so this specific case needed no tolerance to pass once
  compared correctly. Second, **BR-CO-10, -13, -16, and the whole BR-CO-17/BR-S-08-family of checks are "warning"
  severity in the official Schematron, not "error"** (confirmed per rule by its `flag="..."` attribute); only BR-CO-14
  and BR-CO-15 are real errors. This file had escalated every one of them to a hard error, which is what actually made
  this bug block an invoice permanently — a genuine disagreement here was never ZATCA's own definition of
  "unrecoverable." BR_CO_14 and BR_CO_15 themselves were also comparing against the wrong ground truth (sum of the
  raw lines instead of sum of the document's own TaxSubtotal amounts); fixed to match the real rule text, which also
  removed any tolerance question for those two since they never involve a second rounding of the lines.
- **A second, real bug this check turned up in the BUILDER itself**, not just in how strictly the validator read it:
  `buildLegalMonetaryTotal` rounded `TaxExclusiveAmount` and `TaxInclusiveAmount` from two different full-precision
  sums independently, which can disagree by 0.01 the same way — and BR-CO-15 (TaxInclusive = TaxExclusive + tax) IS a
  real "error" with no tolerance. Fixed by rounding `lineExtension` and `totalTax` to 2dp first and only then adding
  them, so `TaxInclusiveAmount` is always exactly the rendered `TaxExclusiveAmount` plus the rendered tax, by
  construction — this was a latent defect that would have produced a real BR-CO-15 rejection on live ZATCA for an
  invoice with these same boundary amounts, independent of anything the validator checks locally.
- **Verified against the real official sample documents**, not just the hand-built test: `checkInvoiceConsistency`
  now reports zero issues for all six Tier-1 document type samples (`Standard_Invoice.xml`, `Standard_Credit_Note.xml`,
  `Standard_Debit_Note.xml`, `Simplified_Invoice.xml`, `Simplified_Credit_Note.xml`, `Simplified_Debit_Note.xml`) —
  previously this suite could not even run on this machine (see the unrelated test-harness fix below), so this was
  never actually exercised before now.
- **Unrelated, found as a side effect of getting that suite to run at all**: `generateTestCertificate`
  (`src/testing/fixtures.ts`) called `openssl req -new -x509` without controlling `OPENSSL_CONF`; on this machine a
  system-wide `OPENSSL_CONF` (set by a PostgreSQL/psqlODBC install, unrelated to this project) pointed at a path the
  Git-for-Windows `openssl` on `PATH` can't read, so every test depending on a throwaway test certificate failed to
  even start. Fixed by clearing `OPENSSL_CONF` for that one subprocess call only (not a system/global change). The
  real onboarding code (`csr.ts`) was never affected — it already passes `-config <path>` explicitly on every real
  CSR call, which overrides `OPENSSL_CONF` regardless of what the machine has set.
- **New gaps this surfaced, not fixed here (out of today's scope, flagged for later):**
  - `verifySignedInvoice` reports `SIGNATURE_INVALID`/`SIGNED_PROPERTIES_DIGEST_MISMATCH` against the real official
    signed samples once the suite could actually run — this is the crypto/signature verifier, untouched by this fix,
    and was simply never exercised on a real machine before (the suite never got past the certificate step). Needs its
    own investigation before Phase 5's submission worker is trusted.
  - 11 of the SDK's own sample documents outside Tier 1's built scope (foreign-currency advance payments,
    self-billing, export, summary, nominal-supply, document-level charges, out-of-scope tax) still fail
    `checkInvoiceConsistency` with unrelated codes (`AMOUNT_MISSING_OR_MALFORMED`, `CURRENCY_MISMATCH`,
    `SUBTOTAL_MISSING_FOR_LINES`) — consistent with section T's own "not built" list for these scenarios, not a
    regression from this fix.

## R. Sales debit notes (2026-11-04)

Decided by Osama (relayed): sales debit notes are a real feature, not a throwaway document built only to pass ZATCA's
compliance check (M7 needs one of every invoice type it declares, including a debit note). Built as the AR mirror of
`SupplierInvoiceService.createDebitNote` (decision D8), which is itself the AP mirror of the sales credit note (E2) —
closing the symmetry Osama already approved on both ledger sides.

- **What it is:** free-typed lines billed against an existing sales invoice, increasing what the customer owes (`Dr
  Accounts receivable / Cr revenue accounts / Cr Output VAT`). `SalesInvoiceService.createDebitNote`,
  `apps/api/src/sales/sales.controller.ts` `POST /v1/sales-invoices/:id/debit-notes`. Numbered `SDN-<year>-<seq>`
  (kept distinct from purchasing's `DN-` prefix so the two kinds of debit note are never confused on sight).
  `// REVIEW:` not an accountant's ruling — see below.
- `// REVIEW:` **bounding cap.** Debit notes raised against one invoice, plus the new one, never exceed that invoice's
  own gross — the same cap D8 and E2 both use. Unlike a credit note (which cannot sensibly exceed what was billed),
  there is no inherent accounting reason a debit note must be capped at the original invoice's value; this just
  carries over the existing pattern rather than introducing a third rule. Confirm with an accountant before the first
  real one posts, same as D1-D9 and E1-E6.
- **Reuses `sales_invoices`/`sales_invoice_lines`** — no new table. Migration `20261104120000_sales_debit_notes`
  (expand-only) widens two existing CHECK constraints (`sales_invoices_type_check`,
  `sales_invoices_credit_link_check`) to admit `DEBIT_NOTE` alongside `INVOICE`/`CREDIT_NOTE`.
- **Permission:** reuses the existing `debit_note:create` permission (already granted to Accountant and Purchasing
  for the supplier-side debit note); added to the Sales preset role. Existing installations must run the seed again:
  `npm run seed --workspace=@erp/db`.
- **Fixed in the same change, found while building this:** two places assumed a sales invoice's only non-INVOICE
  document type was CREDIT_NOTE, and would have silently mis-stated money once DEBIT_NOTE existed —
  `PartyStatementService.statement` (SALES side) labelled every non-invoice row "CREDIT_NOTE" and always treated it as
  a reduction; `loadOutstanding` (SALES side) summed every row referencing an invoice as a credit regardless of type,
  so a debit note would have *reduced* the reported receivable instead of increasing it. Both now branch on the
  actual `document_type`. `DashboardService.salesSummary`'s "this month net sales" figure also now adds debit notes
  the same side as invoices, for the same reason.
- **Known gaps:** no UI for the ZATCA-required sample debit note yet (that is Phase 2 of M7, which needs a real
  document to submit for the compliance check) — the feature here is the general AR capability; wiring it into the
  compliance pack's sample-submission step is separate work. No "known gap" entry needed for sales credit notes'
  existing behaviour; only the two statement/ageing queries above changed.
