# 12 — Operations & Deployment

---

## 1. Environments

| Env | Purpose | Data |
|---|---|---|
| local | Development | Docker Compose, seeded demo tenants |
| ci | Automated tests | Ephemeral Postgres via Testcontainers |
| staging | Pre-production, ZATCA **sandbox** | Synthetic tenants only |
| production | Live customers | Real data — access strictly controlled |

**Never point staging at ZATCA production. Never copy production data into staging**
without irreversible anonymisation — and prefer generated data over anonymised data.

---

## 2. Docker Compose (local dev, and the single-tenant on-prem base)

Services: `api` (NestJS) · `db` (PostgreSQL) · `web` (Nginx serving the React build) ·
`redis` (queue) · `worker` (job processor).

Rules:
- **The worker is a separate process from the API**, even in Compose. Jobs must not run
  inside the HTTP process — one long ZATCA retry loop should never slow down requests.
- No secrets in `docker-compose.yml`. Everything via `.env`, with a committed
  `.env.example`.
- Named volumes for Postgres data. **Document exactly which volume holds customer data**
  — an on-prem customer will ask how to back it up.
- Healthchecks on every service; `api` waits for `db` to be genuinely ready, not just
  started.
- Multi-stage builds; non-root user in the final image; pinned base image digests.
- `docker compose up -d` must produce a working, seeded system with no manual steps.
  If it does not, that is a bug — the on-prem install story depends on it.
- Migrations run as an explicit step, **not** automatically on API startup. Automatic
  migration on boot in a multi-replica deployment causes concurrent migration attempts.

---

## 3. Production deployment

Compose is a development and on-prem tool. Production SaaS needs:
- Managed PostgreSQL with automated backups and **point-in-time recovery**
- At least two API replicas behind a load balancer; rolling deploys with health gates
- Separate worker deployment, independently scalable
- Managed Redis
- Object storage for documents and archived e-invoices
- KMS for tenant key custody
- Secret store
- A defined region consistent with the **data residency decision**
  (`docs/01-OPEN-DECISIONS.md` A2)

Every deployment has a **rollback plan**. A deployment whose schema change cannot be
rolled back must not ship.

---

## 4. Migrations

- Platform schema and tenant schemas migrate separately.
- Runner is idempotent, resumable, and records per-tenant version state.
- **Expand/contract, always** (see `docs/03-MULTI-TENANCY-RULES.md` §6).
- Long backfills are jobs, not migration steps holding a lock.
- Every migration tested against a database seeded to realistic volume.
- Migration runs are logged with duration per tenant; a slow one must be visible before
  it becomes an outage.
- A dry-run mode that reports what would change, per tenant.

---

## 5. Background jobs

- Separate worker process, separate scaling, separate metrics.
- Every job: `tenantId`, `correlationId`, idempotent, bounded retries with exponential
  backoff and jitter, then dead-letter with an alert.
- Queue fairness across tenants — one tenant's month-end must not starve others.
- Scheduled jobs (aging reports, rate refresh, period reminders, certificate expiry
  checks) are defined in one place with their schedules documented.
- **A dead-lettered ZATCA submission is a customer-facing incident**, not a log line.
  It must alert us and surface in the tenant's UI.

---

## 6. Backups and recovery

- Automated daily backups plus PITR; **encrypted**; retention documented.
- **Restore is tested on a schedule by actually restoring** — an untested backup is a
  hope, not a backup.
- Per-tenant restore capability (a customer will corrupt their own data and ask for
  last Tuesday). Schema-per-tenant makes this far easier — a real argument for that
  isolation choice.
- RPO and RTO are **committed numbers** (open decision B8), not vibes.
- Backups are access-controlled as tightly as production — a backup dump is a full
  copy of every customer's ledger.

---

## 7. Observability

- **Structured JSON logs** via Pino. Every line: `tenantId`, `correlationId`, actor,
  action, outcome, duration. Redaction is centralised (see `docs/09-SECURITY-RULES.md` §7).
- Metrics: request rate/latency/errors per endpoint · job queue depth, age, failure rate
  · ZATCA submission success rate and latency · database connection pool and slow
  queries · per-tenant usage.
- Tracing with correlation ids propagated from API into jobs.
- **Alerts that matter:** failed/dead-lettered ZATCA submissions · trial balance drift ·
  backup failure · certificate nearing expiry · error-rate spike · queue backlog growth
  · authentication anomalies.
- Health endpoints: liveness (process up) and readiness (database and queue reachable),
  and they must be genuinely different.

---

## 8. Tenant lifecycle operations

Runbooks (written, tested, not improvised):
- Provision a new tenant
- Suspend a tenant (read-only) for non-payment
- Export all data for a tenant
- Delete a tenant, reconciled against the 10-year tax retention obligation
- Restore one tenant to a point in time
- Rotate or reissue a tenant's ZATCA credentials
- Support access to a tenant's data — with reason, time bound, and audit

---

## 9. Configuration

- Environment-based. Validated at startup with a schema; the process **fails fast** with
  a clear message if a required variable is missing — never on the first request that
  needs it.
- `DEPLOYMENT_MODE=saas | single_tenant` is the only switch between the two delivery
  models. It changes wiring at the composition root, not logic scattered through the code.
- `.env.example` documents every variable: purpose, required or optional, default, and
  where the value comes from.

---

## 10. Pre-first-customer checklist

```
[ ] Backups configured AND a restore actually performed successfully
[ ] Tenant isolation test suite green, covering every endpoint
[ ] Ledger integrity suite green against the performance fixture
[ ] ZATCA sandbox end-to-end verified, including failure and retry paths
[ ] Key custody implemented, reviewed, and documented
[ ] Alerting live and verified by triggering a real alert
[ ] Rollback procedure tested on staging
[ ] Tenant provisioning and deprovisioning runbooks executed end to end
[ ] docs/SECURITY.md threat model written
[ ] Both locales complete on every Tier-1 screen, RTL verified
[ ] Support access path built and audited
```
