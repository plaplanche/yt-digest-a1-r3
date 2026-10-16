#!/usr/bin/env bash
# Generates TypeScript types and Pydantic models from contracts/*.schema.json.
# Needs `npm ci --prefix worker` and `uv sync --locked --project node` done (the contracts check does; it then runs the tools with --no-sync).
# With --check, regenerates into a temporary directory and exits 1 naming the stale files.
set -euo pipefail
cd "$(dirname "$0")/.."

ts_dir=worker/src/contracts
py_dir=node/src/yt_digest_node/contracts

generate() {
  local ts_out=$1 py_out=$2 schema name stem
  mkdir -p "$ts_out" "$py_out"
  for schema in contracts/*.schema.json; do
    name=$(basename "$schema" .schema.json)
    stem=${name//-/_}
    {
      echo "// Generated from contracts/$name.schema.json by scripts/contracts.sh; do not edit."
      npm exec --no --prefix worker -- json2ts --input "$PWD/$schema" --no-banner
    } >"$ts_out/$name.ts"
    {
      echo "# Generated from contracts/$name.schema.json by scripts/contracts.sh; do not edit."
      uv run --no-sync --project node datamodel-codegen --input "$schema" --input-file-type jsonschema \
        --output-model-type pydantic_v2.BaseModel --target-python-version 3.12 \
        --use-annotated --use-specialized-enum --disable-timestamp --disable-warnings --formatters ruff-format ruff-check
    } >"$py_out/$stem.py"
  done
}

if [[ "${1:-}" == "--check" ]]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  generate "$tmp/ts" "$tmp/py"
  stale=()
  for f in "$tmp"/ts/*; do
    [[ -f $ts_dir/$(basename "$f") ]] && cmp -s "$f" "$ts_dir/$(basename "$f")" || stale+=("$ts_dir/$(basename "$f")")
  done
  for f in "$tmp"/py/*; do
    [[ -f $py_dir/$(basename "$f") ]] && cmp -s "$f" "$py_dir/$(basename "$f")" || stale+=("$py_dir/$(basename "$f")")
  done
  for f in "$ts_dir"/*.ts "$py_dir"/*.py; do
    [[ $(basename "$f") == __init__.py ]] && continue
    [[ -f $tmp/ts/$(basename "$f") || -f $tmp/py/$(basename "$f") ]] || stale+=("$f")
  done
  if ((${#stale[@]})); then
    echo "stale or orphaned generated files (run ./scripts/contracts.sh):" >&2
    printf '  %s\n' "${stale[@]}" >&2
    exit 1
  fi
else
  generate "$ts_dir" "$py_dir"
fi
