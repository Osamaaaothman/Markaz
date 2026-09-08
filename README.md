# ERP-Lite

A commercial accounting/ERP system for the Saudi + Gulf market. See
[`docs/00-PRODUCT-BRIEF.md`](docs/00-PRODUCT-BRIEF.md) for what this is, and
[`CLAUDE.md`](CLAUDE.md) for the operating rules governing this repository.

**Delivery model:** one-time purchase, fully isolated deployment per customer (own
database, own backend), hosted on the customer's own hardware or on a cloud account
they own and Osama operates — see
[`docs/adr/0002-drop-saas-single-purchase-per-customer-deployment.md`](docs/adr/0002-drop-saas-single-purchase-per-customer-deployment.md).

## Status

Milestone **M0 — Repository foundation** (see
[`docs/14-MILESTONES.md`](docs/14-MILESTONES.md)). No business logic yet — this is
tooling and structure only.

## Repository layout

```
apps/
  api/            NestJS backend
  web/            React + Vite + PrimeReact frontend
  print-agent/    Local hardware/printer helper (installed only where needed)
packages/
  core/           The five mandatory integration contracts
  modules/        inventory / purchasing / sales (added starting M4)
  compliance/     contract (country-agnostic) + zatca-sa
  shared/         Money, dates, errors — shared across the backend
  db/             Prisma schema, migrations, seeds
docker/           Nginx config and other container assets
docs/             The rules pack — read before touching anything
```

## Getting started (local development)

```bash
npm install
docker compose up -d
```

Migrations are a separate, explicit step (never automatic on API startup):

```bash
npm run migrate:deploy --workspace=@erp/db
```

## Rules

Everything of substance is in [`docs/`](docs/) — read the whole folder before making
architectural changes. Open decisions blocking specific milestones are tracked in
[`docs/01-OPEN-DECISIONS.md`](docs/01-OPEN-DECISIONS.md).
