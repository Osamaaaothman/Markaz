#!/bin/sh
# proxy_pass's upstream hostname (API_UPSTREAM) is resolved once, when nginx reads
# its config, not per request. On Railway, api.railway.internal's IP changes
# whenever that service restarts, so a long-lived worker can be left pointing at a
# dead address until something forces a fresh DNS lookup. `nginx -s reload` re-reads
# the config (cheap, zero-downtime) and re-resolves it.
#
# Runs as a docker-entrypoint.d/*.sh script (the official nginx image's own
# entrypoint convention), so it executes before nginx starts and only in the
# background — the official entrypoint still handles envsubst templating and the
# final `exec nginx` itself. A custom CMD can't do this: the entrypoint only runs
# its config steps (including envsubst-on-templates) when $1 is literally "nginx" or
# "nginx-debug", so overriding CMD to a shell wrapper silently skips templating.
( while true; do sleep 60; nginx -s reload 2>/dev/null; done ) &
