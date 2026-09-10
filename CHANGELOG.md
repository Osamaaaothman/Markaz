# Changelog

Every breaking change and every migration is recorded here —
`docs/11-GIT-WORKFLOW.md` §7.

## [Unreleased]

### Added
- M0 repository foundation: npm workspaces + Turborepo monorepo layout, TypeScript strict
  config, ESLint + dependency-cruiser module-boundary rules, Prettier, commitlint,
  a gitleaks-or-fallback pre-commit secret scan, CI (lint/typecheck/build/test/
  boundaries/audit), and the Docker Compose bundle (api, db, redis, worker, web)
  that is the actual per-customer deployment unit.
- Empty package skeletons for `apps/api`, `apps/web`, `apps/print-agent`,
  `packages/core` (five contract type shapes only), `packages/shared`,
  `packages/db` (Prisma tooling, no models yet), `packages/compliance/contract`
  and `packages/compliance/zatca-sa` (both empty placeholders).
- M1: identity, permissions, audit, and the Activation Service client. JWT auth
  with refresh-token rotation and reuse detection; role-based permissions,
  deny-by-default; append-only audit log enforced at the database level (a
  restricted `erp_app` Postgres role with no UPDATE/DELETE grant, separate from
  the schema-owning migration role); license grace-period logic, unit-tested.
- M2: the accounting core. `Money` value object (decimal.js, half-up rounding to
  the currency's minor unit — docs/adr/0003); chart of accounts, fiscal years/
  periods, journal entries with real database-level integrity: a deferred
  constraint trigger enforcing debit==credit (in both transaction and base
  currency) at commit, a closed-period trigger, and the same append-only role
  restriction already proven for audit_log now also covering journal_entries/
  journal_entry_lines. `IAccountingEngine` and `INumberingService` implemented
  for real (gapless, transactional numbering; idempotent posting; mirrored
  reversals that never touch the original entry). Property-based ledger
  integrity test against a real Postgres, plus a minimal HTTP surface (trial
  balance, manual posting, reversal) verified end-to-end through the actual
  Docker Compose stack.

### Fixed
- `docker-compose.yml` had hard-coded placeholder passwords committed directly
  in source (a real docs/09-SECURITY-RULES.md §1 violation introduced in the M0
  commit) — every credential now comes from a git-ignored `.env` via Compose
  substitution.
- `packages/shared`/`packages/core`/`packages/db` published `main`/`types`
  pointing at raw `.ts` source instead of a compiled `dist/`, which only worked
  for TypeScript-aware tooling — a production container running compiled JS
  crashed on startup unable to resolve `@erp/shared`. Fixed by actually building
  these packages and switching the Docker build to `turbo run build` so it
  respects the dependency graph.
- A local-timezone `new Date(y, m, d)` for a calendar-fact field (`@db.Date`)
  serializes to the wrong day on any machine whose local timezone isn't UTC —
  bit an early draft of the M2 integration test. Fixed at the source: the whole
  Node process now runs in UTC (Docker `ENV TZ=UTC` plus a `process.env.TZ`
  fallback), not just the one call site that happened to get caught.
- Turbo's cache didn't know the `test` task's result depends on `DATABASE_URL`,
  so it could silently replay a stale "skipped" result from before the database
  was configured even once it became available. Declared as a cache-key input.
- Two dependency vulnerabilities newly disclosed after the M0/M1 dependency set
  had already audited clean (`multer` via `@nestjs/platform-express`,
  `deepmerge-ts` via prisma's config tooling) — fixed via `overrides`.
