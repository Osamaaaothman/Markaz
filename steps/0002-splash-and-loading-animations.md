# 0002 — Splash screen, loading overlay, fatal-error screen, animation strategy

## What was done

- **Animation Strategy** documented in the plan (`Animation & Loading Strategy` section): Motion for everyday React UI motion (modals, transitions, micro-interactions — tied to component state), GSAP reserved for choreographed "hero" moments (the boot splash). Decided after asking about library tradeoffs and scope rather than picking unilaterally. Loading UI picks the right pattern per situation: full-screen GSAP splash on boot, a generic Motion-based `LoadingOverlay` for indeterminate waits, Mantine's built-in `Skeleton` reserved for real list/table content once it exists.
- **`SplashScreen`** (`apps/desktop/src/renderer/src/components/SplashScreen.tsx`) — GSAP timeline animating the Markaz mark on every launch: tile scales in with an overshoot ease, the M-mark draws itself via `DrawSVGPlugin`, the wordmark fades up, then the whole thing fades out and hands off to the app shell. Built with `@gsap/react`'s `useGSAP()` hook (scoped, auto-cleanup) per GSAP's own React guidance — installed as Claude Code skills from `greensock/gsap-skills`. **First pass added a backdrop glow, a diagonal shine sweep, and per-letter `SplitText` reveal — explicitly reverted** after user feedback ("minimal and drawable, not more glow and cringe things"). Kept: scale-in + draw-on + fade, nothing decorative. This preference is now saved in memory for future work.
- **`LoadingOverlay`** (`apps/desktop/src/renderer/src/components/LoadingOverlay.tsx`) — generic, reusable Motion-based loading state (fade enter/exit, pulsing brand mark) for any indeterminate async wait.
- **`FatalErrorScreen` + `ErrorBoundary`** (`apps/desktop/src/renderer/src/components/`) — full-page takeover reserved specifically for errors that make the app genuinely unusable, per explicit direction: *"this page only when the error make the app like useless... if it can be useful dont redirect to that."* Real, current trigger is a top-level React error boundary catching uncaught render crashes (wraps `AppShell` in `App.tsx`). The API-unreachable case deliberately does **not** use this — it stays as the inline badge + retry in `Shell`, since the rest of the app remains usable without the API.
- **Real usage, not a demo**: `Shell` calls the actual API's `GET /health` via TanStack Query (`apps/desktop/src/renderer/src/lib/api.ts`) on boot — `LoadingOverlay` while pending, a badge for connected/error + retry.
- **i18n gap fixed**: the health-check badge text, retry button, and scaffold notice were hardcoded English when first written — caught and fixed after the user's explicit "I want to make all things Arabic and English even errors so dont forget that." All of it now runs through `t()` with `en.json`/`ar.json` entries, including the new error screen's title/description. Saved as a standing memory so this doesn't get missed again on future components.
- **App icon**: `branding/icon.svg` rasterized to a 512×512 PNG (`apps/desktop/resources/icon.png`) using Electron's own offscreen renderer (`apps/desktop/scripts/generate-icon.mjs`) rather than adding an image-processing dependency. Wired as the `BrowserWindow` icon.
- **Test coverage added**: `@testing-library/react` + `jest-dom` wired into the Vitest setup (`apps/desktop/src/renderer/src/test/setup.ts`, including a jsdom `matchMedia` polyfill Mantine needs). `ErrorBoundary.test.tsx` verifies a thrown render error shows the fallback and that retry recovers.

## Why

The user asked for the logo to actually show up in the running app, for the splash/loading screens to be well-crafted, and for a dedicated fatal-error page — but scoped narrowly (only for truly blocking errors), and for the whole app including error states to be bilingual. All addressed above; two of these came from mid-flight corrections that are now captured as standing memories so they generalize to future work, not just this one component.

## Environment notes (matters for future sessions)

- **GUI apps need `dangerouslyDisableSandbox: true`** when launched via this session's Bash tool — without it, Electron's process starts but never actually opens a window on the real Windows desktop session (no error, just silently no window).
- **DrawSVGPlugin and SplitText are free** as of GSAP's Webflow acquisition — no club/license key needed, just `import from "gsap/DrawSVGPlugin"` etc. from the public `gsap` package (SplitText is registered but currently unused after the splash simplification).
- Docker Desktop was not running (the reported "database connection" error) — started it; first boot takes a couple of minutes.
- jsdom has no `matchMedia` — any test that mounts a `MantineProvider` needs the polyfill in `test/setup.ts`.

## How to verify it

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # all pass, all workspaces
pnpm --filter @erp/desktop dev                            # launches Electron; splash plays, then health badge
```

Manually confirmed: Electron launches, the API's `/health` responds, the app icon renders in the window/taskbar, and the reverted splash matches the minimal version the user approved.

## Follow-ups

- Run `docker compose -f infra/docker-compose.yml up -d` once Docker Desktop is fully up, so `prisma migrate dev` has a database to talk to.
- Full `.ico` packaging verification (`pnpm --filter @erp/desktop package`) — in progress as part of the next step (packaged build + an easy local dev launcher).
- Still committing directly to `main` during this rapid bootstrap/demo phase — the `feat/<name>` + PR convention from the plan kicks in starting with the Foundation phase / first real module work.
