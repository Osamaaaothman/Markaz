# 12 — Operations & Deployment

> **Model:** every customer gets an isolated deployment (own database, own backend),
> hosted either on the customer's own hardware or on a cloud account the customer pays
> for and Osama operates. There is no shared SaaS production environment — see
> `docs/adr/0002-drop-saas-single-purchase-per-customer-deployment.md`. **Docker
> Compose is the primary and only deployment mechanism for the customer-facing
> application**, not a dev-only convenience — it is what ships to every customer,
> on either hosting path. Separately, the central **Activation Service**
> (`docs/00-PRODUCT-BRIEF.md` §8) is Osama's own single piece of infrastructure and is
> covered on its own in §11.

---

## 1. Environments

| Env | Purpose | Data |
|---|---|---|
| local | Development | Docker Compose, seeded demo company |
| ci | Automated tests | Ephemeral Postgres via Testcontainers |
| staging | Pre-production, ZATCA **sandbox** | Synthetic data only |
| customer deployment | One per customer, live | That customer's real data only — never shared with any other environment |

**Never point staging at ZATCA production. Never copy a customer's production data
into staging or into another customer's deployment** without irreversible
anonymisation — and prefer generated data over anonymised data.

---

## 2. Docker Compose — the deployment unit for every customer

This is not a dev-only artifact. **It is what gets installed at every customer**,
whether that's their own server or a cloud account. Services: `api` (NestJS) · `db`
(PostgreSQL) · `web` (Nginx serving the React build) · `redis` (queue) · `worker`
(job processor).

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

## 3. Production deployment — two hosting paths, same bundle

There is no separate "SaaS production" tier with managed multi-replica
infrastructure — that entire model was dropped (`docs/adr/0002-...md`). A single
customer deployment is modest in scale (one company's data, one company's usage) and
does not need it. Every customer gets the same Docker Compose bundle; only *where it
runs* differs:

**Path A — customer's own hardware (true on-premise).**
- Osama installs, hands over `docker compose up -d` and the runbook, then the
  **customer owns** backups, patching, uptime, and physical security.
- No data residency question — the data never leaves the customer's own building.
- No KMS needed for ZATCA key custody — the customer's own deployment holds its own
  keys locally, encrypted at rest per `docs/09-SECURITY-RULES.md` §5, same as any
  other secret.

**Path B — a cloud account the customer pays for, operated by Osama** (e.g. Railway).
- The customer owns the bill and the account; **Osama holds admin access** to deploy
  and maintain it. That access is logged, reasoned, and reviewable — the same
  discipline `docs/09-SECURITY-RULES.md` §3 describes for platform-admin access, even
  though there is no shared platform underneath it.
- Data residency is a **per-customer question**: does this customer need in-Kingdom
  hosting, and does the chosen provider offer it? Verify against the provider's
  current documentation before committing a customer to this path
  (`docs/01-OPEN-DECISIONS.md` A2).
- Backups/PITR: whatever the provider offers for its managed Postgres, **verified by
  Osama**, not assumed — this customer is trusting Osama with the operational half of
  this choice even though they hold the account.

Every deployment (either path) has a **rollback plan**. A schema change that cannot be
rolled back must not ship to any customer.

---

## 4. Migrations

There is no cross-tenant migration runner — each customer deployment has exactly one
database, so a migration is a normal single-database Prisma migration. What still
matters at this product's scale:

- **Expand/contract, always.** Never a destructive migration in one step: add
  nullable/new table → backfill → dual-write then switch reads → drop the old column
  in a later release. This still matters because rollout happens **per customer, at
  different times** — one customer may run an older version than another (see
  `docs/01-OPEN-DECISIONS.md` B9), so a migration must never assume every deployment
  updates in lockstep.
- Long backfills are jobs, not migration steps holding a lock.
- Every migration tested against a database seeded to realistic volume before it ships
  to any customer.
- **Rollout is a per-customer operation, not a single push.** A documented,
  repeatable runbook (which customer is on which version, how an update is applied to
  their specific deployment, what the rollback step is) replaces the old cross-tenant
  migration runner — see `docs/00-PRODUCT-BRIEF.md` §8 "per-deployment rollout
  tooling." This does not exist yet and needs designing before more than a couple of
  customers are live.

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

- Automated daily backups plus PITR where the hosting path supports it; **encrypted**;
  retention documented. **Who is responsible depends on the hosting path** (§3): the
  customer on Path A (own hardware), Osama on Path B (operated cloud account) — but
  either way, Osama should hand over working backup tooling as part of the Compose
  bundle, not leave Path-A customers to figure it out themselves.
