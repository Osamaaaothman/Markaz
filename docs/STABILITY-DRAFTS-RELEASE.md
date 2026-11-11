# Stability, drafts and document tracking — 2026-11-11

## Behavior

- Drafts persist on the server, scoped to the current user and company. Autosave
  waits 900 ms after changes; Save draft is also available. My drafts restores
  partial forms without consuming document numbers or posting accounting entries.
- Supported forms: quotations, sales orders/invoices, purchase requests/orders,
  supplier invoices, goods receipts, stock issues/counts, journal entries, cash
  expenses, customer receipts and supplier payments.
- Optimistic versions reject stale tabs. Unsaved edits warn before browser unload;
  in-app navigation attempts a final save. Offline errors are visible and can be
  retried. This is server autosave, not an offline database.
- Submission keys survive restoration. Concurrent retries cannot create duplicate
  commercial documents or stock counts; posted documents retain the Core engine's
  idempotency. Completed drafts are soft-deleted. A cleanup failure can leave a
  draft visible, but re-submitting its key returns the original document.
- Document tracking follows related purchase/sales documents, invoices, payments
  and accounting entries. Each node requires its own read permission and company
  match. Traversals are bounded and explicitly report truncation.
- Every edited line control has a persistent Arabic/English caption. Stock issue
  and sales invoice quantities show on-hand stock, aggregate repeated item lines,
  and block submission if the total exceeds availability or stock cannot load.
  The server remains authoritative for concurrent inventory movements.
- Invoice/document issuer metadata is rendered in the PDF page footer, including
  multipage output. Arabic shaping and readable local timestamps are preserved.
- Company settings allow authorized name changes and creation of a Gregorian
  year with 12 monthly periods. Years cannot overlap. Names tied to issued EGS
  credentials cannot be changed through this screen. This is not year-end closing.
- Setup now recognizes the company logo, exposes both customer/supplier ledger
  parent mappings, and links WPS/year setup to the actual controls. WPS export
  rejects demo markers/delimiters and sums exact rounded employee amounts.
- Refresh rotation coordinates tabs using Web Locks, synchronizes persisted
  sessions, and avoids restoring a session after logout. Browsers without Web
  Locks retain single-tab coordination only.
- Email uses the selected Resend HTTPS transport or existing SMTP configuration.
  Missing configuration is a visible failure. See [production setup](QUOTATION-EMAIL.md).
- Dashboard day/month boundaries use company timezone; web security headers and
  the patched mail dependency address the audit's hardening findings.

## APIs and storage

- `GET /v1/document-drafts`: latest 100 permitted drafts for the signed-in owner.
- `GET /v1/document-drafts/:id`: restore one owned draft.
- `PUT /v1/document-drafts/:id`: `{ kind, version, payload }`; version 0 creates,
  later versions update optimistically. Payload limit 128 KiB; create permission
  for the corresponding document is required on every access.
- `DELETE /v1/document-drafts/:id`: `{ version }`; soft deletion with audit metadata.
- `GET /v1/document-trail/:kind/:id`: read-only, permission-filtered document graph.
- `GET/PUT /v1/company/settings`: scoped company profile; PUT requires update
  permission and the current version.
- `POST /v1/company/settings/calendar-years`: `{ year }`, company update permission.

Expand-only migrations, applied before API/worker rollout:

1. `20261111090000_document_drafts`: owned drafts, versions, JSON checks and grants.
2. `20261111091000_commercial_submission_keys`: nullable company-unique keys for
   quotations, sales orders and purchase orders.
3. `20261111092000_request_count_submission_keys`: equivalent keys for requests/counts.

Existing records remain valid. Roll back application images while leaving these
additive tables/columns in place; do not drop drafts or keys to roll back code.
Use the existing migration owner, not the restricted application role.

## Verification and remaining boundaries

Verification uses disposable PostgreSQL 17 and Redis 7, real PDF Chromium renders,
the local official SDK 3.4.8, and Chrome against a separate seeded QA company.
Checks include tenant/user isolation, optimistic conflicts, tombstones, concurrent
submissions/audit deduplication, stock aggregation, WPS rounding, timezone boundaries,
refresh races, transport failures and PDF exports. Browser checks cover partial
purchase-order save/reload and two-tab conflict rejection in Arabic/English.
Short and 3-page invoice PDFs were visually inspected.

CI now provisions/migrates PostgreSQL and Redis. Test results are not cached.
The official SDK remains a separately supplied local/controlled-runner dependency;
it is not redistributed into CI. Its existing anonymized sample-crypto exception
list is unchanged. Local fixes cover optional amounts, accounting tax currency,
prepayment references, rounding and QR amount due (SDK `PAYABLE_AMOUNT_XPATH`, BT-115).
Regression checks for optional amounts/currency/rounding also run without the SDK.

**Owner decision:** actual ZATCA invoice-to-submission integration is deferred.
Nothing here enables live clearance/reporting or claims legal invoice acceptance.
Custom fiscal calendars, year-end closing, bank acceptance, real email delivery,
production restore/load drills and external printer checks remain separate work.
Historical demo duplicates/negative opening balances are not rewritten: posted
financial history requires explicit corrective transactions, not cosmetic edits.

## Ownership questions

1. Why does saving a draft allocate neither a document number nor a journal entry?
2. How do company/user filters and versions prevent disclosure and stale overwrites?
3. Why must the same submission key survive a timeout and a page reload?
4. Why is displayed stock insufficient without the server's transaction checks?
5. What distinguishes provider acceptance from delivery and local validation from
   ZATCA acceptance?
