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

trap './scripts/stack.sh down' EXIT
LEASE_SECONDS=2 ./scripts/stack.sh up
(cd e2e && npx playwright test "${projects[@]}") || { collect; exit 1; }
