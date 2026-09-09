# 02 — Architecture Rules

> **Delivery model note:** every customer runs one fully isolated deployment
> (`docs/adr/0002-drop-saas-single-purchase-per-customer-deployment.md`). The rules
> below describe that one deployment. Two things live outside it entirely and are not
> part of this repo's module graph: the **local print/hardware agent**
> (`apps/print-agent`, a small `localhost`-bound helper, only on machines that need
> it) and the **Activation Service** (a wholly separate repo — Osama's own
> infrastructure, never a dependency any module or Core contract talks to directly;
> only one narrow license-check integration point in Core calls out to it).

---

## 1. Modular Monolith — the boundary rules

One deployable API. Strong internal boundaries. The boundaries are enforced by
**tooling**, not by good intentions.

### Dependency direction

```
apps/api          → packages/modules/*  → packages/core     → packages/shared
                  → packages/compliance/contract
packages/core     → packages/shared, packages/db
packages/compliance/zatca-sa → packages/compliance/contract, packages/shared
```

### Forbidden imports (enforce with ESLint `no-restricted-imports` or dependency-cruiser)

| Forbidden | Why |
|---|---|
| `modules/sales` → `modules/inventory` internals | Modules talk through Core or published module contracts, never internals |
| `core/*` → `modules/*` | Core must not know its consumers exist |
| `modules/*` → `compliance/zatca-sa` | Modules depend on the compliance **contract** only |
| Anything → another module's Prisma models directly | Data ownership belongs to the owning module |
| `apps/web` → any backend package internals | Frontend talks HTTP + generated types only |

Add the lint rule in Milestone 0. If it is not enforced by CI, it will be violated.

### Cross-module communication
Preferred order:
1. **Call a Core contract** (posting, numbering, permissions, audit)
2. **Call the other module's published service interface**, exported from its
   `index.ts` "public API" — never a deep import
3. **Emit a domain event** for anything asynchronous or fan-out

Never reach into another module's tables.

---

## 2. Module public API

Every module exposes exactly one entry point:

```
packages/modules/<name>/
├── src/
│   ├── index.ts          ← the ONLY thing other modules may import
│   ├── <name>.module.ts  ← NestJS module
│   ├── api/              ← controllers, DTOs (public HTTP surface)
│   ├── application/      ← services, use cases, orchestration
│   ├── domain/           ← entities, value objects, invariants — zero infra imports
│   ├── infrastructure/   ← repositories (Prisma), external clients
│   └── events/           ← published domain events
├── tests/
└── README.md             ← what it owns, its tables, its events, its known gaps
```

`domain/` importing Prisma, NestJS, or `axios` is a bug. Fix it before committing.

---

## 3. The five Core contracts — mandatory

A module that implements any of these itself is a defect, not a shortcut.

### 3.1 `IAccountingEngine`
```
postEntry(command: PostingCommand): Promise<PostingResult>
reverseEntry(entryId, reason, actor): Promise<PostingResult>
```
- The module describes **what happened in business terms**; Core decides the accounts
  via a **posting rule / account mapping configured per tenant** — the module must not
  hard-code account names or codes.
  (The example in the planning doc passing `debitAccount: 'المخزون'` as a literal
  string is illustrative only. **Never do that.** Account resolution is tenant
  configuration, and account names are never Arabic string literals in code.)
- The posting must join the **same database transaction** as the business document.
  An invoice that saves without its journal entry is a corruption bug.
- Every posting carries: tenant, fiscal period, source module, source document type
  and id, actor, correlation id, and an idempotency key.

### 3.2 `IPermissionService`
```
can(actor, action, resource, scope?): Promise<boolean>
```
- Checked in the application layer, not only in the controller.
- Permissions are data (role → permission), not hard-coded role name checks.
  `if (user.role === 'admin')` anywhere in a module is a defect.
- Scope covers company/branch, not just action.

### 3.3 `INumberingService`
```
next(documentType, context): Promise<string>
```
- Gapless per tenant, per document type, per fiscal year — a legal expectation for tax
  documents.
