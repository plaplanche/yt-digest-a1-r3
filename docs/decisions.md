2026-10-16: Python build backend is hatchling, with a `src/` layout, so `yt_digest_node` is installed in the uv environment.
2026-10-16: ESLint uses the flat config with `typescript-eslint` recommended rules; `worker/` is an ES module package (`"type": "module"`).
2026-10-16: Check scripts call tools through `uv run --project node` and `npm exec --prefix worker`, so they run from the repository root without `cd` into packages (except mypy, which runs from `node/` to pick up its config).
2026-10-16: The `contracts` check passes with a message while `scripts/contracts.sh` does not exist.
