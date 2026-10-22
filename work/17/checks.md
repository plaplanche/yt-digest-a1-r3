# Checks

Risk tier: high: no `[checks_policy]`.

Replayed by Ariane on commit `2273e5fe27239e54881819f6406bbf09e33b4d11`.

Each check was replayed in its own clean working tree at `2273e5fe27239e54881819f6406bbf09e33b4d11`, after the setup.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 15.9 s |
| contracts | yes | pass | 17.4 s |
| test-node | yes | pass | 67.5 s |
| test-worker | yes | pass | 12.1 s |
| e2e | yes | pass | 62.6 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 15.9 s)

```text
(77 earlier lines omitted)

/home/user/yt-digest-a1-r3.ariane/worktrees/17-replay-1/worker/src/contracts/node-release-request.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/17-replay-1/worker/src/contracts/node-result-request.ts
  3:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/17-replay-1/worker/src/contracts/transcript-result.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

✖ 10 problems (0 errors, 10 warnings)
  0 errors and 10 warnings potentially fixable with the `--fix` option.


added 104 packages, and audited 105 packages in 1s

30 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 17.4 s)

```text
(33 earlier lines omitted)
 + markupsafe==3.0.4
 + more-itertools==11.2.1
 + mypy==2.4.0
 + mypy-extensions==1.1.0
 + packaging==26.3
 + pathspec==1.1.1
 + platformdirs==4.13.3
 + pluggy==1.7.0
 + pydantic==2.14.1
 + pydantic-core==2.50.1
 + pygments==2.21.0
 + pytest==9.1.1
 + pytokens==0.4.1
 + pyyaml==6.0.3
 + ruff==0.17.1
 + typeguard==4.6.0
 + typing-extensions==4.16.0
 + typing-inspection==0.4.4
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r3.ariane/worktrees/17-replay-2/node)
 + yt-dlp==2026.8.19
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 67.5 s)

```text
(51 earlier lines omitted)

Run `npm audit` for details.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r3.ariane/worktrees/17-replay-3/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 113 items

node/tests/test_cleaning.py ...........                                  [  9%]
node/tests/test_cli.py .......................                           [ 30%]
node/tests/test_contracts.py .........                                   [ 38%]
node/tests/test_extractors.py ...........................                [ 61%]
node/tests/test_log.py ......                                            [ 67%]
node/tests/test_node_protocol.py ..................                      [ 83%]
node/tests/test_paging.py .......                                        [ 89%]
node/tests/test_placeholder.py .                                         [ 90%]
node/tests/test_sponsorblock.py ...........                              [100%]

======================== 113 passed in 60.09s (0:01:00) ========================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 12.1 s)

```text
(75 earlier lines omitted)
[90mstderr[2m | tests/workers/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2mGET /ops/anything with a wrong bearer is 401, whatever the body
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"unknown"},"ts":"2026-10-22T04:41:08.188Z","service":"worker","event":"auth.bearer.rejected"}

[90mstderr[2m | tests/workers/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2ma non-bearer scheme or a prefix of the token is 401
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"missing"},"ts":"2026-10-22T04:41:08.188Z","service":"worker","event":"auth.bearer.rejected"}

[90mstderr[2m | tests/workers/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2ma non-bearer scheme or a prefix of the token is 401
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"unknown"},"ts":"2026-10-22T04:41:08.189Z","service":"worker","event":"auth.bearer.rejected"}

[90mstderr[2m | tests/workers/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2ma non-bearer scheme or a prefix of the token is 401
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"unknown"},"ts":"2026-10-22T04:41:08.189Z","service":"worker","event":"auth.bearer.rejected"}

 [32m✓[39m [30m[42m workers [49m[39m tests/workers/worker.test.ts [2m([22m[2m30 tests[22m[2m)[22m[33m 2726[2mms[22m[39m
     [33m[2m✓[22m[39m empties every table and every transcript, and nothing else [33m 2647[2mms[22m[39m

[2m Test Files [22m [1m[32m4 passed[39m[22m[90m (4)[39m
[2m      Tests [22m [1m[32m53 passed[39m[22m[90m (53)[39m
[2m   Start at [22m 04:41:07
[2m   Duration [22m 3.79s[2m (transform 434ms, setup 83ms, import 561ms, tests 2.77s, environment 0ms)[22m
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 62.6 s)

```text
(50 earlier lines omitted)
  run `npm fund` for details

5 high severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
stack: ready http://127.0.0.1:8787

Running 3 tests using 1 worker

  ✓  1 [api] › tests/health.api.spec.ts:5:1 › the Worker answers /health (41ms)
  ✓  2 [api] › tests/health.api.spec.ts:10:1 › the mocks server answers /health (23ms)
  ✓  3 [api] › tests/health.api.spec.ts:16:1 › SponsorBlock has no segment for any video (22ms)

  3 passed (1.2s)
stack: port 8787 is already taken
stack: ready http://127.0.0.1:8787
stack: ready http://127.0.0.1:8787
```

Summary: 5 passed, 0 failed (0 blocking).
