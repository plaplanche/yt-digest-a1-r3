#!/usr/bin/env bash
# Starts or stops the local stack (Worker, local D1 and R2, mocks server): ./scripts/stack.sh <up|down>
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD

WORKER_PORT=${WORKER_PORT:-8787}
MOCKS_PORT=${MOCKS_PORT:-8789}
STACK_READY_TIMEOUT=${STACK_READY_TIMEOUT:-180}
OPS_TOKEN=${OPS_TOKEN:-ops-local}
LEASE_SECONDS=${LEASE_SECONDS:-600}
ACCESS_TOKEN_TTL_SECONDS=${ACCESS_TOKEN_TTL_SECONDS:-3600}
REFRESH_TOKEN_TTL_SECONDS=${REFRESH_TOKEN_TTL_SECONDS:-2592000}
AUTH_CODE_TTL_SECONDS=${AUTH_CODE_TTL_SECONDS:-60}
AUTH_REQUEST_TTL_SECONDS=${AUTH_REQUEST_TTL_SECONDS:-600}
WORKER_URL=http://127.0.0.1:$WORKER_PORT
MOCKS_URL=http://127.0.0.1:$MOCKS_PORT
GOOGLE_ISSUER=${GOOGLE_ISSUER:-$MOCKS_URL/google}
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-yt-digest-local}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET:-local-google-secret}
ADMIN_EMAIL=${ADMIN_EMAIL:-alice@test}
TOKEN_ENC_KEY=${TOKEN_ENC_KEY:-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=}
ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-}

stack=$root/.stack
pids=$stack/pids

down() {
  local name pid
  for name in worker mocks; do
    [[ -f $pids/$name ]] || continue
    pid=$(cat "$pids/$name")
    # A stale pid file may name a reused pid: only signal a group that still runs our command.
    if ! tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -q -e wrangler -e mocks/server.ts; then
      rm -f "$pids/$name"
      continue
    fi
    # Each process runs in its own session, so its pid is its process group id.
    kill -TERM -- "-$pid" 2>/dev/null || true
    for _ in $(seq 50); do
      kill -0 -- "-$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL -- "-$pid" 2>/dev/null || true
    rm -f "$pids/$name"
  done
}

port_taken() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

fail() {
  echo "stack: $1" >&2
  down
  exit 1
}

up() {
  down
  for port in "$WORKER_PORT" "$MOCKS_PORT"; do
    if port_taken "$port"; then fail "port $port is already taken"; fi
  done
  for pkg in worker e2e; do
    [[ -d $pkg/node_modules ]] || npm ci --prefix "$pkg"
  done
  rm -rf "$stack/state"
  mkdir -p "$stack/state" "$stack/logs" "$pids"
  : >"$stack/logs/worker.log"
  : >"$stack/logs/mocks.log"
  export WRANGLER_SEND_METRICS=false

  (cd worker && npm exec -- wrangler d1 migrations apply DB --local --persist-to ../.stack/state) \
    >>"$stack/logs/worker.log" 2>&1 || fail "D1 migrations failed, see .stack/logs/worker.log"

  MOCKS_PORT=$MOCKS_PORT GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET \
    setsid npm exec --prefix e2e -- tsx e2e/mocks/server.ts >>"$stack/logs/mocks.log" 2>&1 </dev/null &
  echo $! >"$pids/mocks"

  local vars=(
    PUBLIC_URL="$WORKER_URL" OPS_TOKEN="$OPS_TOKEN" LEASE_SECONDS="$LEASE_SECONDS"
    ACCESS_TOKEN_TTL_SECONDS="$ACCESS_TOKEN_TTL_SECONDS" REFRESH_TOKEN_TTL_SECONDS="$REFRESH_TOKEN_TTL_SECONDS"
    AUTH_CODE_TTL_SECONDS="$AUTH_CODE_TTL_SECONDS" AUTH_REQUEST_TTL_SECONDS="$AUTH_REQUEST_TTL_SECONDS"
    GOOGLE_ISSUER="$GOOGLE_ISSUER" GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET"
    ADMIN_EMAIL="$ADMIN_EMAIL" TOKEN_ENC_KEY="$TOKEN_ENC_KEY" ALLOWED_ORIGINS="$ALLOWED_ORIGINS"
  )
  local var_args=()
  for v in "${vars[@]}"; do var_args+=(--var "${v/=/:}"); done
  setsid npm exec --prefix worker -- wrangler dev --config worker/wrangler.toml --local --ip 127.0.0.1 \
    --port "$WORKER_PORT" --persist-to .stack/state "${var_args[@]}" >>"$stack/logs/worker.log" 2>&1 </dev/null &
  echo $! >"$pids/worker"

  local deadline=$((SECONDS + STACK_READY_TIMEOUT))
  until curl -fsS -o /dev/null "$WORKER_URL/health" 2>/dev/null && curl -fsS -o /dev/null "$MOCKS_URL/health" 2>/dev/null; do
    if ((SECONDS >= deadline)); then fail "not ready after ${STACK_READY_TIMEOUT}s, see .stack/logs/"; fi
    for name in worker mocks; do
      kill -0 "$(cat "$pids/$name")" 2>/dev/null || fail "$name exited, see .stack/logs/$name.log"
    done
    sleep 0.5
  done
  echo "stack: ready $WORKER_URL"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 <up|down>" >&2; exit 2 ;;
esac
