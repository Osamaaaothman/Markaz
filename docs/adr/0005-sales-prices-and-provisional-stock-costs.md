# ADR 0005: Sales prices and provisional inventory costs

Accepted by the owner, 2026-11-14. Delivery is a review PR only; no production rollout is authorized.

## Decision

Validate selling prices when creating a quotation or a direct sales order. These documents have
no dispatch warehouse, so the reference is the company's weighted average of positive stock
pools. If depleted, use the most recently updated known warehouse cost. Missing history is
unknown, not a made-up minimum price. A direct invoice checks its dispatch warehouse cost.

Quotation conversion retains agreed prices. A linked invoice must retain the order line's
item, unit price and tax code; the server rejects alterations, and the UI disables those fields.
Subsequent cost increases do not invalidate an agreed order price. Contractual limits on the
quantity still to invoice or return remain enforced.

Stock availability is advisory for quotations, orders, sales invoices, stock issues and
purchase returns. Orange warnings do not disable submission. This supersedes the previous
no-negative-stock policy in A3. Physical counted quantities themselves cannot be negative.

Shortages use the last known average cost provisionally. If there is no history, record the
quantity and a pending cost without inventing a zero-value journal entry. A known zero cost is
distinguished from an unknown cost. Quantity/value stock balances may be negative. The current
positive pool is still valued from its exact total quantity/value; `last_unit_cost` is only a
reference for depleted pools, with eight decimal places so it does not reduce price precision.

## Posting and settlement

| Event | Debit | Credit |
| --- | --- | --- |
| Sale/issue | COGS / project expense, estimated issue value | Inventory, same value |
| Receipt | Inventory, receipt value | GRNI, receipt value |
| Receipt cost exceeds estimate for an outstanding shortage | Original expense account, difference | Inventory, difference |
| Receipt cost is below estimate | Inventory, difference | Original expense account, difference |

Purchase returns use the existing purchase-price-variance mapping for later cost differences.
The original return continues to reverse the original supplier/GRNI amount. Missing account
mappings still require configuration; an inventory warning does not bypass accounting rules.

Outstanding shortages are tracked separately by company, item, warehouse, source line and
expense account. Incoming goods settle oldest shortages first; this is an allocation of
provisional costs, not a change from weighted average to FIFO valuation. Each allocation
preserves the final rounding remainder. Settlement rows and cost-adjustment movements are
append-only. Their journal is the new receipt/return/count journal; original posted documents
and entries are never rewritten. Corrections affect the open period of that incoming document.

Sales returns use the remaining historical cost including recorded settlement corrections,
less costs already returned. A return to the original warehouse retires that source line's
pending shortage first. Returns to another warehouse remain physical inter-warehouse offsets:
the originating warehouse's shortage remains pending until replenished there.

Invoices and stock balances expose `FINAL`, `PROVISIONAL` or `PENDING` cost status. Unknown
costs and incomplete settlements must not be presented as final profit. Stock movement reports
include zero-quantity `COST_ADJUSTMENT` rows. Unvalued physical movements have no journal link;
this is allowed only for zero value. Receipt/issue submission keys prevent duplicate movements.

## Rollout and rollback

Two migrations add the reference cost, shortage/settlement tables and submission keys, allow
signed book stock, and permit nullable journals on unvalued receipts/issues. Back up and test
the migration against the target database before a future approved rollout. Pause inventory
writers during migration and API replacement; all writers must understand settlement before
negative-stock documents are accepted. The worker's ZATCA behavior is unchanged.

Do not roll back to an API that rejects/incorrectly values negative pools after this policy
has been used. Restore/reconcile with an approved plan or ship a forward fix. No production
configuration, tax environment, certificates or existing invoice was changed by this PR.

## Verification

Real PostgreSQL tests exercise price rejection at the quote, order-price tampering, later cost
changes, overselling, missing costs, partial higher/lower-cost receipts, fractional allocation,
concurrency, retries, returns before/after settlement, physical counts and transaction rollback.
They compare inventory value with the inventory ledger and assert balanced debit/credit totals.

Sandbox signature failure is a separate cryptographic condition. The UI explains it while
retaining the error, test-document warning, data-only QR label and signature verification.
