# 0003 — Packaged installer, easy launcher, branding fixes, Docker diagnosis

## What was done

- **Branding fixes**: `electron-builder.yml` (`productName`/`appId`), the Electron `BrowserWindow`'s app-user-model ID, the renderer's `<title>`, and the Swagger API title were all still "ERP" — set before the name "Markaz" was picked. All updated for consistency; rebuilt and repackaged after the fix.
- **Packaged Windows installer**: `pnpm --filter @erp/desktop package` now produces `apps/desktop/release/Markaz-0.0.0-setup.exe` (NSIS, ~106MB, correct icon/name throughout — `Markaz.exe` in the unpacked app, proper `.ico` auto-derived by electron-builder from `resources/icon.png`). Delivered directly to the user. It's a real, standalone-launchable app now, but still expects the API reachable at `localhost:3000` — it does not bundle the backend (by design, per the client-server LAN architecture), so the API (and eventually Postgres) still need to be running alongside it.
- **`start.bat`**: one-double-click local dev launcher — starts Postgres via Docker (best-effort, skips gracefully if Docker isn't up), then `pnpm dev` for the API + desktop app together. Prefers the direct `%APPDATA%\npm\pnpm.cmd` path over bare `pnpm` to sidestep the same corepack shim bug documented in 0001, since this script also runs in the user's own shell where that bug is equally present.
- **Docker Desktop troubleshooting**: user hit a "database connection" error because Docker Desktop wasn't running. Starting it repeatedly failed/crashed with `initializing Inference manager: ... The filename, directory name, or volume label syntax is incorrect` — traced to two corrupted NTFS reparse-point files (Unix-domain-socket implementations) left over in `%LOCALAPPDATA%\Docker\run` after a factory reset, that neither `rm`, `del`, `Remove-Item -Force`, nor `fsutil reparsepoint delete` could remove directly (all failed identically with "file cannot be accessed by the system"). Fixed by renaming the whole `run` directory instead of deleting the individual files (`Rename-Item` succeeded where `Remove-Item` didn't) — Docker recreates it clean on next launch. User asked whether this was a corporate/EDR restriction: checked for known EDR agents (CrowdStrike, SentinelOne, etc.) — none found, only stock Windows Defender — so this looks like an environment/NTFS quirk from the interrupted reset, not a deliberate IT block. User asked to pause further Docker work for later, so the engine readiness wasn't fully re-verified after this fix.

## Why

User asked for something they could "just click to use" (the installer) and an easy way to run the server (`start.bat`), plus wanted the branding-name inconsistency and the Docker error resolved or at least explained.

## How to verify it

```bash
pnpm --filter @erp/desktop package   # produces apps/desktop/release/Markaz-0.0.0-setup.exe
```

Run the installer, confirm the app installs and launches as "Markaz" with the correct icon. Double-click `start.bat` from the repo root to confirm the one-click dev flow starts the API and desktop app (Postgres too, once Docker is back up).

## Follow-ups

- Re-verify Docker engine actually comes up cleanly next time (`docker info`) — the reparse-point fix was applied but not confirmed against a fully healthy `docker compose up`.
- The packaged app currently hardcodes `http://localhost:3000` as the API URL (same as dev) — becomes a configurable setting once the Foundation-phase settings module exists, which matters once this is actually distributed beyond one machine.
- electron-builder emitted a "duplicate dependency references" notice during packaging — cosmetic/non-blocking so far, but worth a look if the packaged bundle size or behavior ever looks off.
