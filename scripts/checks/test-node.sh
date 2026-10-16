#!/usr/bin/env bash
# Python tests.
set -euo pipefail
cd "$(dirname "$0")/../.."

uv sync --locked --project node
npm ci --prefix worker
uv run --locked --project node pytest node/tests
