# Review 0

- Reviewed commit: `8c01194eb5af837cf45b06e2fb89d41e812d8d08`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`scripts/contracts.sh:18`) The contracts check depends on worker/node_modules, which the contracts check never installs

  `generate` calls `npm exec --prefix worker -- json2ts`. `json2ts` is a bin of `json-schema-to-typescript`; it is not a package name. `scripts/checks/contracts.sh` runs `contracts.sh --check` without first running `npm ci --prefix worker`. Spec 3.1 says each check installs its own dependencies. In CI each check is a separate job on a fresh runner (ci/jobs.json), so `worker/node_modules` does not exist there. In that case `npm exec` treats `json2ts` as a package name and, in CI (non-TTY, `--yes` assumed), would try to install a package named `json2ts` from the registry. That is either a different tool or a missing package. Either way the `contracts` job fails, or it runs code that was never pinned in package-lock.json, which is a supply-chain risk. Ariane's green replay probably ran in a worktree where `lint` had already run `npm ci`. Fix: run `npm ci --prefix worker` and `uv sync --locked --project node` in scripts/checks/contracts.sh, or in contracts.sh itself, and call the bin in a way that cannot fall back to the registry (e.g. `npm exec --no -- json2ts` or `worker/node_modules/.bin/json2ts`).

- **blocking** (`node/tests/test_contracts.py:57`) The --check tests in test-node need worker/node_modules, which the test-node job never installs

  `_copy_repo` symlinks `ROOT/worker/node_modules`, but `scripts/checks/test-node.sh` only runs `uv sync`. In the standalone `test-node` CI job the symlink points to nothing, so json2ts cannot resolve (same registry fallback as above). Then `assert _check(repo).returncode == 0` fails, or the test downloads code. The copied repo also has no `node/.venv`, so `uv run --locked --project node` in the copy builds a fresh environment, which may need network access. The tests should not depend on the state another check left behind: install what they need, or skip with an explicit reason when the tools are missing.

- **blocking** (`worker/tests/transcript-result.test.ts:17`) TypeScript side does not test the 'bad video_id is rejected' acceptance criterion

  The ticket requires tests in both languages showing that a result with a bad `video_id` is rejected. The TS test says this in a comment ('The pattern of video_id is not expressible in a type and is enforced by the node') and leaves it untested. That gives up on an explicit acceptance criterion. The choice is also not recorded in docs/decisions.md. Either add runtime validation in TS (or a branded/template type) with a test, or record the decision and get the ticket amended. As written, the criterion is not met.

- **minor** (`scripts/checks/contracts.sh:6`) Obsolete 'skip when contracts.sh is missing' fallback and decision

  Now that scripts/contracts.sh exists, the fallback means that losing the executable bit or deleting the script makes the `contracts` check pass silently. The fallback and docs/decisions.md line 4 should be removed now that the check is real.

- **minor** (`contracts/log-event.schema.json:38`) `$defs` used under a draft-07 `$schema`

  `$defs` is a 2019-09+ keyword. Draft-07 uses `definitions`. The `$ref` JSON pointers still resolve in the current generators, but declaring draft 2020-12 or using `definitions` would be consistent. The same applies to transcript-result.schema.json.

- **minor** (`scripts/contracts.sh:34`) --check does not detect orphaned generated files

  Only files regenerated from current schemas are compared. A generated file whose schema was removed or renamed stays committed and the check still passes.

- **minor** (`worker/src/log.ts:28`) Runtime check does not validate `attrs` shape or `request_id`/`video_id` types

  Spec 4.4 says the TS logger follows 'same rule' as the Python one, which validates the whole line against the model. The TS runtime check only covers event, field names and level. A JS caller can pass e.g. `attrs: 'x'` or `video_id: 3` without an error. Low risk given strict TS, but it does not match the Python side.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  Schemas match 4.1/4.2. Generation, headers, StrEnum and TS union match 4.3. The loggers mostly match 4.4. However, the `contracts` check does not install its own dependencies (spec 3.1) and would fail or fetch an unrelated registry package in its standalone CI job. The TS 'bad video_id rejected' acceptance criterion is not met. Nothing out of scope (pipeline) was added.

- **blocking** Definition of done not met: The change is covered by tests that fail without it.

  Python: test_contracts.py covers valid/extra/bad video_id/bad status and --check after a hand edit and after a schema change. test_log.py covers an unknown event, field and level raising. TS: contracts.test.ts covers the logger throwing. transcript-result.test.ts relies on @ts-expect-error (checked by lint's tsc) for extra field and status, but has no bad video_id test. The --check tests depend on worker/node_modules, which the test-node job does not install, so they are not reliable in CI.

- **blocking** Definition of done not met: Every choice the spec leaves open is written down in docs/decisions.md.

  Tool choices, $defs naming, free-form attrs, console.error, and the hand-written __init__.py are recorded. Not recorded: no runtime TranscriptResult validation in TS (video_id pattern left to the node), and how the contracts check gets its npm/uv dependencies. Line 4 (contracts check skips when the script is missing) is now stale.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- **not met**: The change does what the ticket and spec/lot-1.md say, and nothing more.

  Schemas match 4.1/4.2. Generation, headers, StrEnum and TS union match 4.3. The loggers mostly match 4.4. However, the `contracts` check does not install its own dependencies (spec 3.1) and would fail or fetch an unrelated registry package in its standalone CI job. The TS 'bad video_id rejected' acceptance criterion is not met. Nothing out of scope (pipeline) was added.

- **not met**: The change is covered by tests that fail without it.

  Python: test_contracts.py covers valid/extra/bad video_id/bad status and --check after a hand edit and after a schema change. test_log.py covers an unknown event, field and level raising. TS: contracts.test.ts covers the logger throwing. transcript-result.test.ts relies on @ts-expect-error (checked by lint's tsc) for extra field and status, but has no bad video_id test. The --check tests depend on worker/node_modules, which the test-node job does not install, so they are not reliable in CI.

- **not met**: Every choice the spec leaves open is written down in docs/decisions.md.

  Tool choices, $defs naming, free-form attrs, console.error, and the hand-written __init__.py are recorded. Not recorded: no runtime TranscriptResult validation in TS (video_id pattern left to the node), and how the contracts check gets its npm/uv dependencies. Line 4 (contracts check skips when the script is missing) is now stale.

## Proposed learnings (not decided)

- Each check script must install its own dependencies (npm ci / uv sync); a green local `check.sh all` can hide this because `lint` installs node_modules first.
- Call npm bins as `npm exec --no -- <bin>` or via node_modules/.bin: a bin name that differs from its package name makes `npm exec` fall back to fetching a same-named registry package in CI.
- Tests that copy the repo and reuse tooling (symlinked node_modules, uv projects) must not assume another check already ran.
- When an acceptance criterion cannot be met in one language (e.g. regex patterns in TS types), record the decision and add a runtime check or test rather than leaving a comment.
