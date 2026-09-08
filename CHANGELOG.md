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
