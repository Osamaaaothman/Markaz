# 05 — Accounting Integrity Rules

Osama is a developer, not an accountant. **Where you are not certain of the correct
accounting treatment, stop and ask — do not infer it.** Confidently wrong accounting
software is worse than incomplete accounting software.

---

## 1. Double-entry invariants (enforced in code *and* in the database)

1. Every journal entry has ≥ 2 lines.
2. `SUM(debits) == SUM(credits)` exactly, in the entry's currency and in base currency.
3. Every line has exactly one of debit or credit, and it is non-negative. There are no
   negative debits.
4. Every line references a **postable** account (leaf node; parent/header accounts are
   never posted to).
5. Every entry belongs to exactly one **open** fiscal period.
6. Every entry records: source module, source document type, source document id, actor,
   posting date, entry date, correlation id.
7. Multi-currency entries balance in **both** the transaction currency and the base
   currency; any residual from rate conversion goes to a configured exchange
   difference account — never silently dropped.

Add a test that generates random valid business operations and asserts the trial
balance is zero after each one. This test is the single best defence this system has.

---

## 2. Immutability

- **A posted journal entry is never updated and never deleted.**
- Corrections are **reversing entries**: a new entry, dated appropriately, referencing
  the original, with a reason and an actor.
- Voiding a document creates a reversal; it does not erase history.
- Draft documents may be edited freely. The transition draft → posted is the point of
  no return, and it must be explicit in the code and in the UI.
- If you find yourself writing an `UPDATE` against `journal_entries` or
  `journal_entry_lines`, stop. That is always wrong.

---

## 3. Fiscal periods

- Periods have states: `OPEN` → `CLOSED` → (optionally) `LOCKED`.
- No posting into a closed period. Enforced at the database level, not only in a service.
- Reopening a closed period is a privileged, audited action with a mandatory reason.
- Year-end close: revenue and expense accounts roll into retained earnings via a
  generated closing entry; the closing entry is a normal, auditable entry.
- Backdated postings into an open prior period are allowed but must be flagged in
  reporting — someone will ask why last month's numbers changed.

---

## 4. Chart of accounts

- Tree structure with a stable account **code** and a **type**
  (asset / liability / equity / revenue / expense), and a normal balance side.
- Only leaf accounts are postable.
- An account that has postings can be deactivated but **never deleted or retyped**.
  Changing an account's type after it has been posted to corrupts every prior report.
- Each tenant starts from a **seeded template** and may customise it. The template is
  data, not code.
- **Account mapping is configuration.** Modules say "inventory increased"; a per-tenant
  mapping resolves that to an account. No module ever contains an account code or name.

---

## 5. Posting rules per Tier-1 flow

Each flow below must have its posting rule written down, reviewed by Osama (with
accounting input where he is unsure), and covered by a test asserting the exact
resulting entry — before it is implemented.

- Goods receipt against a purchase order
- Purchase invoice matching and any price/quantity variance
- Inventory valuation on issue (**depends on the FIFO vs weighted-average decision —
  blocked**)
- Stock count adjustment (gain and loss)
- Sales invoice: revenue, VAT output, receivable
- Cost of goods sold on sale
- Customer payment and partial payment
- Credit note / invoice void after clearance
- Foreign exchange gain/loss on settlement
- Period-end and year-end closing

**Do not implement any of these from your own inference.** Write the proposed entry
as a table (account, debit, credit, condition), get it confirmed, then implement.

---

## 6. VAT and tax treatment

- Model **tax treatment codes**, not bare rates: standard-rated, zero-rated, exempt,
  out-of-scope, reverse-charge. These behave differently in the ledger **and** in the
  VAT return, and "exempt" is not "rate 0".
- Tax is stored per line and summarised per document; both are persisted, never
  recomputed at read time from possibly-changed rates.
- Rates are effective-dated. A rate change must not alter historical documents.
- The VAT return / summary report must reconcile to the ledger. If it does not, the
  report is wrong, not the ledger.

---

## 7. Reconciliation reports (build these early — they are your test harness)

- **Trial balance** — must always be zero. Expose it in development as a health check.
- **Sub-ledger to general-ledger reconciliation**: AR sub-ledger total == receivables
  control account; inventory valuation total == inventory control account.
- **Document-to-entry coverage**: every posted document has exactly one active entry
  chain; every entry traces to a document.

Any drift is a P0 bug. Wire these into CI against seeded data.

---

## 8. Numbering and legal expectations

- Tax document numbers are **gapless** per tenant, per type, per fiscal year.
- A number is allocated inside the document's transaction; a rollback does not consume
  it, and two concurrent requests cannot receive the same one.
- A cancelled document keeps its number and is marked cancelled — the number is not
  reused.

---

## 9. Audit trail

- Append-only. Every create, update, delete, approval, posting, reversal, period close,
  permission change, and login is recorded.
- Records actor, timestamp, before/after (sensitive fields redacted), and reason where
  the action requires one.
- The audit trail must be exportable for an external auditor.
- **The application database role has no UPDATE or DELETE grant on the audit table.**

---

## 10. What this system must never do

- Never auto-correct a discrepancy silently. Surface it.
- Never allow a balance to be edited directly. Balances are derived from entries.
- Never produce a financial report from anything other than the ledger.
- Never round to make something balance. If it does not balance, it is a bug.
- Never let a partially completed operation leave the ledger inconsistent — that is
  what transactions are for.
