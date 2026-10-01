# M0 skeleton build. Base image pinned by tag; digest pinning is M10 hardening.
FROM node:22-alpine AS build
WORKDIR /repo
COPY . .
RUN npm ci
# `npx turbo run build --filter=@erp/web` (not `npm run build --workspace=@erp/web`)
# — same fix as apps/api/Dockerfile and for the same reason: turbo.json's
# `dependsOn: ["^build"]` builds @erp/shared FIRST. apps/web started depending on
# @erp/shared in M3 (shared/lib/money.ts, for decimal-safe display formatting) and
# a plain workspace build doesn't know to build it first.
RUN npx turbo run build --filter=@erp/web

# Non-root nginx (nginx:1.27-alpine runs as root by default) is M10 hardening —
# tracked alongside digest pinning, not skipped, just not blocking M0.
FROM nginx:1.27-alpine AS runtime
COPY docker/web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1
