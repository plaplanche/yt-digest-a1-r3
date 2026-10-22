# Checks

Risk tier: high: no `[checks_policy]`.

Replayed by Ariane on commit `2d586b40a3da9a1211dd83e6ed40668aabc1e5ee`.

Each check was replayed in its own clean working tree at `2d586b40a3da9a1211dd83e6ed40668aabc1e5ee`, after the setup.

| Check | Blocking | Result | Duration |
| --- | --- | --- | --- |
| lint | yes | pass | 24.2 s |
| contracts | yes | pass | 18.6 s |
| test-node | yes | skipped | 0.0 s |
| test-worker | yes | pass | 17.1 s |
| e2e | yes | pass | 76.5 s |

## lint

- Command: `./scripts/check.sh lint`
- Blocking: yes
- Result: passed (exit 0, 24.2 s)

```text
(77 earlier lines omitted)

/home/user/yt-digest-a1-r3.ariane/worktrees/27-replay-1/worker/src/contracts/node-release-request.ts
  2:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/27-replay-1/worker/src/contracts/node-result-request.ts
  3:1  warning  Unused eslint-disable directive (no problems were reported)

/home/user/yt-digest-a1-r3.ariane/worktrees/27-replay-1/worker/src/contracts/transcript-result.ts
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
- Result: passed (exit 0, 18.6 s)

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
 + yt-digest-node==0.1.0 (from file:///home/user/yt-digest-a1-r3.ariane/worktrees/27-replay-2/node)
 + yt-dlp==2026.8.19
```

## test-node

- Command: `./scripts/check.sh test-node`
- Skipped: no changed file matches `paths`

## test-worker

- Command: `./scripts/check.sh test-worker`
- Blocking: yes
- Result: passed (exit 0, 17.1 s)

```text
(1068 earlier lines omitted)
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"missing"},"ts":"2026-10-22T08:05:23.751Z","service":"worker","event":"auth.bearer.rejected"}

[90mstderr[2m | tests/workers/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2ma non-bearer scheme or a prefix of the token is 401
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"unknown"},"ts":"2026-10-22T08:05:23.751Z","service":"worker","event":"auth.bearer.rejected"}

[90mstderr[2m | tests/workers/worker.test.ts[2m > [22m[2moperator authentication[2m > [22m[2ma non-bearer scheme or a prefix of the token is 401
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"unknown"},"ts":"2026-10-22T08:05:23.752Z","service":"worker","event":"auth.bearer.rejected"}

[90mstderr[2m | tests/workers/invites.test.ts[2m > [22m[2minvites[2m > [22m[2mthe endpoints need the operator bearer
[22m[39m{"level":"warn","attrs":{"surface":"ops","reason":"missing"},"ts":"2026-10-22T08:05:24.072Z","service":"worker","event":"auth.bearer.rejected"}

 [32m✓[39m [30m[42m workers [49m[39m tests/workers/invites.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 88[2mms[22m[39m
 [32m✓[39m [30m[42m workers [49m[39m tests/workers/worker.test.ts [2m([22m[2m30 tests[22m[2m)[22m[33m 3115[2mms[22m[39m
     [33m[2m✓[22m[39m empties every table and every transcript, and nothing else [33m 3028[2mms[22m[39m

[2m Test Files [22m [1m[32m8 passed[39m[22m[90m (8)[39m
[2m      Tests [22m [1m[32m151 passed[39m[22m[90m (151)[39m
[2m   Start at [22m 08:05:19
[2m   Duration [22m 7.25s[2m (transform 1.73s, setup 1.74s, import 1.07s, tests 6.59s, environment 0ms)[22m
```

## e2e

- Command: `./scripts/check.sh e2e`
- Blocking: yes
- Result: passed (exit 0, 76.5 s)

```text
(68 earlier lines omitted)
  ✓   7 [api] › tests/google.api.spec.ts:75:1 › the code gives a verifiable ID token with the claims of 5.3 (24ms)
  ✓   8 [api] › tests/google.api.spec.ts:98:1 › a tampered ID token does not verify and no nonce means no claim (15ms)
  ✓   9 [api] › tests/google.api.spec.ts:109:1 › the code is single use and bound to its redirect_uri (21ms)
  ✓  10 [api] › tests/google.api.spec.ts:122:1 › a wrong client secret gives 401 invalid_client; Basic authentication works (16ms)
  ✓  11 [api] › tests/google.api.spec.ts:132:1 › access_type=offline gives a refresh token that issues new tokens (17ms)
  ✓  12 [api] › tests/google.api.spec.ts:146:1 › userinfo answers for its access token only (18ms)
  ✓  13 [api] › tests/google.api.spec.ts:157:1 › revoke answers 200 (7ms)
  ✓  14 [api] › tests/health.api.spec.ts:5:1 › the Worker answers /health (17ms)
  ✓  15 [api] › tests/health.api.spec.ts:10:1 › the mocks server answers /health (7ms)
  ✓  16 [api] › tests/health.api.spec.ts:16:1 › SponsorBlock has no segment for any video (6ms)
  ✓  17 [api] › tests/invites.api.spec.ts:6:1 › invites are lowercased, revocable and re-activable; users start empty (185ms)
  ✓  18 [api] › tests/results.api.spec.ts:6:1 › E2E-14: a lease expires, the job goes to another node and the first node's late result is 409 (2.7s)
  ✓  19 [api] › tests/results.api.spec.ts:29:1 › E2E-16: unavailable on 3 nodes gives failed_video and a 4th node gets nothing (195ms)
  ✓  20 [api] › tests/results.api.spec.ts:44:1 › E2E-20: a revoked node is refused and its job is reassigned (166ms)
  ✓  21 [api] › tests/results.api.spec.ts:63:1 › E2E-21: /node/* responses hold no user data (167ms)

  21 passed (7.9s)
stack: port 8787 is already taken
stack: ready http://127.0.0.1:8787
stack: ready http://127.0.0.1:8787
```

Summary: 4 passed, 0 failed (0 blocking), 1 skipped (no changed file matches `paths`).
