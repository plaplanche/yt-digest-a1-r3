#!/usr/bin/env bash
# Python, TypeScript and shell linting.
set -euo pipefail
cd "$(dirname "$0")/../.."

uv sync --locked --project node
uv run --locked --project node ruff check node
uv run --locked --project node ruff format --check node
(cd node && uv run --locked mypy --strict .)

npm ci --prefix worker
npm exec --prefix worker -- tsc --noEmit -p worker
npm exec --prefix worker -- eslint worker

mapfile -t shell_files < <(find scripts -name '*.sh' | sort)
uvx --from shellcheck-py shellcheck "${shell_files[@]}"
