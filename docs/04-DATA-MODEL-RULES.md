# 04 — Data Model & Prisma Rules

---

## 1. Schema conventions

- Table names: `snake_case`, plural (`journal_entries`). Prisma models: `PascalCase`
  singular (`JournalEntry`), mapped with `@@map`.
- Primary keys: **UUID v7** (or ULID) — sortable, non-guessable, safe in URLs. Never
  a bare auto-increment integer in a public surface.
- Every business table has: `id`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`,
  and `version` (optimistic concurrency).
- Enums live in the database as Prisma enums where the values are stable; as lookup
  tables where the tenant can extend them.
- Foreign keys are always declared, always indexed. No orphan references.
- No nullable column without a documented reason — nullable is a business statement.

---

## 2. Money — the most important rule in this document

**Floating point is banned for any monetary or quantity value.** No `Float`, no
`Number` arithmetic on amounts, no `parseFloat`, no `toFixed` for computation.

- Storage: Prisma `Decimal` mapped to Postgres `NUMERIC(19, 4)` for amounts.
  Quantities: `NUMERIC(19, 6)` (partial units, weight-based items).
  Unit prices may need more precision than totals — decide per column, document it.
- In code: one shared `Money` value object in `packages/shared` wrapping
  `decimal.js` (or Prisma's Decimal), carrying **amount + currency**.
  Arithmetic on `Money` with mismatched currencies throws.
- **Rounding is explicit and centralised.** One rounding policy (half-up to the
  currency's minor unit, applied at the documented point in the calculation), one
  implementation, one place. Never round in a UI component and never round twice.
- Tax is computed on documented rounding rules — line-level vs document-level rounding
  changes the total. Pick one, write it in an ADR, and test the boundary cases.
- **Every foreign-currency row stores:** original amount, original currency, exchange
  rate used, rate date, and base-currency amount. The base amount is stored, not
  recomputed later — historical rates must not shift because a rate table was updated.
- JSON serialisation: amounts cross the API as **strings**, never JS numbers.
  `0.1 + 0.2` is not a joke in an accounting system.

Write a test that asserts a long chain of typical operations still balances to the
cent. Then write one that fails if anyone reintroduces a float.

---

## 3. Dates and time

- Store all timestamps as **UTC** (`timestamptz`).
- Store business dates that are calendar facts (invoice date, posting date) as
  **`date`**, not timestamp — an invoice dated 2026-03-31 is that date in every
  timezone.
- Render in tenant timezone (`Asia/Riyadh` default).
- Fiscal period boundaries are evaluated in **tenant local time**.
- Hijri dates are **rendered**, never stored as the source of truth.

---

## 4. Soft delete vs hard delete

- **Accounting records are never deleted.** Not soft, not hard. Posted entries are
  reversed.
- Master data (customers, items, accounts) is **deactivated**, not deleted, once it has
  been referenced by any transaction. An account with postings cannot be removed.
- Genuinely unused master data may be hard-deleted, with an audit record.
- If soft delete is used anywhere, **every query must exclude deleted rows by default**
  and there must be a test proving it. Half-applied soft delete is worse than none.

---

## 5. Optimistic concurrency

- Every user-editable document carries `version`.
- Updates use a conditional write on `version`; a mismatch returns `409 Conflict` with
  a clear message. **Silent overwrite of another user's edit is a defect.**
- The frontend surfaces the conflict rather than retrying blindly.

---

## 6. Idempotency

Every financial mutation endpoint accepts an `Idempotency-Key` header.
- The key + tenant + endpoint is stored with the result.
- A replay returns the original result, does not re-post, and does not consume a
  document number.
- Jobs use the same mechanism keyed on the job's business identity.

---

## 7. Indexing and performance

- Index every foreign key and every column used in a `WHERE`, `ORDER BY`, or join.
- Composite indexes that match real query shapes, not one index per column.
- **No `findMany` without a `take`.** Every list endpoint paginates (cursor-based for
  large sets).
- Financial reports over large date ranges must be measured against realistic data
  volume before they are called done — seed a performance fixture (e.g. 3 years,
  200k journal lines) and keep it.
- No N+1: use `include`/`select` deliberately. Log slow queries in development.

---

## 8. Prisma-specific rules

- One schema file per bounded area if Prisma's multi-file schema support is used;
  otherwise clear section comments. Either way, ownership of each model is documented.
- `select` explicitly. Do not return whole models to the API layer — map to DTOs.
- Raw SQL (`$queryRaw`) is allowed for reports, but:
  - **always parameterised** — never string interpolation
  - always tenant-scoped
  - always reviewed and commented explaining why the ORM was insufficient
- Generated Prisma types are **not** API types. Map explicitly; otherwise a schema
  change silently changes your public contract.
- Migrations are generated, reviewed line by line, and committed. Never
  `db push` against anything but a local scratch database.

---

## 9. Database-level integrity (do not rely on application code alone)

Add these as constraints/triggers, because application bugs are inevitable:

- `CHECK` that journal entry lines have exactly one of debit/credit populated and both
  non-negative
- A constraint or trigger ensuring a journal entry's lines sum to zero (debits ==
  credits) at commit
- Unique constraint on (tenant, document type, fiscal year, number) for document numbering
- Unique constraint preventing duplicate posting of the same source document
- `CHECK` on account type enumeration
- No posting allowed into a closed fiscal period — enforced by constraint or trigger,
  not only by a service check
- Audit table: no `UPDATE`/`DELETE` grant for the application role

Every one of these gets a test that proves the constraint fires.

---

## 10. Tier-1 core tables (conceptual — to be designed, not assumed)

`tenants` · `users` · `roles` · `permissions` · `role_permissions` · `companies` ·
`branches` · `currencies` · `exchange_rates` · `fiscal_years` · `fiscal_periods` ·
`accounts` (tree) · `account_mappings` · `journal_entries` · `journal_entry_lines` ·
`document_number_series` · `audit_log` · `approval_workflows` · `approval_requests` ·
`tax_treatments` ·
`warehouses` · `items` · `item_warehouse_stock` · `stock_movements` · `cost_layers` ·
`stock_counts` · `purchase_requests` · `suppliers` · `purchase_orders` ·
`purchase_order_lines` · `goods_receipts` · `supplier_invoices` ·
`customers` · `quotations` · `sales_orders` · `invoices` · `invoice_lines` ·
`payments` · `customer_statements` ·
`einvoice_documents` (XML, UUID, hash, QR, clearance status, ZATCA response) ·
`einvoice_credentials` (encrypted CSID material) ·
`jobs` / `outbox` · `idempotency_keys`

Design each with the access patterns written down first, the same way the ADR requires.
