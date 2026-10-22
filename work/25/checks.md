# Checks

Risk tier: high: no `[checks_policy]`.

Replayed by Ariane on commit `30c546b17365cd6ad4ba76deadd3570f86f5ac37`.

Each check was replayed in its own clean working tree at `30c546b17365cd6ad4ba76deadd3570f86f5ac37`, after the setup.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 21.5 s |
| contracts | yes | pass | 17.9 s |
| test-node | yes | skipped | 0.0 s |
| test-worker | yes | pass | 14.7 s |
| e2e | yes | pass | 71.4 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 21.5 s)

```text
(77 earlier lines omitted)

/home/user/yt-digest-a1-r3.ariane/worktrees/25-replay-1/worker/src/contracts/node-release-request.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/25-replay-1/worker/src/contracts/node-result-request.ts
  3:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/25-replay-1/worker/src/contracts/transcript-result.ts
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
- Result: passed (exit 0, 17.9 s)

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
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r3.ariane/worktrees/25-replay-2/node)
 + yt-dlp==2026.8.19
```

## test-node

- Command: `./scripts/check.sh test-node`
- Skipped: no changed file matches `paths`

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 14.7 s)

```text
(923 earlier lines omitted)
[22m[39m{"attrs":{"node_id":"node-c"},"ts":"2026-10-22T07:05:14.016Z","level":"info","service":"worker","event":"node.enrolled"}

[90mstderr[2m | tests/workers/results.test.ts[2m > [22m[2mDELETE /ops/nodes/<node_id>[2m > [22m[2mis idempotent, 404 for an unknown node, and the third revocation gives failed_video
[22m[39m{"video_id":"video000001","attrs":{"node_id":"node-c","attempt":3,"lease_seconds":600},"ts":"2026-10-22T07:05:14.022Z","level":"info","service":"worker","event":"job.claimed"}

[90mstderr[2m | tests/workers/results.test.ts[2m > [22m[2mDELETE /ops/nodes/<node_id>[2m > [22m[2mis idempotent, 404 for an unknown node, and the third revocation gives failed_video
[22m[39m{"attrs":{"node_id":"node-c","leases_revoked":1},"ts":"2026-10-22T07:05:14.028Z","level":"info","service":"worker","event":"node.revoked"}

[90mstderr[2m | tests/workers/results.test.ts[2m > [22m[2mGET /ops/transcripts/<video_id>[2m > [22m[2m404 without an object, 401 without the operator token
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"missing"},"ts":"2026-10-22T07:05:14.042Z","service":"worker","event":"auth.bearer.rejected"}

 [32m✓[39m [30m[42m workers [49m[39m tests/workers/results.test.ts [2m([22m[2m34 tests[22m[2m)[22m[33m 2420[2mms[22m[39m
 [32m✓[39m [30m[42m workers [49m[39m tests/workers/worker.test.ts [2m([22m[2m30 tests[22m[2m)[22m[33m 3774[2mms[22m[39m
     [33m[2m✓[22m[39m empties every table and every transcript, and nothing else [33m 3610[2mms[22m[39m

[2m Test Files [22m [1m[32m7 passed[39m[22m[90m (7)[39m
[2m      Tests [22m [1m[32m116 passed[39m[22m[90m (116)[39m
[2m   Start at [22m 07:05:09
[2m   Duration [22m 5.78s[2m (transform 1.11s, setup 813ms, import 942ms, tests 7.16s, environment 0ms)[22m
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 71.4 s)

```text
(67 earlier lines omitted)
  ✓   6 [api] › tests/google.api.spec.ts:75:1 › the code gives a verifiable ID token with the claims of 5.3 (25ms)
  ✓   7 [api] › tests/google.api.spec.ts:98:1 › a tampered ID token does not verify and no nonce means no claim (15ms)
  ✓   8 [api] › tests/google.api.spec.ts:109:1 › the code is single use and bound to its redirect_uri (28ms)
  ✓   9 [api] › tests/google.api.spec.ts:122:1 › a wrong client secret gives 401 invalid_client; Basic authentication works (20ms)
  ✓  10 [api] › tests/google.api.spec.ts:132:1 › access_type=offline gives a refresh token that issues new tokens (26ms)
  ✓  11 [api] › tests/google.api.spec.ts:146:1 › userinfo answers for its access token only (17ms)
  ✓  12 [api] › tests/google.api.spec.ts:157:1 › revoke answers 200 (6ms)
  ✓  13 [api] › tests/health.api.spec.ts:5:1 › the Worker answers /health (13ms)
  ✓  14 [api] › tests/health.api.spec.ts:10:1 › the mocks server answers /health (7ms)
  ✓  15 [api] › tests/health.api.spec.ts:16:1 › SponsorBlock has no segment for any video (6ms)
  ✓  16 [api] › tests/invites.api.spec.ts:6:1 › invites are lowercased, revocable and re-activable; users start empty (87ms)
  ✓  17 [api] › tests/results.api.spec.ts:6:1 › E2E-14: a lease expires, the job goes to another node and the first node's late result is 409 (2.7s)
  ✓  18 [api] › tests/results.api.spec.ts:29:1 › E2E-16: unavailable on 3 nodes gives failed_video and a 4th node gets nothing (207ms)
  ✓  19 [api] › tests/results.api.spec.ts:44:1 › E2E-20: a revoked node is refused and its job is reassigned (207ms)
  ✓  20 [api] › tests/results.api.spec.ts:63:1 › E2E-21: /node/* responses hold no user data (164ms)

  20 passed (7.6s)
stack: port 8787 is already taken
stack: ready http://127.0.0.1:8787
stack: ready http://127.0.0.1:8787
```

Summary: 4 passed, 0 failed (0 blocking), 1 skipped (no changed file matches `paths`).
