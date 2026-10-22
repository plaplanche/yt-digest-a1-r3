# Checks

Risk tier: high: no `[checks_policy]`.

Replayed by Ariane on commit `93eee34c72a260d0d1313f3a29b01686a6abcbe0`.

Each check was replayed in its own clean working tree at `93eee34c72a260d0d1313f3a29b01686a6abcbe0`, after the setup.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 17.3 s |
| contracts | yes | pass | 18.0 s |
| test-node | yes | skipped | 0.0 s |
| test-worker | yes | pass | 13.2 s |
| e2e | yes | pass | 67.1 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 17.3 s)

```text
(77 earlier lines omitted)

/home/user/yt-digest-a1-r3.ariane/worktrees/21-replay-1/worker/src/contracts/node-release-request.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/21-replay-1/worker/src/contracts/node-result-request.ts
  3:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/21-replay-1/worker/src/contracts/transcript-result.ts
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
- Result: passed (exit 0, 18.0 s)

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
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r3.ariane/worktrees/21-replay-2/node)
 + yt-dlp==2026.8.19
```

## test-node

- Command: `./scripts/check.sh test-node`
- Skipped: no changed file matches `paths`

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 13.2 s)

```text
(919 earlier lines omitted)
[22m[39m{"attrs":{"node_id":"node-c"},"ts":"2026-10-22T05:50:18.832Z","level":"info","service":"worker","event":"node.enrolled"}

[90mstderr[2m | tests/workers/results.test.ts[2m > [22m[2mDELETE /ops/nodes/<node_id>[2m > [22m[2mis idempotent, 404 for an unknown node, and the third revocation gives failed_video
[22m[39m{"video_id":"video000001","attrs":{"node_id":"node-c","attempt":3,"lease_seconds":600},"ts":"2026-10-22T05:50:18.836Z","level":"info","service":"worker","event":"job.claimed"}

[90mstderr[2m | tests/workers/results.test.ts[2m > [22m[2mDELETE /ops/nodes/<node_id>[2m > [22m[2mis idempotent, 404 for an unknown node, and the third revocation gives failed_video
[22m[39m{"attrs":{"node_id":"node-c","leases_revoked":1},"ts":"2026-10-22T05:50:18.840Z","level":"info","service":"worker","event":"node.revoked"}

[90mstderr[2m | tests/workers/results.test.ts[2m > [22m[2mGET /ops/transcripts/<video_id>[2m > [22m[2m404 without an object, 401 without the operator token
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"missing"},"ts":"2026-10-22T05:50:18.848Z","service":"worker","event":"auth.bearer.rejected"}

 [32m✓[39m [30m[42m workers [49m[39m tests/workers/results.test.ts [2m([22m[2m34 tests[22m[2m)[22m[33m 1709[2mms[22m[39m
 [32m✓[39m [30m[42m workers [49m[39m tests/workers/worker.test.ts [2m([22m[2m30 tests[22m[2m)[22m[33m 2696[2mms[22m[39m
     [33m[2m✓[22m[39m empties every table and every transcript, and nothing else [33m 2603[2mms[22m[39m

[2m Test Files [22m [1m[32m6 passed[39m[22m[90m (6)[39m
[2m      Tests [22m [1m[32m109 passed[39m[22m[90m (109)[39m
[2m   Start at [22m 05:50:15
[2m   Duration [22m 4.74s[2m (transform 1.04s, setup 611ms, import 1.10s, tests 4.95s, environment 0ms)[22m
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 67.1 s)

```text
(55 earlier lines omitted)
  npm audit fix --force

Run `npm audit` for details.
stack: ready http://127.0.0.1:8787

Running 8 tests using 1 worker

  ✓  1 [api] › tests/claims.api.spec.ts:4:1 › E2E-13: 2 nodes claim 6 jobs concurrently, each job is handed out once and all 6 end done (523ms)
  ✓  2 [api] › tests/health.api.spec.ts:5:1 › the Worker answers /health (22ms)
  ✓  3 [api] › tests/health.api.spec.ts:10:1 › the mocks server answers /health (13ms)
  ✓  4 [api] › tests/health.api.spec.ts:16:1 › SponsorBlock has no segment for any video (12ms)
  ✓  5 [api] › tests/results.api.spec.ts:6:1 › E2E-14: a lease expires, the job goes to another node and the first node's late result is 409 (2.7s)
  ✓  6 [api] › tests/results.api.spec.ts:29:1 › E2E-16: unavailable on 3 nodes gives failed_video and a 4th node gets nothing (194ms)
  ✓  7 [api] › tests/results.api.spec.ts:44:1 › E2E-20: a revoked node is refused and its job is reassigned (179ms)
  ✓  8 [api] › tests/results.api.spec.ts:63:1 › E2E-21: /node/* responses hold no user data (177ms)

  8 passed (4.7s)
stack: port 8787 is already taken
stack: ready http://127.0.0.1:8787
stack: ready http://127.0.0.1:8787
```

Summary: 4 passed, 0 failed (0 blocking), 1 skipped (no changed file matches `paths`).
