# Sales pricing and inventory integration

See [ADR 0005](../../../../docs/adr/0005-sales-prices-and-provisional-stock-costs.md)
for the agreed pricing, negative-stock and settlement policy, posting entries and rollout rules.

`QuotationService.create` and direct `SalesOrderService.create` validate selling prices.
`SalesInvoiceService.createInvoice` enforces source-order prices server-side and uses the
inventory provisional-cost repository. Returned goods include completed cost corrections.
`SalesInvoiceDetail.stockCostStatus` flags incomplete valuation without changing tax totals.

No tax-signature or environment behavior is implemented here. Compliance errors remain in
the compliance pack and its API/UI adapter.


Sales invoices accept an explicitly supplied `actualDeliveryDate` (calendar date), preserved in detail/audit output; existing invoices are not backfilled. An optional `SalesInvoiceIssueValidator` supplied by application composition runs within the posting transaction before financial/stock/numbering/outbox effects for invoices and notes. Core contains no country validation rules. Rejections leave all posting effects unchanged; existing idempotent invoice/credit-note replays still return their original result.
