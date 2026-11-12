# Invoice returns

The November 12, 2026 request completes invoiced purchase and sales returns. It extends the earlier financial-only debit/credit notes; existing unlinked notes keep their original behavior.

## Workflow

- Sales: Sales returns → open the original invoice → Sales return. Select quantities, any active receiving warehouse belonging to the company, and an optional reason. The receiving warehouse is recorded on the credit note and its stock movements; only that warehouse receives the goods.
- Purchasing: Purchase returns → Create return from original invoice → open the original supplier invoice → Purchase return. Select quantities, the warehouse holding the goods, and an optional reason.
- The available quantity excludes prior linked returns. All selected rows must be valid before posting. Successful posting opens the new document, including the existing print/PDF actions.
- Purchasing has one invoice-based return workflow. The before-invoicing tab, purchase-order return action and POST /v1/goods-returns endpoint are removed. Previously posted goods returns remain read-only for document history.

## Posting rules

Linked notes use the original line's stored price, tax code, tax rate and amounts, even if current tax configuration changes. Partial amounts are allocated as differences between cumulative proportional amounts rounded to four decimals, so the final return consumes the exact remainder.

Sales: debit original revenue and output VAT, credit receivables; debit inventory and credit cost of goods sold at the returned units' original stored cost. Service lines do not move stock.

Purchasing: debit payables, credit input VAT; expense lines credit the original expense account. Stock lines credit inventory at the selected warehouse's current weighted-average cost. The difference between invoice net and stock cost posts to purchase price variance (credit when invoice net exceeds stock cost, debit otherwise). Received/invoiced order counters remain historical, preventing the same units from becoming eligible for another invoice or unbilled return. Replacement purchases use a new order.

Returns do not automatically move cash. A return against an already paid invoice creates a credit balance handled by the existing party/payment reporting. Old unlinked adjustments still count toward the invoice-wide value cap; they cannot be retroactively assigned physical quantities.

## API and integrity

Existing POST endpoints are retained:

- `/v1/sales-invoices/:id/credit-notes`: each return line includes `originalLineId` and `quantity` alongside the existing DTO fields. Stock lines accept `warehouseId` for the receiving warehouse; older clients that omit it keep using the original selling warehouse. The UI requires an explicit selection for stock returns. Service lines cannot specify a warehouse.
- `/v1/supplier-invoices/:id/debit-notes`: same, plus `warehouseId` for stock lines. The legacy `accountId` field can be an empty string on linked returns because the server derives the account.

If any line supplies `originalLineId`, every line must reference a distinct line on that company's original invoice. Client price/account/tax values are ignored for linked returns. Returns cannot predate the invoice, exceed its remaining quantity/value, overdraw stock, or post outside an open period.

A transaction advisory lock serializes notes per company/invoice without granting UPDATE access to immutable invoice tables. Document, journal, movements, and stock changes commit atomically. Repeating the same idempotency key returns the original document. Existing permissions `credit_note:create` and `debit_note:create` continue to authorize posting.

## Deployment

Apply migration `20261112090000_invoice_returns`, regenerate Prisma, and rebuild/restart API and web together. The migration adds nullable self-referencing line IDs and indexes; historical documents remain unchanged. The local running deployment has received this migration. The destination selector also requires migration `20261112100000_sales_return_warehouse_read`, which adds warehouse read permission to the standard Sales role; new installations receive the same grant from the seed. Custom roles need `warehouse:read` alongside `credit_note:create`.

Regression coverage includes real PostgreSQL with the restricted `erp_app` role, partial/full returns, historical tax/cost, concurrent over-return prevention, idempotency, insufficient stock rollback and company/line isolation. UI checks exercise both languages with isolated mocked API data.

Validation completed: 313 Core tests, 11 relevant API DTO/export tests, four browser journeys (purchase/sales × Arabic/English), TypeScript checks, changed-file lint, locale parity, dependency boundaries and the web production build. The final account-override regression was rerun successfully with the sales integration suite. The broader API suite was attempted but could not complete cleanly with this machine's missing Playwright-managed browser, OpenSSL configuration and Redis test service; this is not a claim that the entire API suite passed.

Receiving-warehouse follow-up: sales integration tests verify a different destination with existing stock at another cost, destination metadata and movements, idempotency, over-return across warehouses, invalid/inactive/foreign warehouse rejection, and service-line rejection. The 17 sales integration tests and 8 sales DTO/export tests pass. Browser checks cover the required selection and payload in Arabic and English.

Local deployment follow-up (November 12, 2026): applied `20261112100000_sales_return_warehouse_read`, verified the existing Sales role grant, rebuilt API/worker/web and restarted with all five Compose services healthy. The served bundle contains the receiving-warehouse selector and the single invoice-based purchase return page; POST /api/v1/goods-returns returns 404. Backup: `erp-before-return-warehouse-20261112.dump` in the task artifact directory.
