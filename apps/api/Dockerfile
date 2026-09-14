# M0 skeleton build. Base image is pinned by tag, not yet by digest — pinning by
# digest is a pre-launch hardening task (docs/14-MILESTONES.md M10), done by actually
# pulling and inspecting the image at that time rather than guessing a hash here.
#
# Simplification note: copies the WHOLE built repo (all workspaces, root + nested
# node_modules) into the runtime image rather than selectively copying just @erp/api's
# pieces — npm workspaces doesn't always fully hoist to root node_modules (e.g.
# @nestjs/core landed nested under apps/api/node_modules here), and guessing which
# dirs to selectively copy silently breaks module resolution. Optimizing image
# size/build-cache layering is a later hardening task (M10), not a blocker for the
# M0 gate (a working `docker compose up -d`).
FROM node:22-alpine AS build
WORKDIR /repo
COPY . .
RUN npm ci
# `npx turbo run build --filter=@erp/api` (not `npm run build --workspace=@erp/api`)
# on purpose — turbo.json declares build's `dependsOn: ["^build"]`, so this also
# builds @erp/shared/@erp/core/@erp/db FIRST. Skipping this bit real: those packages
# publish `main`/`types` pointing at their OWN dist/ output now (not raw .ts source),
# and Node's runtime module resolution cannot execute TypeScript source the way tsc
# or ts-jest can — a plain `npm run build --workspace=@erp/api` produced a container
# that crashed on startup unable to resolve `@erp/shared`'s compiled files.
RUN npx turbo run build --filter=@erp/api

# M3: the worker renders PDFs via Playwright/Chromium (apps/api/src/documents) —
# Playwright's bundled Chromium is built against glibc and does not run on Alpine's
# musl libc (confirmed against Playwright's own docs, not assumed), so the runtime
# base switches to a Debian slim image here. api and worker share this one image
# (docker-compose.yml — same Dockerfile, different command), so the API container
# carries Chromium too even though it never renders a PDF itself; splitting into
# two images to avoid that is an M10 image-size optimization, not a correctness
# requirement.
FROM node:22-bookworm-slim AS runtime
# docs/04-DATA-MODEL-RULES.md §3: the whole process runs in UTC — a local-timezone
# Date constructor for a calendar-fact field (`@db.Date`) serializes to the wrong
# day on any container whose local timezone isn't UTC otherwise.
ENV TZ=UTC
# fonts-noto-core: Arabic script coverage (Noto Sans/Naskh Arabic) — without this,
# Chromium falls back to a font with no Arabic glyphs and the PDF renders boxes
# instead of text (docs/08-FRONTEND-I18N-RULES.md §5: "choose fonts with proper
# Arabic support"). --with-deps installs Chromium's own OS-level dependencies.
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd -r app && useradd -r -g app -m app
WORKDIR /repo
COPY --from=build /repo /repo
# Installed directly to the app user's own cache dir (set before install, so
# nothing needs moving/re-chowning afterward) — `npx playwright install --with-deps`
# needs root for the apt-get half, so this still runs before USER app below.
ENV PLAYWRIGHT_BROWSERS_PATH=/home/app/.cache/ms-playwright
RUN mkdir -p "$PLAYWRIGHT_BROWSERS_PATH" && chown -R app:app /home/app/.cache \
  && npx playwright install --with-deps chromium \
  && chown -R app:app /home/app/.cache
USER app
WORKDIR /repo/apps/api
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
