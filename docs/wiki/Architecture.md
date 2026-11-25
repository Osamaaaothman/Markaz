# 🏛️ Architecture & Data Integrity

> **Boring where it counts.** A modular monolith on PostgreSQL where the database — not just the
> code — guarantees that the books balance, history is permanent and money is exact.

[← Wiki home](Home.md) · [Getting started →](Getting-Started.md)

---

## The stack

| Layer | Technology |
|---|---|
| Web | React 18 · TypeScript · Vite · PrimeReact · react-i18next · TanStack Query |
| API | NestJS 12 · TypeScript (`strict`, no `any`) |
| Database | PostgreSQL · Prisma |
| Jobs | BullMQ on Redis (worker process) |
| AI | LangGraph engine with Anthropic / OpenAI / Google / Ollama providers |
| Tooling | Turborepo · ESLint · dependency-cruiser · commitlint · Docker Compose |

## Repository layout

```
apps/
  api/            NestJS API: composes every module, HTTP + SSE + MCP endpoints
  web/            React single-page app (PWA)
  print-agent/    Reserved for a localhost hardware helper (not yet implemented)
packages/
  core/           Accounting, inventory, purchasing, sales, payments, HR, fixed assets,
                  identity, audit, approvals, attachments, outbox
  shared/         Money, dates and errors shared across the backend
  db/             Prisma schema, hand-written migrations, seeds and CoA templates
  compliance/     Country-agnostic contract + the Saudi (ZATCA) pack
  ai/             Assistant engine: tools, modes, approvals, safety envelope
  bots/           Telegram and Discord adapters (no ERP knowledge)
docs/             Product brief, rules, ADRs, release runbooks, this wiki
```

## Five Core contracts

Modules never write journal entries, permissions, document numbers or audit records themselves. They
go through five Core contracts:

| Contract | Responsibility |
|---|---|
| `IAccountingEngine` | Modules request a posting; only the engine writes the ledger |
| `IPermissionService` | One set of users, roles and deny-by-default checks |
| `INumberingService` | Gapless, transactional document numbers |
| `IAuditLogger` | One append-only mechanism for every audit record |
| **Unified reporting** | Module data flows into the general financial reports, never an isolated silo |

Module boundaries are enforced in CI by dependency-cruiser.

## Integrity guarantees

| Guarantee | How it's enforced |
|---|---|
| Every entry balances | Deferred constraint trigger: debits = credits in transaction *and* base currency, at commit |
| Closed periods stay closed | Trigger rejects postings into a closed fiscal period |
| History is permanent | Runtime DB role has no `UPDATE`/`DELETE` on journals and audit log; corrections are reversals |
| Money is exact | `Decimal(19,4)` + a `Money` value object (decimal.js, half-up to the currency's minor unit) |
| Numbers have no gaps | Numbering inside the posting transaction |
| No double posting | Idempotency keys and stable submission keys |
| Side effects are reliable | Transactional outbox + BullMQ workers with retries |

## Delivery model

One-time purchase, **one isolated deployment per customer** — its own database and backend, on the
customer's hardware or a cloud account they own. See
[ADR 0002](../adr/0002-drop-saas-single-purchase-per-customer-deployment.md).

## Quality gates

Every push runs lint, module-boundary checks, typecheck, build, tests, **Arabic/English locale key
parity** and a dependency audit. Property-based tests fire random operation sequences at a real
PostgreSQL and assert the trial balance always nets to zero.

## Architecture decision records

| ADR | Decision |
|---|---|
| [0001](../adr/0001-delivery-model-and-tenant-isolation.md) | Delivery model and tenant isolation |
| [0002](../adr/0002-drop-saas-single-purchase-per-customer-deployment.md) | Single purchase, per-customer deployment |
| [0003](../adr/0003-money-representation-and-rounding.md) | Money representation and rounding |
| [0004](../adr/0004-zatca-direct-integration.md) | Direct ZATCA integration |
| [0005](../adr/0005-sales-prices-and-provisional-stock-costs.md) | Sales prices and provisional stock costs |

The full rules pack lives in [`docs/`](../) — start with [`00-PRODUCT-BRIEF.md`](../00-PRODUCT-BRIEF.md).
