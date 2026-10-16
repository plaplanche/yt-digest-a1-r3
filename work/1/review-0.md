# Review 0

- Reviewed commit: `fc986f154395218e42599bb04aa9c296dd199d45`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/package.json:15`) Unused dev dependency @eslint/js

  `@eslint/js` is installed but `worker/eslint.config.js` only uses `typescript-eslint` and never imports it. That goes against "nothing more". Remove it, or use `js.configs.recommended` and record that in docs/decisions.md.

- **minor** (`worker/package.json:9`) npm scripts that no check uses

  The `typecheck`, `lint` and `test` scripts are not called by any check. The checks call `npm exec --prefix worker` directly. These scripts add a second way to run the same tools, and it can drift, for example `eslint .` run from worker/ versus `eslint worker` run from the root. Neither the ticket nor the spec asks for them.

- **minor** (`worker/tsconfig.json:11`) tsconfig include lists a missing file and a JS file that is never checked

  `include` lists `vitest.config.ts`, which does not exist. It also lists `eslint.config.js`, but `allowJs` is not set, so tsc ignores that file. Both entries are dead config and suggest a type-check coverage that does not exist.

- **minor** (`scripts/checks/contracts.sh:6`) contracts check passes silently if scripts/contracts.sh exists but is not executable

  The guard is `[[ -x scripts/contracts.sh ]]`. If a later ticket commits `contracts.sh` without the executable bit, the check prints "does not exist yet" and passes, so contract drift goes unchecked. Test for `-e`, so a present but non-executable script fails loudly.

- **minor** (`docs/decisions.md:1`) Some open choices are not recorded

  These choices are not in docs/decisions.md: the TypeScript compiler options (target ES2022, module ESNext, moduleResolution Bundler, `types: []`), the Node engine range `>=22` where the spec says Node 22, and the use of ruff's default rule set with no `[tool.ruff]` configuration. Each is a small choice, but the project rule asks for one dated line per choice.

- **minor** (`work/1/journal.md:1`) No record that the lint check was shown to fail

  The acceptance criteria ask that `./scripts/check.sh lint` be shown to fail on a Python lint error, a type error, a TypeScript error and a shellcheck warning. The journal and status contain no such record. By reading the scripts, each case should fail: ruff's default rules catch unused imports, mypy strict covers node/, tsc includes src and tests, and shellcheck runs on every scripts/**/*.sh. The demonstration should still be recorded in the PR.

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

  It adds the `node/` uv project (Python 3.12, package `yt_digest_node` under src/, ruff, mypy strict, pytest, uv.lock) and the `worker/` npm package (TypeScript strict, ESLint, Vitest, package-lock.json), each with one placeholder test. The four executable `scripts/checks/*.sh` follow section 3.1 and install their own dependencies with `uv sync --locked` and `npm ci`. Shellcheck runs through `uvx --from shellcheck-py`. `contracts.sh` passes until scripts/contracts.sh exists. `ci/jobs.json` keeps one job per check, and spec/ and .github/workflows/ are untouched. Small extras: the unused `@eslint/js` dependency and the unused npm scripts (both minor findings).

- met: The change is covered by tests that fail without it.

  `node/tests/test_placeholder.py` imports `yt_digest_node` and asserts its docstring, and `worker/tests/placeholder.test.ts` imports `name` from src/index.ts. Both fail without the packages. The checks themselves are covered by the lint, contracts, test-node and test-worker runs that Ariane replayed, all green. The ticket's required lint-failure demonstrations are not recorded (minor finding).

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  docs/decisions.md records four dated choices: the hatchling build backend with src layout, the flat ESLint config with typescript-eslint recommended rules and an ESM package, check scripts run from the root through `uv run --project` and `npm exec --prefix` (mypy from node/), and the contracts placeholder behaviour. Smaller choices are missing: the tsconfig module and target options, the Node engine range, and the default ruff rules (minor finding).

## Proposed learnings (not decided)

- In skeleton tickets, check that every listed devDependency is actually used by a config or a check; an unused one is easy to miss.
- A guard on whether a later script exists should test for the file with `-e`, not `-x`, so a script committed without the executable bit fails instead of silently skipping the check.
- Acceptance criteria that call for throwaway failure demonstrations should have their evidence written in the journal or PR, because nothing in the commit can show it.
