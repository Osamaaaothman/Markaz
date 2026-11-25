# 🚀 Getting Started

> From a fresh clone to a running Markaz with its first company in a few commands.

[← Wiki home](Home.md) · [Architecture →](Architecture.md)

---

## Prerequisites

- **Node.js 22+** and npm
- **Docker** with Docker Compose (PostgreSQL and Redis)
- Git

## 1. Configure

```bash
cp .env.example .env
```

Fill in your own values. The important groups:

| Group | Variables |
|---|---|
| Database | `DATABASE_URL` (runtime role), `MIGRATE_DATABASE_URL` (schema owner) |
| Redis | `REDIS_URL` |
| Auth | `JWT_ACCESS_SECRET` |
| First admin & company | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_COMPANY_NAME`, `SEED_COMPANY_NAME_AR` |
| Email | `EMAIL_PROVIDER` (`smtp` or `resend`) and its settings |
| Attachments | `ATTACHMENT_STORAGE` (local by default) |
| ZATCA | `ZATCA_ENVIRONMENT`, `ZATCA_KEY_ENCRYPTION_KEY` |
| AI assistant | `AI_CREDENTIALS_ENCRYPTION_KEY`, optional provider defaults |
| Chat bots | `BOT_CREDENTIALS_ENCRYPTION_KEY`, `BOTS_PUBLIC_API_URL`, `BOTS_WEB_APP_URL` |

> Never commit `.env`. Encryption keys are 32 random bytes, base64-encoded.

## 2. Install and start the infrastructure

```bash
npm install
docker compose up -d db redis
```

## 3. Migrate and seed

Migrations are an explicit step — never automatic.

```bash
npm run migrate:deploy --workspace=@erp/db
npm run seed --workspace=@erp/db
```

## 4. Run

```bash
npm run dev
```

| Service | URL |
|---|---|
| Web app | http://localhost:5173 |
| API | http://localhost:3000 |

Sign in with the seeded admin and follow the **First-run setup** checklist: company profile, fiscal year,
chart of accounts, account mapping.

## Production with Docker Compose

`docker-compose.yml` defines the complete per-customer deployment unit: `db`, `redis`, `api`, `worker`
and `web` (Nginx serving the SPA and proxying `/api`). Apply migrations with the schema-owner role before
deploying the API, worker and web from the same commit. Release runbooks live in
[`docs/releases/`](../releases/).

## Useful scripts

| Command | Does |
|---|---|
| `npm run dev` | API and web in watch mode |
| `npm run test` | All test suites |
| `npm run lint` | ESLint across the monorepo |
| `npm run typecheck` | TypeScript `strict` check |
| `npm run boundaries` | Module-boundary rules (dependency-cruiser) |
| `npm run build` | Production build of every package |
