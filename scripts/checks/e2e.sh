#!/usr/bin/env bash
# End-to-end tests: Playwright against the local stack.
set -euo pipefail
cd "$(dirname "$0")/../.."

npm ci --prefix e2e

projects=()
if [[ -n ${CI:-} ]]; then
  (cd e2e && npx playwright install --with-deps chromium)
elif ! (cd e2e && timeout 120 npx playwright install chromium); then
  echo "e2e: chromium unavailable, browser project skipped"
  projects=(--project=api)
fi

collect() {
  mkdir -p ci-artifacts
  cp -r .stack/logs ci-artifacts/ 2>/dev/null || true
  cp -r e2e/playwright-report ci-artifacts/ 2>/dev/null || true
}

cleanup() {
  local status=$?
  if ((status != 0)); then collect; fi
  ./scripts/stack.sh down
}
trap cleanup EXIT
LEASE_SECONDS=2 ./scripts/stack.sh up
(cd e2e && npx playwright test "${projects[@]}")

# Lifecycle of stack.sh: taken port, repeated down, empty state after a second up.
./scripts/stack.sh down
./scripts/stack.sh down
node -e 'require("node:net").createServer().listen(8787, "127.0.0.1")' &
blocker=$!
sleep 1
if ./scripts/stack.sh up; then echo "e2e: up succeeded with port 8787 taken" >&2; kill "$blocker"; exit 1; fi
kill "$blocker"
wait "$blocker" 2>/dev/null || true
if curl -fsS -o /dev/null http://127.0.0.1:8789/health 2>/dev/null; then echo "e2e: mocks left running" >&2; exit 1; fi
./scripts/stack.sh up
touch .stack/state/marker
./scripts/stack.sh up
if [[ -e .stack/state/marker ]]; then echo "e2e: state kept by a second up" >&2; exit 1; fi
