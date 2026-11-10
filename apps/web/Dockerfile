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
# API_UPSTREAM defaults to the docker-compose service DNS name; override it
# (e.g. on Railway, to api.railway.internal:3000) via a container env var —
# nginx's built-in entrypoint step envsubst's *.template into conf.d on start.
ENV API_UPSTREAM=api:3000
COPY docker/web.nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1

# proxy_pass's hostname (API_UPSTREAM) is resolved once, when nginx reads its config —
# not per request. On Railway, api.railway.internal's IP changes whenever that service
# restarts/redeploys, so a long-lived nginx worker can be left pointing at a dead
# address until something forces a fresh DNS lookup. `nginx -s reload` re-reads the
# config (cheap, zero-downtime) and re-resolves it, so reloading every minute in the
# background keeps the upstream address current without touching request handling.
# Keeps the base image's default ENTRYPOINT (docker-entrypoint.sh), which still runs
# envsubst-on-templates before this CMD is exec'd.
CMD ["/bin/sh", "-c", "( while true; do sleep 60; nginx -s reload 2>/dev/null; done ) & exec nginx -g 'daemon off;'"]