- Allocation happens **inside the document's transaction** using a row lock or a
  sequence table, so a rollback does not burn a number and two concurrent requests
  cannot collide.
- Format is tenant-configurable (prefix, padding, year segment, branch segment).

### 3.4 `IAuditLogger`
```
log(event: AuditEvent): Promise<void>
```
- **Append-only.** No update path exists. No delete path exists.
- Records: tenant, actor, action, entity type, entity id, before/after (with sensitive
  fields redacted), timestamp, ip/user-agent, correlation id.
- Writing audit records must not silently fail. If audit fails, the operation fails.

### 3.5 Unified reporting layer
- Module data reaches the financial statements **through the ledger**, not through a
  bespoke report that reads module tables.
- Any module-specific operational report (e.g. stock movement) is clearly separated
  from the financial statements and must reconcile to them.
- A module that produces numbers which do not tie back to the trial balance is wrong.

---

## 4. New-module checklist

Before a module is considered complete:

```
[ ] Depends only on Core contracts and the compliance contract
[ ] Exports a single public index.ts
[ ] domain/ has zero infrastructure imports
[ ] Every write is tenant-scoped through the tenant boundary
[ ] Every financial effect goes through IAccountingEngine, in the same transaction
[ ] Every document number comes from INumberingService
[ ] Every mutation is permission-checked via IPermissionService
[ ] Every mutation writes an IAuditLogger record
[ ] Its data appears correctly in the general financial reports
[ ] Every user-facing string is a translation key, AR + EN both present
[ ] DTOs validated at the boundary; no unvalidated input reaches a service
[ ] Money uses the shared Money type; no floats anywhere
[ ] Unit tests for domain invariants; integration test for the main flow
[ ] README documents: owned tables, published events, dependencies, known gaps
[ ] ADR written if a significant decision was made
```

---

## 5. Transactions

- The unit of work is the **use case**, not the repository call.
- Business document + stock movement + journal entry + numbering + audit **commit
  together or not at all.**
- Use Prisma interactive transactions; pass the transaction client down explicitly.
  Never open a nested independent transaction inside one.
- Set a sane transaction timeout and keep transactions short. Never call an external
  HTTP service (ZATCA, email) inside a database transaction — enqueue it instead.
- Choose isolation deliberately. Anything that reads-then-writes a balance or a
  sequence needs a lock or a serializable transaction, and the choice must be
  documented in the code.

---

## 6. Asynchronous work

Anything that can be slow, can fail, or must be retried belongs in a **job**, not in
the HTTP request:
- ZATCA clearance retries and B2C reporting
- Email / PDF generation
- Report materialisation, month-end processes
- Tenant provisioning

Job rules:
- Every job carries `tenantId` and `correlationId`.
- Jobs are **idempotent** — they will be retried.
- Bounded retries with exponential backoff and jitter, then a dead-letter queue with
  an alert. Silent permanent failure is not acceptable for a tax obligation.
- Job state visible to support: what ran, when, for which tenant, with what outcome.

---

## 7. Domain events

- Named in past tense: `InvoiceIssued`, `GoodsReceived`, `PurchaseOrderApproved`.
- Carry ids and a minimal payload, never whole entities.
- Versioned from the start (`v1`) — you will change them.
- In-process dispatch is fine for a monolith, but **publish after commit**, never
  inside the transaction.

---

## 8. Architecture Decision Records

`docs/adr/NNNN-title.md` for every significant choice:

```markdown
# ADR-0004: Schema-per-tenant isolation
## Status
Accepted — YYYY-MM-DD
## Context
## Decision
## Alternatives considered  (and specifically why rejected)
## Consequences  (what gets easier, what gets harder, what we will regret at scale)
```

Minimum expected ADRs: tenant isolation · money representation · numbering and
gaplessness · posting engine and account mapping · compliance pack contract · job
queue · migration strategy across tenants · key custody · fiscal period locking.
