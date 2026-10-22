# Checks

Risk tier: high: no `[checks_policy]`.

Replayed by Ariane on commit `f61a5a7f4975edfc70b2fd2b5802997c37ddcff6`.

Each check was replayed in its own clean working tree at `f61a5a7f4975edfc70b2fd2b5802997c37ddcff6`, after the setup.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 249.0 s |
| contracts | yes | pass | 18.2 s |
| test-node | yes | pass | 82.3 s |
| test-worker | yes | skipped | 0.0 s |
| e2e | yes | pass | 70.0 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 249.0 s)

```text
(77 earlier lines omitted)

/home/user/yt-digest-a1-r3.ariane/worktrees/23-replay-1/worker/src/contracts/node-release-request.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/23-replay-1/worker/src/contracts/node-result-request.ts
  3:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/23-replay-1/worker/src/contracts/transcript-result.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

✖ 10 problems (0 errors, 10 warnings)
  0 errors and 10 warnings potentially fixable with the `--fix` option.


added 104 packages, and audited 105 packages in 2s

30 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 18.2 s)

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
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r3.ariane/worktrees/23-replay-2/node)
 + yt-dlp==2026.8.19
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 82.3 s)

```text
(52 earlier lines omitted)
Run `npm audit` for details.
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r3.ariane/worktrees/23-replay-3/node
configfile: pyproject.toml
plugins: typeguard-4.6.0, platformdirs-4.13.3
collected 129 items

node/tests/test_cleaning.py ...........                                  [  8%]
node/tests/test_cli.py .......................                           [ 26%]
node/tests/test_contracts.py .........                                   [ 33%]
node/tests/test_daemon.py ................                               [ 45%]
node/tests/test_extractors.py ...........................                [ 66%]
node/tests/test_log.py ......                                            [ 71%]
node/tests/test_node_protocol.py ..................                      [ 85%]
node/tests/test_paging.py .......                                        [ 90%]
node/tests/test_placeholder.py .                                         [ 91%]
node/tests/test_sponsorblock.py ...........                              [100%]

======================== 129 passed in 74.91s (0:01:14) ========================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Skipped: no changed file matches `paths`

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 70.0 s)

```text
(56 earlier lines omitted)

Run `npm audit` for details.
stack: ready http://127.0.0.1:8787

Running 9 tests using 1 worker

  ✓  1 [api] › tests/claims.api.spec.ts:4:1 › E2E-13: 2 nodes claim 6 jobs concurrently, each job is handed out once and all 6 end done (533ms)
  ✓  2 [api] › tests/daemon.api.spec.ts:12:1 › the node daemon processes a queued video and its transcript is readable (1.1s)
  ✓  3 [api] › tests/health.api.spec.ts:5:1 › the Worker answers /health (12ms)
  ✓  4 [api] › tests/health.api.spec.ts:10:1 › the mocks server answers /health (13ms)
  ✓  5 [api] › tests/health.api.spec.ts:16:1 › SponsorBlock has no segment for any video (11ms)
  ✓  6 [api] › tests/results.api.spec.ts:6:1 › E2E-14: a lease expires, the job goes to another node and the first node's late result is 409 (2.7s)
  ✓  7 [api] › tests/results.api.spec.ts:29:1 › E2E-16: unavailable on 3 nodes gives failed_video and a 4th node gets nothing (201ms)
  ✓  8 [api] › tests/results.api.spec.ts:44:1 › E2E-20: a revoked node is refused and its job is reassigned (199ms)
  ✓  9 [api] › tests/results.api.spec.ts:63:1 › E2E-21: /node/* responses hold no user data (206ms)

  9 passed (6.4s)
stack: port 8787 is already taken
stack: ready http://127.0.0.1:8787
stack: ready http://127.0.0.1:8787
```

Summary: 4 passed, 0 failed (0 blocking), 1 skipped (no changed file matches `paths`).
