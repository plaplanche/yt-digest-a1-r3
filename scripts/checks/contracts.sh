#!/usr/bin/env bash
# Generated contracts are up to date with contracts/*.schema.json.
set -euo pipefail
cd "$(dirname "$0")/../.."

npm ci --prefix worker
uv sync --locked --project node
./scripts/contracts.sh --check
