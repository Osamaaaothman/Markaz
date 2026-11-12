# Audit log details

The read-only audit screen resolves document numbers in company-scoped batches and checks document read permission before returning a current reference. The audit-log read permission still grants access to the original event snapshots. Missing, deleted or inaccessible references have no fabricated navigation link.

- Arabic/English operation names and colored tags, actor and timestamp.
- Clickable sales/supplier invoices, purchase orders and returns, stock documents, payments, HR payments and payroll runs.
- URL-backed detail dialogs for quotations, purchase requests and journal entries; shared with Document Trail.
- Before/after field comparison, including nested lines, a changes-only toggle and expandable original JSON. Missing data is distinguished from an explicitly empty value.
- A document-history action applies both entity type and id server filters. Table text search covers loaded rows only; the screen explains this scope.
- New sales/supplier invoice and adjustment posting events record document number, counterparty name, dates, currency, decimal totals and line details. Existing append-only events are never changed. Linked documents show their current version; the event table shows the recorded snapshot.

No schema migration or new production configuration is required.

Validation: real PostgreSQL audit isolation, permission and reference tests; all Core tests (322), API tests (168), web tests (62); actual HTTP 401/403/audit-only-role checks; Arabic RTL and English LTR browser inspection and direct document navigation. Windows test runs used the installed Git OpenSSL config, with database/PDF suites run sequentially to avoid local resource-contention timeouts.
