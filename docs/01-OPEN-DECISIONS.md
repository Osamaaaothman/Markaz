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
