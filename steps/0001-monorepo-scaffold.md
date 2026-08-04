# 0001 — Monorepo scaffold

## What was done

Bootstrapped the repository from scratch as a pnpm + Turborepo monorepo:

- **Root:** `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.gitignore`, shared Prettier config.
- **`packages/config`** — shared `tsconfig.base.json`, ESLint flat config base, Prettier base config, consumed by every other workspace.
- **`packages/shared`** — placeholder package for cross-app TS types/DTOs/Zod schemas (populated starting with Foundation-phase auth).
- **`apps/api`** — NestJS backend skeleton: `/health` endpoint, Swagger docs at `/docs` (via `nestjs-zod`'s `cleanupOpenApiDoc`), Prisma wired for PostgreSQL via the v7 driver-adapter model (`@prisma/adapter-pg`), Jest unit + e2e test setup.
- **`apps/desktop`** — Electron + React + TypeScript + Vite (via `electron-vite`) skeleton: Mantine theme (custom brand palette, dark mode support), `DirectionProvider` wired for live RTL switching, `react-i18next` with EN/AR resources, Zustand UI store, TanStack Query provider, a `react-hotkeys-hook`-based shortcut registry starting point, Vitest unit test setup, `electron-builder` config for a Windows NSIS installer.
- **`infra/docker-compose.yml`** — local PostgreSQL 17 for development.
- **`.github/workflows/ci.yml`** — GitHub Actions running lint, typecheck, test, and build on every PR into `main`, against a real Postgres service container.
- **`README.md`** — local setup instructions.

## Why

This is the Foundation-phase prerequisite from the build plan: get the full toolchain (desktop shell, backend, shared types, database, CI) wired and provably working end-to-end before any business logic is written, so later modules are additive instead of fighting the scaffold.

A few decisions worth recording because they weren't obvious going in:

- **Dependency versions were checked against the live npm registry, not assumed from memory** — the ecosystem has moved: NestJS 11, Prisma 7, React 19, Mantine 9, TypeScript 5.9 (pinned below the new native TS7 compiler because `typescript-eslint` and `ts-jest` don't support it yet), Vite 7 (pinned below Vite 8 because `electron-vite@5` doesn't support it yet).
- **Prisma 7 changed how the database connection works**: `datasource.url` in `schema.prisma` is no longer supported. The connection string now goes through a driver adapter (`@prisma/adapter-pg`) passed to the `PrismaClient` constructor at runtime, plus a separate `prisma.config.ts` for the CLI (migrate/studio). The schema currently has zero models by design — those start in the Foundation-phase auth work.
- **`nestjs-zod`'s Swagger integration changed API shape**: it's `cleanupOpenApiDoc(document)` (post-processes the generated OpenAPI doc), not the older `patchNestJsSwagger()` global-patch approach.
- **Electron no longer downloads its binary via a postinstall script** — newer `electron` versions lazily download it the first time the package is required (i.e., on first `pnpm dev`/`pnpm start` in `apps/desktop`), not during `pnpm install`. First run of the desktop app will pause to download it.
- **A local machine-specific issue, not a repo issue**: this Windows machine's `corepack` has a broken signature-verification bug that shadows a working `pnpm` install on PATH. Worked around per-session; documented in the README as a one-time `corepack disable` fix (needs an elevated terminal, which this session doesn't have).
- **Found and fixed a stale-incremental-build bug**: `apps/api/tsconfig.json` originally had `incremental: true`, which combined with `nest-cli.json`'s `deleteOutDir: true` caused `nest build` to wipe `dist/` and then skip re-emitting it (stale `.tsbuildinfo` said nothing had changed). Removed `incremental` — it wasn't needed for a single, non-composite project anyway.

## How to verify it

```bash
pnpm install
pnpm lint        # passes, 0 errors across all 4 workspaces
pnpm typecheck    # passes
pnpm test         # passes (1 API test, 2 desktop tests)
pnpm build        # passes; apps/api/dist and apps/desktop/out both produced
```

API boots and serves requests once built:

```bash
cd apps/api && node dist/main.js
curl http://localhost:3000/health   # {"status":"ok","timestamp":"..."}
```

`apps/api/prisma:generate` was run manually against a placeholder `DATABASE_URL` and succeeded, confirming the Prisma 7 config is wired correctly.

Not yet verified in this step: actually launching the Electron window (`pnpm dev` in `apps/desktop`) — this wasn't run in this session since it triggers a first-time Electron binary download and opens a real desktop window. Worth doing manually before trusting the desktop shell further.

## Follow-ups

- Run `pnpm dev` in `apps/desktop` manually at least once to confirm the actual window renders, the EN/AR toggle flips direction correctly, and dark mode looks right.
- Foundation phase: Prisma models (User/Role/Permission), auth, base navigation, command palette, Swagger-documented DTOs, GitHub Wiki skeleton.
- The desktop renderer bundle is already ~880KB minified (mostly Mantine) — fine for now, but worth revisiting with code-splitting once there are more screens.
- `main` was committed to directly for this first scaffold commit (nothing to branch from yet). Every commit after this one follows the `feat/<name>` + PR convention.
