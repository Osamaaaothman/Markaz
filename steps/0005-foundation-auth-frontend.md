# 0005 — Foundation phase: auth frontend (login, session, base shell)

## What was done

- **Secure token storage** (`apps/desktop/src/main/secure-storage.ts`): the refresh token is never stored in plain text. Main-process IPC handlers use Electron's `safeStorage` (OS keychain — Keychain/DPAPI/libsecret) to encrypt it before writing to a file in `userData`, exposed to the renderer via the preload's `contextBridge` as `window.api.secureStorage`. If encryption genuinely isn't available on a machine, storage is skipped entirely rather than falling back to plain text — worst case the user logs in again next launch.
- **`useAuthStore`** (Zustand): `hydrate()` (resume session from the stored refresh token on boot), `login()`, `logout()`. Access tokens stay in memory only (short-lived by design); only the refresh token persists.
- **`LoginScreen`**: React Hook Form validated against the *shared* `LoginRequestSchema` (same schema the backend validates against), but with our own translated error messages rather than Zod's default English text — the schema is the single source of truth for what's valid, the messages are ours.
- **Base app shell**: Mantine `AppShell` with a header (mark, connection status, locale toggle, user menu with logout) replacing the placeholder page. No sidebar/nav yet — deliberately not building links to modules that don't exist; that lands with Inventory (the first real module).
- **Boot flow** (`App.tsx`): splash → `hydrate()` (started in parallel with the splash animation, not after, so there's no extra loading flash once it finishes) → `LoginScreen` if unauthenticated, `AuthenticatedLayout` if a session was resumed or a login succeeds.
- **Tests**: 6 new cases for `useAuthStore` (hydrate success/failure/no-token, login success/failure, logout) with the secure-storage bridge and API client mocked.

## Real bugs found and fixed (all caught by actually running the build/app, not just eyeballing code)

1. **`packages/shared` couldn't survive gaining a second file.** It was consumed as raw `.ts` (no build step) via Node's native TypeScript execution, which worked for a single-file placeholder but broke the moment `index.ts` needed a relative import (`./schemas/auth`) — Node's native TS execution requires explicit extensions on relative imports, which TypeScript's `allowImportingTsExtensions` option would allow, but only in programs configured with `noEmit` — and both `apps/api` and `apps/desktop` need real emit. **Fixed** by giving `packages/shared` an actual build step, initially compiled to CommonJS.
2. **CommonJS `export *` broke the production build.** TypeScript compiles `export * from "./x"` to CommonJS as a runtime `for...in` loop over the required module's keys — which Rollup (Vite's production bundler) can't statically analyze, so it couldn't see `LoginRequestSchema` as a named export at all. This only surfaced in `pnpm build` (Rollup), not `pnpm dev` (esbuild, more lenient) — a reminder that dev-server success doesn't guarantee a production build works. **Fixed** by compiling `packages/shared` to real ESM (`module`/`moduleResolution: NodeNext`) instead — Rollup understands static ESM `export *` natively, and this also resolves bug #1 properly (NodeNext requires and TypeScript correctly emits `.js`-suffixed relative imports in compiled output).
3. **`window.api`'s ambient type wasn't visible to the renderer.** The `declare global { interface Window }` augmentation lived in `src/preload/index.d.ts`, which is only included by the main-process TS program (`tsconfig.node.json`), not the renderer's separate program (`tsconfig.web.json`) — so `useAuthStore.ts` failed to typecheck the moment it referenced `window.api`. Fixed by adding that file to `tsconfig.web.json`'s `include` too.
4. **`turbo.json`'s `dev` task didn't depend on `^build`.** Once `packages/shared` needed a build step, `nest start --watch` / `electron-vite dev` would fail if run before that build existed. Added `dependsOn: ["^build"]` to the `dev` task.

None of these would have been caught by code review alone — #2 specifically only showed up under the production bundler, not the dev server.

## Verification method note

Tried to get true visual/console confirmation of the running Electron window (not just the bare Vite dev-server tab, which lacks the preload-injected `window.api` and so isn't representative) by enabling `--remote-debugging-port` and connecting the Browser pane to Electron's real CDP target. The DevTools frontend loaded as a page rather than giving direct programmatic access to the target's console/DOM, and chasing that further had diminishing returns — reverted the temporary debug flag. Confidence instead comes from: the production build succeeding (the strictest check available), all 20 tests passing, the API verified end-to-end over HTTP, and the Electron process staying up without crashing. Visual confirmation of the actual rendered UI still needs a human looking at the screen.

## How to verify it

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # all pass
pnpm --filter @erp/api dev        # boots fine even without Postgres
pnpm --filter @erp/desktop dev    # splash -> login screen
```

Full login can't be exercised end-to-end yet without Postgres running (`docker compose up` + `prisma:migrate` + `prisma:seed`), but the API gracefully 500s on DB-touching requests rather than crashing, and Zod validation (400s) works without touching the DB at all.

## Follow-ups

- No `authenticatedFetch`-with-auto-refresh wrapper yet — nothing needs it until the first module fetches protected data. Build it then, not speculatively now.
- No sidebar/module navigation yet — arrives with Inventory.
- Docker/Postgres still pending (user's own call, on hold).
