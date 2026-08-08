# 0004 — Foundation phase: auth backend

## What was done

- **Prisma schema**: `User`, `Role`, `Permission`, `RolePermission` (join table), `RefreshToken`. Soft delete via `deletedAt` on `User` (never hard-deleted). Role/Permission modeled now even though only one guard uses it today, since retrofitting this schema later is far more expensive than adding it now — matches the plan's "permission matrix per module/action" requirement.
- **`PrismaService`** (`apps/api/src/prisma/`): uses the Prisma 7 driver-adapter pattern (`@prisma/adapter-pg` + `PrismaPg`), matching the `prisma.config.ts` approach already in place from the scaffold. Registered as a global module so any future module can inject it without re-importing.
- **`AuthModule`** (`apps/api/src/auth/`): `POST /auth/login`, `/refresh`, `/logout`, `GET /auth/me` (JWT-guarded). Passwords hashed with argon2. Refresh tokens are opaque random strings — only their SHA-256 hash is ever stored — with rotation-on-use (each refresh revokes the old token and issues a new pair), so a stolen refresh token can't be replayed indefinitely.
- **Shared Zod schemas** (`packages/shared/src/schemas/auth.ts`): `LoginRequestSchema`, `RefreshRequestSchema`, `AuthUserSchema`, `LoginResponseSchema` — wrapped as NestJS DTOs via `nestjs-zod`'s `createZodDto`, and the same schemas will validate the desktop app's login form later, so the two sides can't drift.
- **`ZodValidationPipe`** registered globally in `AppModule` (`APP_PIPE`) so DTO validation actually runs on every request, not just DTOs that opt in.
- **Seed script** (`apps/api/prisma/seed.ts`, run via `pnpm prisma:seed`): creates the five roles from the plan (Admin, Accountant, Warehouse Staff, Purchasing Officer, HR), a couple of example permissions wired to Admin, and an admin user from `ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD` (defaults documented in `.env.example`, dev-only).
- **Unit tests** (`auth.service.spec.ts`): 11 cases covering login success/failure paths, refresh-token expiry/revocation/rotation, and logout — using a mocked `PrismaService` but *real* argon2 hashing, so the actual password-verification logic is genuinely exercised, not just the control flow around it. No live database needed for these to pass.

## Bugs found and fixed along the way

- **`tsconfig.json` `rootDir`**: Prisma's newer `prisma-client` generator (vs. the older `prisma-client-js`) ships full `.ts` source alongside compiled output, not just `.d.ts`. With `rootDir: "src"` set, TypeScript refused to compile (`TS6059`) once `PrismaService` imported the generated client from outside `src/`. Fixed by widening `rootDir` to `"."` (the whole `apps/api` folder, covering both `src/` and `generated/`) — which also meant `nest build`'s output moved from `dist/main.js` to `dist/src/main.js`; updated the `start` script to match.
- **ESLint was linting the generated Prisma client** (thousands of lines, not ours to fix) once it became reachable from `src/` — added `generated/**` to `apps/api/eslint.config.js`'s ignores.

## Why

Continuing the build per the plan's Foundation phase — auth is the first real piece since almost everything else (navigation, permissions, every future module) depends on having a logged-in user.

## How to verify it

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # all pass
```

Not yet verified end-to-end against a live database (Docker/Postgres is still pending — see 0003's follow-ups). Once it's up:

```bash
pnpm --filter @erp/api prisma:migrate   # creates the tables
pnpm --filter @erp/api prisma:seed      # creates roles + admin user
# POST /auth/login with the seeded admin email/password should return tokens
```

## Follow-ups

- No frontend yet: no login screen, no Zustand auth store, no base navigation shell. That's the natural next chunk, but it can't be meaningfully tested end-to-end until there's a live database to actually log into.
- No `RolesGuard`/`PermissionsGuard` yet — only `JwtAuthGuard` (is-logged-in) exists. Fine-grained role/permission enforcement gets built alongside the first endpoint that actually needs it, rather than speculatively now.
- `/auth/me` returns the raw JWT payload, not a fresh DB lookup — fine for now (payload has everything the UI needs), but worth revisiting if a user's role changes mid-session and should take effect before their access token expires.
