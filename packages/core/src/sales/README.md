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

## Voiding an invoice the tax authority rejected

`voidRejectedInvoice` undoes an invoice that never became a valid tax invoice: one reversing entry on
the invoice date, goods back to stock at their original cost, order quantities released, and a row in
`sales_invoice_voids`. The invoice row stays as posted. Receivables, ageing, statements and the
dashboard leave voided invoices out. Core has no country rules: composition passes a guard (for ZATCA,
"status is REJECTED and the invoice is standard"); without a guard nothing is voidable.
Decision and open points: docs/01-OPEN-DECISIONS.md, "Correcting an invoice ZATCA rejected".

### Known Gaps

- Refuses an invoice with payments, credit or debit notes, an inventory shortfall, or a closed period.
- Simplified (B2C) rejected invoices are refused until the procedure is confirmed (D-VOID-2).
- Order-linked lines of the corrected copy keep the order's price and tax code.
