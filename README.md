# Markaz — ERP-Lite for Saudi & Gulf businesses

![CI](https://github.com/Osamaaaothman/Markaz/actions/workflows/ci.yml/badge.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-API-E0234E?logo=nestjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-ledger-4169E1?logo=postgresql&logoColor=white)
![React](https://img.shields.io/badge/React-PrimeReact-61DAFB?logo=react&logoColor=black)

A commercial accounting and ERP product for small, medium and large businesses in Saudi Arabia,
then the wider Gulf. Arabic and English from day one, with full RTL and LTR, not a later translation pass.

**Delivery model:** one-time purchase, with a fully isolated deployment per customer (own database,
own backend), hosted on the customer's own hardware or on a cloud account they own. See
[`docs/adr/0002-drop-saas-single-purchase-per-customer-deployment.md`](docs/adr/0002-drop-saas-single-purchase-per-customer-deployment.md).

## What works today

| Area | Included |
|---|---|
| **Accounting** | Chart of accounts, fiscal years and periods, journal entries, reversals, trial balance, balance sheet, income statement, CSV/PDF export |
| **Inventory** | Warehouses, items with pictures, stock movements and history, weighted-average valuation |
| **Purchasing** | Requests, orders, receiving, supplier invoices with three-way matching, tax codes |
| **Sales** | Quotations, orders, invoices, credit notes, invoice PDF |
| **Payments** | Customer receipts and supplier payments with allocation to invoices |
| **Reports** | Receivables and payables ageing, customer and supplier statements, dashboard |
| **Platform** | Users, roles and permissions, audit log, approvals, attached documents, bilingual email and PDF |

## Engineering highlights

- **The database guards the ledger.** A deferred constraint trigger requires debits to equal credits
  (in both transaction and base currency) at commit, and another rejects posting into a closed period.
- **Append-only history.** Journals and the audit log are written through a restricted Postgres role
  with no `UPDATE` or `DELETE` grant, separate from the role that owns the schema.
- **Money done properly.** A `Money` value object on decimal.js with half-up rounding to each currency's
  minor unit ([ADR 0003](docs/adr/0003-money-representation-and-rounding.md)); gapless, transactional document numbering.
- **Secure by default.** JWT with refresh-token rotation and reuse detection; permissions stored as data, deny by default.
- **Reliable side effects.** BullMQ workers on Redis, the outbox pattern and idempotency keys.
- **Tested where it matters.** Property-based tests run random operation sequences against a real
  Postgres and assert the trial balance always nets to zero.
- **Enforced boundaries.** CI runs lint, module-boundary checks (dependency-cruiser), typecheck, build,
  tests, Arabic/English locale key parity and a dependency audit on every push.

## Architecture

A modular monolith in a Turborepo monorepo: one deployable API with strong internal module boundaries.

```
apps/
  api/            NestJS API that composes every module
  web/            React + TypeScript + Vite + PrimeReact
  print-agent/    Small localhost helper for printers and devices, installed only where needed
packages/
  core/           Accounting, inventory, purchasing, sales, payments, identity, audit, approvals, outbox
  shared/         Money, dates and errors shared across the backend
  db/             Prisma schema, migrations and seeds
  compliance/     Country-agnostic contract + the Saudi (ZATCA) pack, in progress
docker/           Nginx config and container assets
docs/             Product brief, architecture rules, ADRs and milestones
```

## Roadmap

| Milestone | Status |
|---|---|
| M0 Foundation · M1 Identity · M2 Accounting core · M3 Platform services | Done |
| M4 Inventory · M5 Purchasing · M6 Sales & AR | Done |
| M9 Frontend completion | In progress |
| M7 ZATCA e-invoicing · M8 Licensing & activation · M10 Hardening | Next |

Full plan: [`docs/14-MILESTONES.md`](docs/14-MILESTONES.md).

## Getting started

```bash
cp .env.example .env      # fill in your own values
npm install
docker compose up -d
npm run migrate:deploy --workspace=@erp/db   # migrations are an explicit step, never automatic
```

Useful scripts: `npm run dev`, `npm run test`, `npm run lint`, `npm run typecheck`, `npm run boundaries`.

## Docs

Everything of substance lives in [`docs/`](docs/): read it before making architectural changes.
Open decisions are tracked in [`docs/01-OPEN-DECISIONS.md`](docs/01-OPEN-DECISIONS.md).

## Author

Built by [Osama Othman](https://os4ma.me), Full-Stack Software Engineer in Riyadh.
