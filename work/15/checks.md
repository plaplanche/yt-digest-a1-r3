# Checks

Risk tier: high: no `[checks_policy]`.

Replayed by Ariane on commit `9908603e24a689314576b34024c917df848113af`.

Each check was replayed in its own clean working tree at `9908603e24a689314576b34024c917df848113af`, after the setup.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 13.8 s |
| contracts | yes | pass | 19.0 s |
| test-node | yes | skipped | 0.0 s |
| test-worker | yes | pass | 12.3 s |
| e2e | yes | pass | 0.0 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 13.8 s)

```text
(70 earlier lines omitted)
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/15-replay-1/worker/src/contracts/node-heartbeat-response.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/15-replay-1/worker/src/contracts/node-job-ack.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/15-replay-1/worker/src/contracts/node-release-request.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/15-replay-1/worker/src/contracts/node-result-request.ts
  3:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/15-replay-1/worker/src/contracts/transcript-result.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

✖ 10 problems (0 errors, 10 warnings)
  0 errors and 10 warnings potentially fixable with the `--fix` option.
```

## contracts

- Command: `./scripts/check.sh contracts`
- Blocking: yes
- Result: passed (exit 0, 19.0 s)

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
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r3.ariane/worktrees/15-replay-2/node)
 + yt-dlp==2026.8.19
```

## test-node

- Command: `./scripts/check.sh test-node`
- Skipped: no changed file matches `paths`

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 12.3 s)

```text
(76 earlier lines omitted)
[90mstderr[2m | tests/workers/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2mGET /ops/anything with a wrong bearer is 401, whatever the body
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"unknown"},"ts":"2026-10-22T04:20:08.048Z","service":"worker","event":"auth.bearer.rejected"}

[90mstderr[2m | tests/workers/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2ma non-bearer scheme or a prefix of the token is 401
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"missing"},"ts":"2026-10-22T04:20:08.049Z","service":"worker","event":"auth.bearer.rejected"}

[90mstderr[2m | tests/workers/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2ma non-bearer scheme or a prefix of the token is 401
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"unknown"},"ts":"2026-10-22T04:20:08.050Z","service":"worker","event":"auth.bearer.rejected"}

[90mstderr[2m | tests/workers/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2ma non-bearer scheme or a prefix of the token is 401
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"unknown"},"ts":"2026-10-22T04:20:08.050Z","service":"worker","event":"auth.bearer.rejected"}

 [32m✓[39m [30m[42m workers [49m[39m tests/workers/worker.test.ts [2m([22m[2m30 tests[22m[2m)[22m[33m 2688[2mms[22m[39m
     [33m[2m✓[22m[39m empties every table and every transcript, and nothing else [33m 2614[2mms[22m[39m

[2m Test Files [22m [1m[32m5 passed[39m[22m[90m (5)[39m
[2m      Tests [22m [1m[32m54 passed[39m[22m[90m (54)[39m
[2m   Start at [22m 04:20:06
[2m   Duration [22m 3.91s[2m (transform 606ms, setup 82ms, import 768ms, tests 2.73s, environment 1ms)[22m
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 0.0 s)

```text
== e2e: not implemented yet, skipped
```

Summary: 4 passed, 0 failed (0 blocking), 1 skipped (no changed file matches `paths`).
