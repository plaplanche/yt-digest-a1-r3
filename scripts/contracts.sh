#!/usr/bin/env bash
# Generates TypeScript types and Pydantic models from contracts/*.schema.json.
# Needs `npm ci --prefix worker` and `uv sync --locked --project node` done (the contracts check does; it then runs the tools with --no-sync).
# With --check, regenerates into a temporary directory and exits 1 naming the stale files.
set -euo pipefail
cd "$(dirname "$0")/.."

ts_dir=worker/src/contracts
py_dir=node/src/yt_digest_node/contracts

# A cross-file ref ("$ref": "<other>.schema.json") would be inlined by the generators, duplicating the type.
# It is swapped for a marker in a temporary copy of the schema, and the generated code imports the other
# schema's generated type instead.
# shellcheck disable=SC2016
refs() { { grep -oE '"\$ref": "[a-z-]+\.schema\.json"' "$1" || true; } | sed -E 's/.*"([a-z-]+)\.schema\.json"/\1/' | sort -u; }
type_of() { sed -nE 's/^  "title": "(.*)",$/\1/p' "contracts/$1.schema.json"; }

# Prints the path of a copy of the schema where each cross-file ref is replaced by `"<keyword>": "<prefix><Type>"`.
mark_refs() {
  local schema=$1 keyword=$2 prefix=$3 r copy
  copy=$(mktemp -d)/$(basename "$schema")
  cp "$schema" "$copy"
  for r in $(refs "$schema"); do
    sed -i "s|\"\$ref\": \"$r.schema.json\"|\"$keyword\": \"$prefix$(type_of "$r")\"|" "$copy"
  done
  echo "$copy"
}

generate_ts() {
  local schema=$1 r
  for r in $(refs "$schema"); do
    echo "import type { $(type_of "$r") } from \"./$r\";"
  done
  npm exec --no --prefix worker -- json2ts --input "$(mark_refs "$schema" tsType "")" --no-banner
}

generate_py() {
  local schema=$1 r out copy
  # shellcheck disable=SC2016
  copy=$(mark_refs "$schema" '$ref' '#/$defs/')
  # Each referenced type becomes a local stand-in (`type X = str`), dropped below in favour of the import.
  for r in $(refs "$schema"); do
    jq --arg t "$(type_of "$r")" '.["$defs"][$t] = {"type": "string"}' "$copy" >"$copy.new" && mv "$copy.new" "$copy"
  done
  out=$(uv run --no-sync --project node datamodel-codegen --input "$copy" --input-file-type jsonschema \
    --output-model-type pydantic_v2.BaseModel --target-python-version 3.12 \
    --use-annotated --use-specialized-enum --disable-timestamp --disable-warnings --use-type-alias)
  for r in $(refs "$schema"); do
    out=$(sed "/^type $(type_of "$r") = str$/d; s/^from pydantic import.*/&\n\nfrom yt_digest_node.contracts.${r//-/_} import $(type_of "$r")/" <<<"$out")
  done
  uv run --no-sync --project node ruff format --quiet --stdin-filename "$py_dir/x.py" - <<<"$out"
}

generate() {
  local ts_out=$1 py_out=$2 schema name stem
  mkdir -p "$ts_out" "$py_out"
  for schema in contracts/*.schema.json; do
    name=$(basename "$schema" .schema.json)
    stem=${name//-/_}
    {
      echo "// Generated from contracts/$name.schema.json by scripts/contracts.sh; do not edit."
      generate_ts "$schema"
    } >"$ts_out/$name.ts"
    {
      echo "# Generated from contracts/$name.schema.json by scripts/contracts.sh; do not edit."
      generate_py "$schema"
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
