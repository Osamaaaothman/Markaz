# 07 — API Rules

---

## 1. Shape

- REST, resource-oriented, versioned: `/api/v1/...`
- Plural resource nouns, nested only one level deep:
  `/api/v1/purchase-orders/{id}/lines` — not three levels.
- Actions that are not CRUD are explicit sub-resources:
  `POST /api/v1/invoices/{id}/post`, `/void`, `/send`, `/clear`
- **Tenant is never in the path or the body.** It comes from the token.

## 2. Controllers are thin

```
Controller:  validate DTO → resolve actor → call application service → map to response DTO
```
No business logic, no Prisma, no money arithmetic, no permission logic beyond
delegating to `IPermissionService`. A controller longer than ~50 lines is a smell.

## 3. Validation

- Every request body, query, and path param is validated at the boundary
  (class-validator DTOs; Zod on the frontend mirroring them).
- **Reject unknown fields** (`forbidNonWhitelisted`) — do not silently ignore them.
- Validate: types, required, lengths, enum membership, numeric ranges, date sanity,
  currency codes, decimal precision, body size limits.
- Amounts arrive as **strings** and are parsed into `Money`. Reject a JSON number for
  a monetary field.
- Validation failures return `400` with a machine-readable field list — and never echo
  back a sensitive submitted value.

## 4. Errors

One error shape everywhere:

```json
{
  "error": {
    "code": "PERIOD_CLOSED",
    "message": "<translation key, resolved by the client>",
    "details": [{ "field": "postingDate", "code": "PERIOD_CLOSED" }]
  },
  "correlationId": "..."
}
```

- **`code` is a stable machine-readable enum.** The frontend switches on `code`, never
  on message text — message text is translated and will change.
- **Error messages shown to users are translation keys**, present in both AR and EN.
- Status codes used correctly: `400` validation · `401` unauthenticated ·
  `403` unauthorised · `404` not found (**also for cross-tenant access**) ·
  `409` conflict/version/idempotency · `422` business rule violation ·
  `429` rate limited · `500` unexpected.
- **Never leak** stack traces, SQL, table names, Prisma errors, or internal ids to the
  client. Those go to the logs, keyed by correlation id.
- Domain errors are typed classes mapped centrally by one exception filter. Controllers
  do not build error responses by hand.

## 5. Idempotency

Every state-changing financial endpoint accepts `Idempotency-Key`. See
`docs/04-DATA-MODEL-RULES.md` §6. A replay returns the original result — it does not
re-post and does not consume a document number.

## 6. Pagination, filtering, sorting

- **Every list endpoint paginates.** No exceptions, no "it's a small table."
- Cursor-based for large or growing sets; offset acceptable for small bounded lists.
- Consistent envelope: `{ data: [...], pageInfo: { nextCursor, hasMore, total? } }`
- Whitelist sortable and filterable fields — never pass user input into an ORDER BY.
- Maximum page size enforced server-side.

## 7. Documentation and types

- **OpenAPI generated from the DTOs** (`@nestjs/swagger`), maintained as the code
  changes — not written at the end.
- Frontend types are **generated from the OpenAPI spec**. Hand-maintained duplicate
  interfaces on the frontend are banned; they drift and the drift is silent.
- Every endpoint documents: purpose, permissions required, idempotency support, error
  codes it can return.

## 8. Security at the API boundary

- Authentication on every route by default; public routes are explicitly opted out and
  listed in one place.
- Authorisation checked in the application layer, not only by a controller decorator.
- Body size limits, request timeouts, and per-tenant rate limits.
- CORS locked to known origins. No wildcard in production.
- Standard security headers (helmet).
- File uploads: type allowlist, size cap, magic-byte check, virus scan hook, stored in
  object storage with non-guessable keys — never on the API container's filesystem.

## 9. Long-running operations

Anything that may exceed a few seconds returns `202 Accepted` with a job id and a
status endpoint. The client polls. Nothing holds an HTTP connection open waiting on
ZATCA, a large report, or an email batch.

## 10. Backwards compatibility

Once a tenant is live on `/v1`:
- Additive changes only within a version (new optional fields, new endpoints).
- Removing a field, renaming it, changing a type, or tightening validation is a
  **breaking change** and needs a new version plus a migration window.
- Enum values are additive; clients must tolerate unknown values.
- Every breaking change is recorded in `CHANGELOG.md`.
