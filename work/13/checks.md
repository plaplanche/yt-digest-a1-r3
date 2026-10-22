# Checks

Risk tier: high: no `[checks_policy]`.

Replayed by Ariane on commit `5154c118802923058df2a94ac6d23421e279bb37`.

Each check was replayed in its own clean working tree at `5154c118802923058df2a94ac6d23421e279bb37`, after the setup.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 8.5 s |
| contracts | yes | pass | 14.6 s |
| test-node | yes | pass | 97.3 s |
| test-worker | yes | pass | 3.9 s |
| e2e | yes | pass | 0.0 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 8.5 s)

```text
(64 earlier lines omitted)
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/13-replay-1/worker/src/contracts/node-heartbeat-response.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/13-replay-1/worker/src/contracts/node-job-ack.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/13-replay-1/worker/src/contracts/node-release-request.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/13-replay-1/worker/src/contracts/node-result-request.ts
  3:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/13-replay-1/worker/src/contracts/transcript-result.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

✖ 10 problems (0 errors, 10 warnings)
  0 errors and 10 warnings potentially fixable with the `--fix` option.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 14.6 s)

```text
(27 earlier lines omitted)
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
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r3.ariane/worktrees/13-replay-2/node)
 + yt-dlp==2026.8.19
```

## test-node

- Command: `./scripts/check.sh test-node`
- Blocking: yes
- Result: passed (exit 0, 97.3 s)

```text
(45 earlier lines omitted)

found 0 vulnerabilities
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.7.0
rootdir: /home/user/yt-digest-a1-r3.ariane/worktrees/13-replay-3/node
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

======================== 113 passed in 93.25s (0:01:33) ========================
```

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 3.9 s)

```text
(1 earlier lines omitted)

added 144 packages, and audited 145 packages in 3s

49 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

[1m[30m[46m RUN [49m[39m[22m [36mv5.0.5 [39m[90m/home/user/yt-digest-a1-r3.ariane/worktrees/13-replay-4/worker[39m

 [32m✓[39m tests/transcript-result.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 7[2mms[22m[39m
 [32m✓[39m tests/contracts.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 19[2mms[22m[39m
 [32m✓[39m tests/placeholder.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 4[2mms[22m[39m
 [32m✓[39m tests/node-protocol.test.ts [2m([22m[2m16 tests[22m[2m)[22m[32m 38[2mms[22m[39m

[2m Test Files [22m [1m[32m4 passed[39m[22m[90m (4)[39m
[2m      Tests [22m [1m[32m24 passed[39m[22m[90m (24)[39m
[2m   Start at [22m 04:09:01
[2m   Duration [22m 476ms[2m (transform 55%, import 30%, tests 11%, worker 3%)[22m
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 0.0 s)

```text
== e2e: not implemented yet, skipped
```

Summary: 5 passed, 0 failed (0 blocking).
