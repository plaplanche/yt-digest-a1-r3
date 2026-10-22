# Review 0

- Reviewed commit: `5154c118802923058df2a94ac6d23421e279bb37`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`scripts/contracts.sh:21`) mark_refs leaks one temporary directory per schema per run

  `mark_refs` runs `mktemp -d` for every schema and every language, and nothing deletes those directories. The EXIT trap only removes the `--check` tmp dir. Each run of `contracts.sh`, including every CI `contracts` check and every `test_contracts.py` case, leaves about 2×N directories in /tmp. Fix: create the copies under one directory removed by the trap.

- **minor** (`scripts/contracts.sh:51`) Python generation dropped the ruff-check formatter

  Lot 1 ran datamodel-codegen with `--formatters ruff-format ruff-check`. Python output now goes through `ruff format` only, so import sorting and unused-import fixes no longer run on generated code. The current outputs are byte-identical for the lot 1 schemas and lint passes. A future schema could still produce a module that fails lint, with no record of this change in docs/decisions.md.

- **minor** (`scripts/contracts.sh:16`) type_of depends on exact two-space indentation of "title"

  `type_of` finds the referenced type name with `^  "title": "(.*)",$`. If a schema is reformatted, or its title is the last key, it returns an empty string. That would produce `import type {  } from ...` and `tsType: ""`. The result-request tests would catch this for the current $ref, but the failure would be confusing. Reading the title with `jq -r .title`, which is already a dependency, would be robust.

- **minor** (`node/tests/test_log.py:40`) Misleading test name for the job.claimed logger test

  `test_lot2_worker_event_is_in_the_catalogue` emits `job.claimed` from the node logger. That event belongs to the worker service in section 12, while the node logger always writes `service: node`. The catalogue enum is shared, so the test is valid for the acceptance criterion. Only the name suggests a service check that the test does not make.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: check e2e passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  Checked against spec/lot-2.md sections 4.1–4.3 and 12. All seven schemas match field for field (types, required keys, 1–64 version length, max_jobs 1–10, lease_id ≥16 in the claim response, ms-precision Z timestamp pattern, 11-character video_id pattern, `transcript` a required key with `anyOf [$ref transcript-result, null]`). error.schema.json matches 4.2, with additionalProperties false on both objects. The log-event enum holds lot 1's three events plus all 19 events of section 12, and both loggers accept them (EVENTS map in worker/src/log.ts, generated StrEnum in Python). contracts.sh writes one TS file and one Pydantic module per schema and imports TranscriptResult instead of inlining it. The diff contains no routes, stack or daemon code.

- met: The change is covered by tests that fail without it.

  worker/tests/node-protocol.test.ts (ajv 2020) and node/tests/test_node_protocol.py (Pydantic) each cover: a valid instance of all 8 schemas, an extra field, max_jobs 0 and 11, an unknown outcome, a transcript breaking its schema (bad video_id, extra field), a missing transcript key, and a heartbeat without version. Both suites also check that TranscriptResult is imported and not defined again (`get_args` plus source inspection in Python, the `?raw` source in TS). The logger tests accept `job.claimed`/`worker.call` and the existing tests still reject `not.catalogued`. The existing test_contracts.py runs `--check` on a copy of the repo with the new $ref schema and still fails on stale and orphaned files. None of these tests can pass on the base commit, because the schemas, modules and enum values do not exist there.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Two dated lines were added on 2026-10-22: ajv as a 2020-12 dev dependency plus `resolveJsonModule`, and the marker-based $ref resolution in contracts.sh that needs jq. Dropping the ruff-check formatter is a tooling detail, not a spec choice (reported as minor).

## Proposed learnings (not decided)

- Generator scripts that call mktemp inside loops should create everything under one directory removed by the trap; otherwise every CI run leaks temporary directories.
- When a generator pipeline is rewritten, compare its flags with the previous ones (here ruff-check was dropped silently); byte-identical output today does not guarantee it for future schemas.
- Prefer jq over line-oriented sed to read JSON fields such as `title` once jq is already a dependency.
