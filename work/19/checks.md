# Checks

Risk tier: high: no `[checks_policy]`.

Replayed by Ariane on commit `1023454adb16a4b7c526a5aefb57396db69ae3ab`.

Each check was replayed in its own clean working tree at `1023454adb16a4b7c526a5aefb57396db69ae3ab`, after the setup.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 17.6 s |
| contracts | yes | pass | 18.9 s |
| test-node | yes | pass | 69.7 s |
| test-worker | yes | pass | 12.9 s |
| e2e | yes | pass | 64.6 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 17.6 s)

```text
(77 earlier lines omitted)

/home/user/yt-digest-a1-r3.ariane/worktrees/19-replay-1/worker/src/contracts/node-release-request.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/19-replay-1/worker/src/contracts/node-result-request.ts
  3:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/19-replay-1/worker/src/contracts/transcript-result.ts
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
- Result: passed (exit 0, 18.9 s)

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
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r3.ariane/worktrees/19-replay-2/node)
 + yt-dlp==2026.8.19
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 69.7 s)

```text
(51 earlier lines omitted)

Run `npm audit` for details.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r3.ariane/worktrees/19-replay-3/node
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

======================== 113 passed in 61.42s (0:01:01) ========================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 12.9 s)

```text
(293 earlier lines omitted)

[90mstderr[2m | tests/workers/node.test.ts[2m > [22m[2mPOST /node/claim[2m > [22m[2meach claim gets min(max_jobs, eligible) under contention
[22m[39m{"video_id":"video000003","attrs":{"node_id":"node-b","attempt":1,"lease_seconds":600},"ts":"2026-10-22T05:01:22.363Z","level":"info","service":"worker","event":"job.claimed"}
{"video_id":"video000004","attrs":{"node_id":"node-b","attempt":1,"lease_seconds":600},"ts":"2026-10-22T05:01:22.363Z","level":"info","service":"worker","event":"job.claimed"}
{"video_id":"video000005","attrs":{"node_id":"node-b","attempt":1,"lease_seconds":600},"ts":"2026-10-22T05:01:22.363Z","level":"info","service":"worker","event":"job.claimed"}

[90mstderr[2m | tests/workers/node.test.ts[2m > [22m[2mPOST /node/claim[2m > [22m[2meach claim gets min(max_jobs, eligible) under contention
[22m[39m{"video_id":"video000006","attrs":{"node_id":"node-c","attempt":1,"lease_seconds":600},"ts":"2026-10-22T05:01:22.364Z","level":"info","service":"worker","event":"job.claimed"}
{"video_id":"video000007","attrs":{"node_id":"node-c","attempt":1,"lease_seconds":600},"ts":"2026-10-22T05:01:22.364Z","level":"info","service":"worker","event":"job.claimed"}
{"video_id":"video000008","attrs":{"node_id":"node-c","attempt":1,"lease_seconds":600},"ts":"2026-10-22T05:01:22.364Z","level":"info","service":"worker","event":"job.claimed"}

 [32m✓[39m [30m[42m workers [49m[39m tests/workers/node.test.ts [2m([22m[2m22 tests[22m[2m)[22m[33m 399[2mms[22m[39m
 [32m✓[39m [30m[42m workers [49m[39m tests/workers/worker.test.ts [2m([22m[2m30 tests[22m[2m)[22m[33m 2622[2mms[22m[39m
     [33m[2m✓[22m[39m empties every table and every transcript, and nothing else [33m 2537[2mms[22m[39m

[2m Test Files [22m [1m[32m5 passed[39m[22m[90m (5)[39m
[2m      Tests [22m [1m[32m75 passed[39m[22m[90m (75)[39m
[2m   Start at [22m 05:01:20
[2m   Duration [22m 4.05s[2m (transform 619ms, setup 265ms, import 715ms, tests 3.07s, environment 1ms)[22m
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 64.6 s)

```text
(51 earlier lines omitted)

5 high severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
stack: ready http://127.0.0.1:8787

Running 4 tests using 2 workers

  ✓  2 [api] › tests/health.api.spec.ts:5:1 › the Worker answers /health (77ms)
  ✓  3 [api] › tests/health.api.spec.ts:10:1 › the mocks server answers /health (17ms)
  ✓  4 [api] › tests/health.api.spec.ts:16:1 › SponsorBlock has no segment for any video (36ms)
  ✓  1 [api] › tests/claims.api.spec.ts:17:1 › 2 nodes claim 6 jobs concurrently and each job is handed out once (431ms)

  4 passed (1.8s)
stack: port 8787 is already taken
stack: ready http://127.0.0.1:8787
stack: ready http://127.0.0.1:8787
```

Summary: 5 passed, 0 failed (0 blocking).
