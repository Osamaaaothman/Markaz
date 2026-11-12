# Screen loading, imports, quotation email history and replenishment

## Screen loading

Feature routes use React lazy imports and Suspense. The application shell remains
visible while the requested screen loads. The import dialog and workbook parser
are loaded on demand; XLSX parsing runs in a terminable web worker. The initial
production JS entry decreased from approximately 1,916 kB to 778 kB (before gzip).
Shared components and translations still form a significant initial bundle.

## Item and party imports

Open **Items / Parties → Import Excel / CSV**. Download the header template, keep
identifiers/phone numbers as text in Excel, then choose an XLSX or UTF-8 CSV file.
Only the first worksheet is imported. Limits: 2 MiB compressed input, 10 MiB
declared expanded ZIP contents, 200 nonempty data rows, 20 columns, 15-second parse
timeout. Unknown/duplicate/blank headers and unlabeled extra cells are rejected.
No formulas are evaluated; only stored cell values are read.

The preview shows original row numbers, normalized values and each field error.
Ready rows are green, duplicates amber, other errors red, all with text and icons.
Fix the source and upload again, or explicitly select **Import valid rows only**.
No update/overwrite is performed. Item identity is code; party identities are name,
email, VAT number and commercial registration, case insensitive. Inactive records
also count. Employees must be provisioned through HR, not this importer.

Endpoints: `POST /v1/{items|parties}/import/{preview|commit}` with
`{ "rows": [{ "rowNumber": 2, "values": { "code": "A", "name": "Item", "unit": "EA" } }] }`.
Requires `item:create` or `party:create`. Preview is read-only. Commit revalidates
within a serializable transaction and commits all selected rows, references and
audits together. Invalid rows return 422; concurrent conflicts return 409 and
require a refreshed preview. Following a lost response, refresh the list/preview
before retrying: existing rows are flagged instead of silently recreated.

## Quotation email history

Quotation → Email includes a paginated company-scoped history of recipient,
attempt/sent time, status and last provider check. **Prepare resend** fills the
recipient/language and generates a preview; a separate Send action is required.
Each intentional send has a fresh idempotency key. Replaying a key never initiates
a second provider call. Unknown/stuck attempts require checking provider records
before starting another send. Historical messages from before this migration are
not reconstructed; Gmail drafts are not sent/tracked by the application.

`GET /v1/quotations/:id/email/history?cursor=UUID` and
`POST /v1/quotations/:id/email/:attemptId/refresh` require `quotation:read`.
Send retains `quotation:create`. Delivery checks use Resend's HTTPS retrieve API;
SMTP acceptance cannot establish delivery. Accepted, delivered, failed, bounced,
delayed, complained and unknown are distinct states. Delivered means recipient
server acceptance, not inbox placement or a human read. No webhooks/background
polling: use **Check delivery**. Provider status refresh and send outcomes are
audited, without storing message bodies/PDFs or full addresses in audit logs.

Migration `20261112130000_quotation_email_attempts` adds one table and grants
SELECT/INSERT/UPDATE to the restricted `erp_app` role. Deploy migrations before API
and worker; deploy the matching web build. No existing records are rewritten.
Keep the additive table if rolling application code back. A verified sender and
Resend key capable of reading email status are required; see QUOTATION-EMAIL.md.

## Reviewed replenishment requests

Open **Stock levels → Suggested purchase requests**, select an active warehouse,
choose items and review/reduce quantities before creating a request. The result
is a normal PENDING purchase request for the existing review/order workflow.
It never auto-approves a purchase or posts stock/accounting entries.

Suggestion = max(0, item reorder point − warehouse on hand − pending/accepted
purchase requests − unreceived quantities on pending-approval/approved/partially
received purchase orders). Processed/rejected requests and closed/rejected orders
are excluded to avoid double counting. Items without a stock row have zero stock.
The existing per-item reorder point is used as the target at each selected
warehouse; demand forecasts, lead times and supplier pack sizes are not inferred.

`GET /v1/replenishment?warehouseId=UUID&cursor=UUID` requires `stock:read`, pages
100 active items with positive reorder points (including rows with zero suggestion).
`POST /v1/replenishment/requests` requires `purchase_request:create`, a nonempty
Idempotency-Key and at most 100 unique lines. It recalculates under a warehouse
advisory lock and rejects stale/excess quantities with 409. Concurrent suggestion
submissions cannot order the same shortage twice. Other inventory operations can
still change demand afterwards; review remains mandatory.

## Verification

Real PostgreSQL integration tests exercise preview non-mutation, atomic batch
validation, exact decimals, duplicate imports, company isolation, restricted-role
grants, pending/incoming deductions, concurrent replenishment, idempotent sends,
and ambiguous failures. External email requests are mocked; no live email is sent.
CSV parsing tests include Arabic, quoted newlines, leading zeroes, malformed
quoting, duplicate headers and row limits. Browser QA uses a disposable local
company and tests CSV/XLSX previews, saving, quantity limits and bilingual screens.
