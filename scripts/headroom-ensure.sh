#!/bin/sh
# Ensure headroom proxy is running on 127.0.0.1:<port>.
# Register as a SessionStart hook (matcher "startup", timeout 120).
#
# Upstream: HEADROOM_UPSTREAM env, default https://api.anthropic.com.
# For Anthropic-compatible endpoints (kimi, litellm, sub2api, ...):
#   set HEADROOM_UPSTREAM=https://your-endpoint before launching the agent.
#
# Multi-instance: each profile needs its own port AND its own --memory-db-path
# to avoid SQLite lock conflicts. Without separate DB paths, the second
# instance crashes silently within seconds (observed on Headroom 0.34).
#
# Pitfalls handled:
# - hooks run with a minimal PATH -> absolute path to headroom.exe
# - first start loads models (~60-90s) -> poll readyz instead of fixed sleep
# - multiple instances sharing default DB path -> crash (use HEADROOM_DB_PATH)

PORT="${HEADROOM_PORT:-8787}"
READYZ="http://127.0.0.1:$PORT/readyz"
HEADROOM="$USERPROFILE/.local/bin/headroom.exe"
UPSTREAM="${HEADROOM_UPSTREAM:-https://api.anthropic.com}"
DB_PATH="${HEADROOM_DB_PATH:-}"

if curl -s -m 2 "$READYZ" >/dev/null 2>&1; then
  exit 0
fi

# Build argument list. Include --memory-db-path only when DB_PATH is set,
# so single-instance setups keep using the default location.
if [ -n "$DB_PATH" ]; then
  DB_ARGS=",'--memory-db-path','$DB_PATH'"
else
  DB_ARGS=""
fi

# Start detached (survives the hook shell).
powershell -NoProfile -Command \
  "Start-Process -WindowStyle Hidden -FilePath '$HEADROOM' -ArgumentList 'proxy','--port','$PORT','--anthropic-api-url','$UPSTREAM'$DB_ARGS" \
  >/dev/null 2>&1

# Wait for readiness so the first API call doesn't race the proxy.
i=0
while [ $i -lt 90 ]; do
  curl -s -m 2 "$READYZ" >/dev/null 2>&1 && exit 0
  sleep 1
  i=$((i + 1))
done

# Proxy failed to start: exit silently; the session connects directly to the
# upstream only if ANTHROPIC_BASE_URL was not pointed at the proxy.
exit 0