- **Restore is tested on a schedule by actually restoring** — an untested backup is a
  hope, not a backup. This applies on Path B regardless of who pays the cloud bill.
- Each customer's backup is already physically isolated from every other customer's —
  a real, simpler benefit of dropping shared infrastructure entirely, not just an
  argument for a particular isolation strategy.
- RPO and RTO are **committed numbers per hosting path** (open decision B8), not
  vibes — Path A's numbers depend on the customer's own infrastructure and may be
  weaker than what Osama commits to on Path B.
- A backup dump is that one customer's complete financial ledger — access-controlled
  as tightly as their production data, on whichever path holds it.

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

## 8. Customer deployment lifecycle operations

No provisioning pipeline across schemas — a "new customer" is a one-time install
event on whichever hosting path they chose. Runbooks still needed (written, tested,
not improvised):
- Install a new customer deployment (seed CoA, numbering series, fiscal calendar,
  admin user, ZATCA onboarding, license activation)
- Update/roll out a new version to an existing customer deployment (§4)
- Export all data for a customer, on request
- Decommission a customer's deployment, reconciled against the 10-year tax retention
  obligation — this looks different per hosting path: on Path A it means handing the
  customer their final export; on Path B it means Osama's own teardown of the account
  (with the export already delivered first)
- Restore one customer's deployment to a point in time
- Rotate or reissue a customer's ZATCA credentials — a customer-initiated action they
  perform themselves against their own onboarding, since they hold their own keys
- Osama's support access to a customer's deployment (mainly relevant on Path B, where
  Osama already holds admin access) — with reason, time bound, and audit, same as
  before, just scoped to one customer's box instead of one platform

---

## 9. Configuration

- Environment-based. Validated at startup with a schema; the process **fails fast** with
  a clear message if a required variable is missing — never on the first request that
  needs it.
- No `DEPLOYMENT_MODE` switch is needed anymore — every deployment is the same
  single-company shape regardless of hosting path (§3). The only thing that varies by
  environment is ordinary config: database connection, ZATCA sandbox vs. production
  endpoint, Activation Service URL and this deployment's master key.
- `.env.example` documents every variable: purpose, required or optional, default, and
  where the value comes from. The master license key belongs here like any other
  secret — never committed, never logged (`docs/09-SECURITY-RULES.md` §1).

---

## 10. Pre-first-customer checklist

```
[ ] Backups configured AND a restore actually performed successfully, for whichever
    hosting path this first customer is on
[ ] Ledger integrity suite green against the performance fixture
[ ] ZATCA sandbox end-to-end verified, including failure and retry paths
[ ] Local key custody (this deployment's own ZATCA keys) implemented, reviewed, and
    documented — not centrally custodied, see docs/09-SECURITY-RULES.md §5
[ ] Activation Service check-in, offline grace period, and lockout behavior tested
    end to end, including "Activation Service is unreachable" (§11)
[ ] Local print/hardware agent installed and tested against the actual hardware this
    customer uses, if they need it
[ ] Alerting live and verified by triggering a real alert
[ ] Rollback procedure tested on staging
[ ] Install runbook executed end to end (§8)
[ ] docs/SECURITY.md threat model written
[ ] Both locales complete on every Tier-1 screen, RTL verified
[ ] If this customer is on Path B (operated cloud account): Osama's admin access is
    documented and logged per docs/09-SECURITY-RULES.md §3
```

---

## 11. Activation Service operations

This is Osama's own standing infrastructure, not part of any customer deployment
(`docs/00-PRODUCT-BRIEF.md` §8). Its own operational bar:

- It is a **small, simple service** — resist the temptation to make it as elaborate as
  the main product. It issues/validates license keys and nothing else.
- **Its own downtime must degrade every customer's deployment gracefully, never
  abruptly.** This is the whole point of the offline grace period
  (`docs/01-OPEN-DECISIONS.md` A5) — treat any design that makes a customer's
  accounting software stop working the moment this service is unreachable as a defect
  in the Activation Service, not an acceptable tradeoff.
- Still needs its own backups (it is the only record of who has a valid license) and
  its own access logging, at a scale proportional to what it actually holds (§2 of
  `docs/03-MULTI-TENANCY-RULES.md`).
- Alerting: check-in failure spikes across many deployments at once likely means the
  Activation Service itself is down, not that many customers went offline
  simultaneously — alert on that pattern specifically.
