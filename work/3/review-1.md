# Review 1

- Reviewed commit: `5aeefb0ff9fdc1640ae5256450453e6f54ca893c`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/log.py:14`) Python emit silently overrides `ts` and `service` passed as fields; the TypeScript logger rejects them

  `emit("service.started", ts="x", service="worker")` does not raise. The values are dropped because the dict literal sets them again after `**fields`. `worker/src/log.ts` rejects the same keys with `unknown log field`. They are schema fields, so spec 4.4 ("unknown field raises") is arguably met, but the two loggers behave differently. Rejecting the reserved keys in Python, or writing the difference down, would make them consistent.

- **minor** (`docs/decisions.md:5`) The status-conditional rules of 4.1 are not enforced by the schema, and no decision says so

  Spec 4.1 says `lang` and `source` are null unless `ok`, `word_count` is 0, `truncated` is false and `pages` is empty unless `ok`. The schema checks types only, with no `if`/`then`, which is a reasonable simplest design. decisions.md records the matching choice for log `attrs` but not this one.

- **minor** (`node/tests/test_contracts.py:66`) The `--check` tests skip silently when worker/node_modules is missing

  The `needs_tools` skipif means the acceptance criterion "--check fails and names the file (shown by a test)" can pass without running anything if someone runs pytest without `npm ci`. `scripts/checks/test-node.sh` now runs `npm ci --prefix worker`, so the check and CI do run these tests. Only local runs can skip them.

- **minor** (`scripts/contracts.sh:41`) The orphan loop reports a literal glob when a generated directory has no matching files

  Without `nullglob`, an empty `worker/src/contracts` turns `"$ts_dir"/*.ts` into the literal `worker/src/contracts/*.ts`, which is then reported as stale. This is only a misleading message in an unlikely state, and the exit code is still correct.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  Both schemas match spec 4.1/4.2: the fields, the video_id pattern, the enums, `additionalProperties: false`, the ts pattern with milliseconds and Z, and the three-event catalogue. `scripts/contracts.sh` generates the TS types and the Pydantic v2 models, each starting with a do-not-edit line, with the catalogue as the TS union `LogEventName` and a Python `StrEnum`. `--check` regenerates into a temp directory and exits 1 naming the stale files, and the `contracts` check runs it. `emit(event, level="info", **fields)` validates through the generated model; pydantic's ValidationError is a ValueError subclass. `log(event, fields)` in worker/src/log.ts checks at runtime and is typed. The only addition beyond the ticket is `worker/src/transcript-result.ts`. It is needed for the TS test that rejects a bad video_id, which a type cannot express, and it is documented. No pipeline behaviour is implemented.

- met: The change is covered by tests that fail without it.

  Python: test_contracts.py covers a valid result, plus an extra field, a bad video_id and a bad status rejected. It also covers --check failing and naming the file after a hand edit, a schema change and an orphaned file. test_log.py covers a valid line and an unknown event, field or level raising. TypeScript: transcript-result.test.ts has a runtime parser test, plus `@ts-expect-error` type tests that tsc checks in lint (tests are in tsconfig `include`). contracts.test.ts covers a valid log line and an unknown event, field or level throwing. All blocking checks were replayed green.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  decisions.md has nine new dated lines: the generator tools, enums under `$defs`, free-form `attrs`, console.error and the Record catalogue, the hand-written `__init__.py`, tool installation and `npm exec --no`, draft 2020-12 and orphan detection, the hand-written TS runtime parser, and runtime type checks in the TS logger. One small gap: the schema does not enforce the status-conditional rules of 4.1 (minor finding).

## Proposed learnings (not decided)

- When a JSON Schema pattern cannot be expressed as a TypeScript type, a ticket that requires TS tests rejecting bad values needs a runtime validator. Record it as a decision.
- Tests that skip when their tools are missing should be backed by a check script that installs those tools, so the skip never happens in CI.
- Keep logger behaviour aligned across languages, including what happens when a caller passes reserved fields such as ts or service.
