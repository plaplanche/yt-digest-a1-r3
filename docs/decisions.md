2026-10-16: Python build backend is hatchling, with a `src/` layout, so `yt_digest_node` is installed in the uv environment.
2026-10-16: ESLint uses the flat config with `typescript-eslint` recommended rules; `worker/` is an ES module package (`"type": "module"`).
2026-10-16: Check scripts call tools through `uv run --project node` and `npm exec --prefix worker`, so they run from the repository root without `cd` into packages (except mypy, which runs from `node/` to pick up its config).
2026-10-16: Contracts are generated with `datamodel-code-generator` (dev dependency of `node`, Pydantic v2 output, `StrEnum` for every enum) and `json-schema-to-typescript` (dev dependency of `worker`); `pydantic` is a runtime dependency of `node`.
2026-10-16: Enums live under `$defs` in the schemas so the generated types are named (`LogEventName`, `TranscriptStatus`, ...); the catalogue is the `LogEventName` union in TypeScript and `LogEventName` `StrEnum` in Python.
2026-10-16: `attrs` is a free-form object in the log schema; the per-event attribute lists of spec 4.2 are not enforced by the schema.
2026-10-16: The TypeScript logger writes with `console.error`, and keeps its runtime catalogue as a `Record<LogEventName, true>` so the compiler flags drift from the generated union.
2026-10-16: The generated package `contracts/` has a hand-written empty `__init__.py`, which is not checked by `contracts.sh --check`.
2026-10-16: The `contracts` check script installs the tools (`npm ci --prefix worker`, `uv sync --locked --project node`); `scripts/contracts.sh` calls `json2ts` with `npm exec --no`, so it never falls back to the registry.
2026-10-16: The schemas declare draft 2020-12, which is where `$defs` belongs; `--check` also reports generated files whose schema no longer exists.
2026-10-16: The TypeScript side validates a transcript result at runtime with a small hand-written `parseTranscriptResult` (no JSON Schema library); the `test-node` check also runs `npm ci --prefix worker` because its `--check` tests use the worker tools.
2026-10-16: The TypeScript logger checks the types of `attrs`, `request_id` and `video_id` at runtime, as the Python logger does through its model.
2026-10-16: Segments are passed to `clean_cues` as a list of `(start, end)` tuples in seconds; the function returns the paragraphs as a list of strings (joining with `\n\n` is left to the caller).
2026-10-16: A "kept cue" (step 5) is a cue that still has at least one line after steps 3 and 4; the gap is measured from the last such cue, and compared in whole milliseconds so that 1.9 s and 2.0 s are exact.
2026-10-16: "The line kept just before" (step 4) is the last kept line across cues, not only within the cue.
2026-10-16: A cue block is recognised by a `-->` timing line in its first two lines (an optional identifier comes first); blocks without one are ignored, and a leading BOM and CRLF line ends are accepted.
