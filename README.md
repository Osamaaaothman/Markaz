<img src="branding/wordmark.svg" alt="Markaz" width="220" />

A full-stack, offline-capable desktop ERP system: Electron + React desktop
client, NestJS API, PostgreSQL. Bilingual (EN/AR, full RTL). See the
[GitHub Wiki](../../wiki) for architecture, module docs, and setup details —
this README only covers getting it running locally.

## Prerequisites

- Node.js 20+ (developed against 22)
- pnpm (`npm install -g pnpm`)
- Docker (for local PostgreSQL)

> **Windows note:** if `pnpm` fails with a `corepack`/"Cannot find matching
> keyid" error, that's a broken corepack shim shadowing a working pnpm
> install, not a real problem with this repo. Fix it once with an elevated
> PowerShell: `corepack disable`.

## Getting started

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d
cp apps/api/.env.example apps/api/.env
pnpm --filter @erp/api prisma:generate
pnpm dev
```

- API: http://localhost:3000 (Swagger docs at `/docs`)
- Desktop app launches as an Electron window (first run downloads the
  Electron binary, which can take a while)

## Common commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run every app in dev/watch mode |
| `pnpm lint` | Lint all workspaces |
| `pnpm typecheck` | Type-check all workspaces |
| `pnpm test` | Run unit tests in all workspaces |
| `pnpm build` | Production build of all workspaces |

## Repo layout

```
apps/desktop   Electron + React + Mantine + Zustand frontend
apps/api       NestJS backend
packages/shared  Shared TS types, DTOs, Zod schemas
packages/config  Shared eslint/tsconfig/prettier config
infra/         docker-compose for local Postgres
steps/         numbered build log — what was done, in order
```

## Contributing

Work happens on `feat/<name>` branches, merged to `main` via reviewed PRs.
