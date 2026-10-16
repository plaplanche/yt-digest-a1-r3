2026-10-16: Python build backend is hatchling, with a `src/` layout, so `yt_digest_node` is installed in the uv environment.
2026-10-16: ESLint uses the flat config with `typescript-eslint` recommended rules; `worker/` is an ES module package (`"type": "module"`).
2026-10-16: Check scripts call tools through `uv run --project node` and `npm exec --prefix worker`, so they run from the repository root without `cd` into packages (except mypy, which runs from `node/` to pick up its config).
2026-10-16: The `contracts` check passes with a message while `scripts/contracts.sh` does not exist.
2026-10-16: Contracts are generated with `datamodel-code-generator` (dev dependency of `node`, Pydantic v2 output, `StrEnum` for every enum) and `json-schema-to-typescript` (dev dependency of `worker`); `pydantic` is a runtime dependency of `node`.
2026-10-16: Enums live under `$defs` in the schemas so the generated types are named (`LogEventName`, `TranscriptStatus`, ...); the catalogue is the `LogEventName` union in TypeScript and `LogEventName` `StrEnum` in Python.
2026-10-16: `attrs` is a free-form object in the log schema; the per-event attribute lists of spec 4.2 are not enforced by the schema.
2026-10-16: The TypeScript logger writes with `console.error`, and keeps its runtime catalogue as a `Record<LogEventName, true>` so the compiler flags drift from the generated union.
2026-10-16: The generated package `contracts/` has a hand-written empty `__init__.py`, which is not checked by `contracts.sh --check`.
