# 03 — Multi-Tenancy Rules

**A cross-tenant data leak in an accounting system is a company-ending event.** Treat
every rule here as load-bearing.

---

## 1. The single boundary rule

There is **exactly one place** in the codebase that resolves the tenant and binds the
database connection to it. Nothing else decides what tenant it is operating on.

```
Request → Auth guard resolves tenant from the authenticated principal
        → TenantContext (AsyncLocalStorage) holds { tenantId, schema, actor, correlationId }
        → Prisma client is bound to that tenant for the whole request
        → Every repository call inherits it automatically
```

Rules:
- **`tenantId` is never taken from a request body, query string, path parameter, or
  header supplied by the client.** It comes from the verified session/token only.
  A user who can name their own tenant is a full data breach.
- Background jobs establish the same context explicitly from the job payload before
  doing any work.
- Any code path that can run without a tenant context (platform admin, migrations,
  provisioning) is **explicitly marked** and lives in a dedicated, separately
  permissioned area.

---

## 2. Isolation strategy

Default until decided otherwise (`docs/01-OPEN-DECISIONS.md` A1):
**schema-per-tenant on a shared PostgreSQL instance.**

- Tenant registry lives in a shared `platform` schema: tenants, subscriptions, users →
  tenant mapping, provisioning state, migration state per tenant.
- Each tenant gets its own schema containing all business tables.
- The connection sets `search_path` to the tenant schema for the request lifetime.
- Connection pooling must not leak `search_path` between requests — verify this
  explicitly and write a test for it.

**If the decision changes to shared-schema + RLS:** then every table gets `tenant_id`,
every table gets an RLS policy, the application role must **not** have `BYPASSRLS`, and
there must be a test that proves a query without tenant context returns zero rows. Do
not adopt RLS without all three.

---

## 3. Hard prohibitions

| Never | Why |
|---|---|
| A raw SQL query without tenant scoping | The most common leak path |
| A Prisma query built outside the tenant-bound client | Same |
| Caching keyed without `tenantId` | Cache-crossing is a leak |
| A global in-memory cache holding tenant data | Leaks across requests in the same process |
| Sequential/guessable tenant identifiers in public surfaces | Enumeration |
| `tenantId` accepted from client input | Impersonation |
| A "just for admin" query that skips the boundary | It will be reused |
| Logging another tenant's data in an error message | Leak through observability |

---

## 4. Testing the boundary (mandatory, not optional)

These tests exist from Milestone 1 and run in CI on every push:

1. **Two-tenant isolation test** — seed tenant A and tenant B with similar data; for
   **every** read endpoint, authenticate as A and assert B's records are unreachable
   (not "filtered out" — unreachable, including by direct id).
2. **Direct-id access test** — as tenant A, request tenant B's invoice by its exact id.
   Must return 404 (**not** 403 — 403 confirms the resource exists).
3. **No-context test** — a repository call with no tenant context must throw, never
   return everything.
4. **Search-path leak test** — run requests for A and B in sequence on the same pooled
   connection and assert no bleed.
5. **Job context test** — a job with tenant A's payload cannot touch tenant B.

If a new endpoint is added, it is added to test 1. This is part of the definition of
done, not a nice-to-have.

---

## 5. Tenant provisioning

Provisioning is a **first-class, idempotent, reproducible pipeline** — not a manual
runbook. Steps:

1. Create tenant record in `platform` (state: `PROVISIONING`)
2. Create schema, run all migrations to the current version
3. Seed: default chart of accounts template, tax treatment codes, document numbering
   series, fiscal calendar, base currency, default roles and permissions
4. Create the initial admin user and issue an invitation
5. Register subscription / entitlements
6. State → `ACTIVE`

Rules:
- Idempotent: re-running must not duplicate anything.
- Transactional or compensating: a failure halfway leaves a clean, retryable state —
  never a half-built tenant that looks active.
- **Deprovisioning is designed at the same time as provisioning**: suspend (read-only),
  export (full tenant data dump), and hard delete (schema drop + object storage purge),
  with a documented retention window. Customers will ask for this in procurement.

---

## 6. Migrations across tenants

- The `platform` schema and tenant schemas migrate separately.
- A migration runner iterates tenants, records per-tenant migration state, is resumable,
  and reports which tenants are on which version.
- **Expand/contract only.** Never a destructive migration in one step:
  1. add the new nullable column / new table
  2. backfill
  3. dual-write, then switch reads
  4. drop the old column in a **later release**
- Every migration must be tested against a database seeded with realistic volume, not
  an empty one.
- Long-running backfills run as jobs, not as migration steps that lock a table.
- **Never** hand-edit a generated migration to do something the schema does not
  describe, without an explicit comment saying why.

---

## 7. Per-tenant configuration

Everything a customer can differ on is **data**, never a code branch:
base currency · fiscal year start · timezone · default language · chart of accounts ·
numbering formats · tax treatment defaults · approval thresholds · inventory valuation
method · enabled modules · compliance pack.

`if (tenant.name === ...)` or any tenant-specific branch in code is a defect. If a
customer needs something the configuration model cannot express, the configuration
model is what changes.

---

## 8. Noisy-neighbour and fairness

- Per-tenant rate limits on the API.
- Job queue fairness so one tenant's month-end cannot starve everyone else.
- Query timeouts; no unbounded report can run forever.
- Pagination is mandatory on every list endpoint — no unbounded `findMany`.
- Track per-tenant resource usage from the start; you will need it for pricing and for
  incident diagnosis.

---

## 9. Observability

Every log line, metric, trace, and error carries `tenantId` and `correlationId`.
Support must be able to answer "what happened for customer X at 14:20" without
guessing — but log **identifiers, never financial or personal values**
(see `docs/09-SECURITY-RULES.md`).
